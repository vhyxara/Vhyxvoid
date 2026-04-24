import {
  KEY_CACHE_TTL_SEC,
  REPLAY_WINDOW_MS,
} from "@/core/constant/apikey.constant";
import {
  ApiKeyCacheService,
  CachedApiKeyData,
} from "@/core/types/api-key/cacheservice.type";
import { Redis } from "@upstash/redis";
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
    // await this.redis.set(NS.apiKey(keyId), JSON.stringify(data), 'EX', KEY_CACHE_TTL_SEC);
    console.log(
      "1. Setting cache for keyId",
      keyId,
      "with TTL",
      KEY_CACHE_TTL_SEC,
      "seconds",
      "data:",
      data,
    );
    try {
      await this.redis.set(NS.apiKey(keyId), JSON.stringify(data), {
        ex: KEY_CACHE_TTL_SEC,
      });
    } catch (err) {
      console.error("[Redis] set failed:", {
        cause: (err as any)?.cause,
        message: (err as any)?.message,
        url: process.env.UPSTASH_REDIS_REST_URL,
        tokenSet: !!process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      throw err;
    }
  }

  async get(keyId: string): Promise<CachedApiKeyData | null> {
    console.log("1. Getting cache for keyId", keyId);
    // const raw = await this.redis.get(NS.apiKey(keyId));
    const raw = await this.redis.get<string>(NS.apiKey(keyId));
    console.log("2. Cache raw result for keyId", keyId, ":", raw);
    if (!raw) return null;
    try {
      console.log("3. Parsing cache for keyId", keyId);
      return JSON.parse(raw) as CachedApiKeyData;
    } catch {
      console.log("3. Failed to parse cache for keyId", keyId);
      return null;
    }
  }

  async invalidate(keyId: string): Promise<void> {
    await this.redis.del(NS.apiKey(keyId));
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
    // const result = await this.redis.set(NS.replay(requestId), '1', 'PX', REPLAY_WINDOW_MS, 'NX');
    const result = await this.redis.set(NS.replay(requestId), "1", {
      px: REPLAY_WINDOW_MS,
      nx: true,
    });
    return result === "OK"; // null = already exists
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
      apiKeyId: string;
      metric: string;
      periodStart: Date;
      quantity: bigint;
    }>
  > {
    // Scan for all usage keys belonging to this account
    const pattern = `usage:${accountId}:*`;
    const keys = await this.scanKeys(pattern);

    if (keys.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const key of keys) pipeline.get(key);
    const results = (await pipeline.exec()) as Array<
      [null, string | null]
    > | null;

    const counters: Array<{
      apiKeyId: string;
      metric: string;
      periodStart: Date;
      quantity: bigint;
    }> = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const raw = results?.[i]?.[1] as string | null;
      if (!raw) continue;

      // Parse key: usage:{accountId}:{apiKeyId}:{metric}:{bucket}
      const parts = key.split(":");
      if (parts.length < 5) continue;

      const apiKeyId = parts[2];
      const metric = parts[3];
      const bucketStr = parts[4]; // yyyyMMddHHmm (5-min bucket)
      const periodStart = parseBucket(bucketStr);

      counters.push({
        apiKeyId,
        metric,
        periodStart,
        quantity: BigInt(raw),
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

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = 0;

    do {
      const res = await this.redis.scan(cursor, {
        match: pattern,
        count: 200,
      });

      cursor = res.cursor;

      const batch = res.keys.map((k) => (typeof k === "string" ? k : k.key));

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
