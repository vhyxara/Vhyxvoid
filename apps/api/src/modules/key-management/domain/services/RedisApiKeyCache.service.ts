import {
  KEY_CACHE_TTL_SEC,
  REPLAY_WINDOW_MS,
} from "@/core/constant/apikey.constant";
import {
  ApiKeyCacheService,
  CachedApiKeyData,
} from "@/core/types/api-key/cacheservice.type";
import { Redis } from "@upstash/redis";
import { PUBLIC_USAGE_SENTINEL } from "@vhyxvoid/shared";
// import type { Redis } from 'ioredis';

// ─────────────────────────────────────────────────────────────────────────────
// REDIS KEY NAMESPACES
// All keys prefixed to avoid collisions across services.
// ─────────────────────────────────────────────────────────────────────────────

const NS = {
  apiKey: (keyId: string) => `apikey:data:${keyId}`,
  rateLimit: (keyId: string, window: string) =>
    `apikey:rate:${keyId}:${window}`,
  replay: (requestId: string) => `apikey:replay:${requestId}`,
  usage: (
    accountId: string,
    apiKeyId: string,
    metric: string,
    bucket: string,
  ) => `usage:${accountId}:${apiKeyId}:${metric}:${bucket}`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// REDIS CACHE SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class RedisApiKeyCacheService implements ApiKeyCacheService {
  constructor(private redis: Redis) {}

  // ── Key data cache ─────────────────────────────────────────────────────────

  async set(keyId: string, data: CachedApiKeyData): Promise<void> {
    try {
      await this.redis.set(NS.apiKey(keyId), JSON.stringify(data), {
        ex: KEY_CACHE_TTL_SEC,
      });
    } catch (err) {
      // Cache-write failure must never affect the gateway response — same
      // rationale as incrementUsage() below. The DB write this always
      // follows (create/update/rotate all call apiKeyRepository.save()
      // first) has already committed by the time this runs; re-throwing
      // here turned a successful mutation into an apparent 500. See
      // decision.md, 2026-09-12, "Bug 1 fix: RedisApiKeyCacheService fails
      // soft".
      console.error("[Redis] set failed:", {
        cause: (err as any)?.cause,
        message: (err as any)?.message,
        url: process.env.UPSTASH_REDIS_REST_URL,
        tokenSet: !!process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    }
  }

  async get(keyId: string): Promise<CachedApiKeyData | null> {
    // Fails soft (return null → caller's existing DB-fallback path runs)
    // instead of letting a Redis error propagate — same rationale as
    // set()/invalidate() above. Previously unguarded: a Redis outage would
    // throw here and take down every caller of ValidateApiKeyUseCase.execute()
    // (currently only the dormant POST /gateway/v1/validate route — see
    // decision.md, 2026-09-12, "RedisApiKeyCacheService.get()/markRequestId()").
    let raw: string | null;
    try {
      raw = await this.redis.get<string>(NS.apiKey(keyId));
    } catch (err) {
      console.error("[Redis] get failed:", {
        cause: (err as any)?.cause,
        message: (err as any)?.message,
      });
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedApiKeyData;
    } catch {
      return null;
    }
  }

  async invalidateAllForAccount(keyIds: string[]): Promise<void> {
    await Promise.all(keyIds.map((keyId) => this.invalidate(keyId)));
  }

  async invalidate(keyId: string): Promise<void> {
    try {
      await this.redis.del(NS.apiKey(keyId));
    } catch (err) {
      // Same fail-soft rationale as set() above — every caller
      // (create/update/rotate/revoke use cases, both expiry workers)
      // already saved the DB row before calling this; a stale cache entry
      // that outlives its TTL (max KEY_CACHE_TTL_SEC) is a much smaller
      // risk than turning a successful mutation into a 500.
      console.error("[Redis] invalidate failed:", {
        cause: (err as any)?.cause,
        message: (err as any)?.message,
        url: process.env.UPSTASH_REDIS_REST_URL,
        tokenSet: !!process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    }
  }

  // ── Rate limiting — sliding window ─────────────────────────────────────────
  //
  // Uses a 60-second fixed window keyed by minute boundary.
  // For higher accuracy, replace with a Redis Lua sliding window script.
  //
  // Window key format: rate:{keyId}:{yyyyMMddHHmm}
  // First increment sets TTL to 65 seconds (covers window + buffer).

  async incrementRateLimit(keyId: string): Promise<number> {
    const window = currentMinuteBucket();
    const redisKey = NS.rateLimit(keyId, window);

    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      // Set TTL only on first increment — 65 seconds covers the full minute + buffer
      await this.redis.expire(redisKey, 65);
    }
    return count;
  }

  async getRateLimit(keyId: string): Promise<number> {
    const window = currentMinuteBucket();

    const raw = await this.redis.get<string>(NS.rateLimit(keyId, window));

    return raw ? parseInt(raw, 10) : 0;
  }
  // ── Replay protection ──────────────────────────────────────────────────────
  //
  // SET NX with TTL = REPLAY_WINDOW_MS (1 minute).
  // Returns true if the requestId is new (first time seen).
  // Returns false if the requestId was already seen (replay attack).

  async markRequestId(requestId: string): Promise<boolean> {
    // Fail OPEN on a Redis error: treat the request as new rather than
    // rejecting it. Deliberate choice, not an oversight — see decision.md,
    // 2026-09-12, "RedisApiKeyCacheService.get()/markRequestId()" for the
    // full tradeoff writeup. Matches the equivalent, already-fail-open
    // markRequestId() in packages/shared/src/validateApiKey.ts (the Hub's
    // own, separate copy of this logic), so both implementations now agree.
    try {
      const result = await this.redis.set(NS.replay(requestId), "1", {
        px: REPLAY_WINDOW_MS,
        nx: true,
      });
      return result === "OK"; // null = already exists
    } catch (err) {
      console.error("[Redis] markRequestId failed:", {
        cause: (err as any)?.cause,
        message: (err as any)?.message,
      });
      return true;
    }
  }

  // ── Usage counters — hot path ──────────────────────────────────────────────
  //
  // Bucket = 5-minute intervals.
  // Key format: usage:{accountId}:{apiKeyId}:{metric}:{bucket}
  // TTL = 25 hours — covers flush window + 1 day for reconciliation.
  //
  // The flush worker reads all usage:* keys for an account, drains them
  // into Postgres UsageAggregate records, then DELs the keys.

  async incrementUsage(params: {
    accountId: string;
    apiKeyId: string;
    metric: string;
    amount: number;
  }): Promise<void> {
    try {
      const bucket = current5MinBucket();
      const redisKey = NS.usage(
        params.accountId,
        params.apiKeyId,
        params.metric,
        bucket,
      );

      const count = await this.redis.incrby(redisKey, params.amount);
      if (count === params.amount) {
        // First write for this bucket — set TTL
        await this.redis.expire(redisKey, 60 * 60 * 25); // 25 hours
      }
    } catch {
      // Usage failure must never affect the gateway response
    }
  }

  async drainUsageCounters(accountId: string): Promise<
    Array<{
      apiKeyId: string | null;
      metric: string;
      periodStart: Date;
      quantity: bigint;
    }>
  > {
    // Scan for all usage keys belonging to this account
    const pattern = `usage:${accountId}:*`;
    const keys = await this.scanKeys(pattern);

    if (keys.length === 0) return [];

    // @upstash/redis's pipeline().exec() returns one plain value per command,
    // in order — NOT ioredis's [err, value] tuples. With the client's default
    // automaticDeserialization an INCRBY counter comes back as a number; with
    // it off, as a string. Reading results[i][1] (the ioredis shape) silently
    // dropped every counter. See api/decision.md, 2026-09-24.
    const pipeline = this.redis.pipeline();
    for (const key of keys) pipeline.get(key);
    const results = (await pipeline.exec()) as unknown[];

    const counters: Array<{
      apiKeyId: string | null;
      metric: string;
      periodStart: Date;
      quantity: bigint;
    }> = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const quantity = toCounterQuantity(results?.[i]);
      if (quantity === null) continue;

      // Parse key: usage:{accountId}:{apiKeyId}:{metric}:{bucket}
      const parts = key.split(":");
      if (parts.length < 5) continue;

      // The public tunnel-URL path has no API key — the hub writes
      // PUBLIC_USAGE_SENTINEL in the apiKeyId slot instead. Map it back to
      // null here, UsageAggregate's own "account-level rollup" shape,
      // rather than storing the sentinel string as if it were a real key id
      // (which would violate ApiKey's foreign key on write).
      const rawApiKeyId = parts[2];
      const apiKeyId =
        rawApiKeyId === PUBLIC_USAGE_SENTINEL ? null : rawApiKeyId;
      const metric = parts[3];
      const bucketStr = parts[4]; // yyyyMMddHHmm (5-min bucket)
      const periodStart = parseBucket(bucketStr);

      counters.push({
        apiKeyId,
        metric,
        periodStart,
        quantity,
      });
    }

    // Delete all drained keys atomically
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }

    return counters;
  }


  // ── Private helpers ────────────────────────────────────────────────────────

  // private async scanKeys(pattern: string): Promise<string[]> {
  //   const keys: string[] = [];
  //   let cursor = '0';

  //   do {
  //     const [nextCursor, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', '200');
  //     cursor = nextCursor;
  //     keys.push(...batch);
  //   } while (cursor !== '0');

  //   return keys;
  // }

  // private async scanKeys(pattern: string): Promise<string[]> {
  //   const keys: string[] = [];
  //   let cursor = 0;

  //   do {
  //     const res = await this.redis.scan(cursor, {
  //       match: pattern,
  //       count: 200,
  //     });

  //     cursor = res.cursor;

  //     const batch = res.keys.map((k) => (typeof k === "string" ? k : k.key));

  //     keys.push(...batch);
  //   } while (cursor !== 0);

  //   return keys;
  // }
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = 0;

    do {
      const res = await this.redis.scan(cursor, {
        match: pattern,
        count: 200,
      });

      // Upstash returns [nextCursor, keys[]] as a tuple
      // cursor = res[0] as number;
      cursor = res[0] as unknown as number;
      // OR parse it explicitly (more correct):
      cursor = Number(res[0]);
      const batch = res[1] as string[];
      keys.push(...batch);
    } while (cursor !== 0);

    return keys;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUCKET HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Current minute bucket: yyyyMMddHHmm */
function currentMinuteBucket(): string {
  const d = new Date();
  return [
    d.getUTCFullYear(),
    pad2(d.getUTCMonth() + 1),
    pad2(d.getUTCDate()),
    pad2(d.getUTCHours()),
    pad2(d.getUTCMinutes()),
  ].join("");
}

/** Current 5-minute bucket: yyyyMMddHHm0 or yyyyMMddHHm5 */
function current5MinBucket(): string {
  const d = new Date();
  const min = Math.floor(d.getUTCMinutes() / 5) * 5;
  return [
    d.getUTCFullYear(),
    pad2(d.getUTCMonth() + 1),
    pad2(d.getUTCDate()),
    pad2(d.getUTCHours()),
    pad2(min),
  ].join("");
}

function parseBucket(bucket: string): Date {
  // yyyyMMddHHmm → Date
  const year = parseInt(bucket.slice(0, 4), 10);
  const month = parseInt(bucket.slice(4, 6), 10) - 1;
  const day = parseInt(bucket.slice(6, 8), 10);
  const hour = parseInt(bucket.slice(8, 10), 10);
  const min = parseInt(bucket.slice(10, 12), 10);
  return new Date(Date.UTC(year, month, day, hour, min));
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// A counter value exactly as Upstash's pipeline returns it: a number (default
// deserialization), a digit string (deserialization off), or null (key gone
// between SCAN and GET). Anything else, zero, or negative isn't a counter.
function toCounterQuantity(value: unknown): bigint | null {
  let quantity: bigint;
  // Past 2^53 the number is already imprecise from JSON parsing; still keep
  // it rather than drop a key that is about to be deleted.
  if (typeof value === "number" && Number.isInteger(value)) {
    quantity = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    quantity = BigInt(value);
  } else {
    return null;
  }
  return quantity > 0n ? quantity : null;
}
