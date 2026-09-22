// packages/shared/src/validateApiKey.ts
//
// ValidateApiKeyUseCase — runs on EVERY agent registration and SDK request.
// Target: Redis cache hit = ~1ms. Postgres fallback = ~3ms.
//
// DESIGN: No Prisma import here. The caller passes a DbApiKeyLoader function
// that wraps their own Prisma instance. This keeps shared/ free of any
// generated-client dependency and works regardless of where Prisma output lives.

import crypto from "crypto";
import type { Redis } from "@upstash/redis";
import type {
  IValidateApiKeyUseCase,
  ValidateApiKeyParams,
  GatewayValidationResult,
  GatewayValidationSuccess,
  GatewayValidationFailure,
  DbApiKeyLoader,
} from "./types";
import { isConnectableAccountStatus } from "./accountStatus";

// ── Redis cache data shape ─────────────────────────────────────────────────────
// Flat, primitive-only shape stored as JSON in Redis.
// Mirrors CachedApiKeyData in the identity module — duplicated intentionally.

interface CachedKeyData {
  keyId: string;
  secretHash: string;
  previousSecretHash: string | null;
  rotationGraceEndsAt: number | null; // unix ms (Date → number for Redis)
  status: string; // 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  accountId: string;
  accountStatus: string; // 'ACTIVE' | 'SUSPENDED' | ...
  scopes: string[];
  rateLimitPerMinute: number; // -1 = unlimited
  expiresAt: number | null; // unix ms
}

// Redis key namespaces — must match RedisApiKeyCacheService.ts exactly
const NS = {
  apiKey: (keyId: string) => `apikey:data:${keyId}`,
  rateLimit: (keyId: string, w: string) => `apikey:rate:${keyId}:${w}`,
  replay: (requestId: string) => `apikey:replay:${requestId}`,
} as const;

const KEY_CACHE_TTL_SEC = 5 * 60; // 5 minutes
const REPLAY_WINDOW_MS = 60 * 1_000; // 1 minute
const SIGNATURE_WINDOW_MS = 60 * 1_000; // 1 minute

/**
 * A cached per-minute limit as the number the check uses. Only a finite,
 * non-negative number is a limit. -1 is the documented "unlimited"; null,
 * NaN, a missing field or any other negative value is treated the same way,
 * rather than as "0 requests allowed" (which is what a JSON-serialised
 * Infinity, i.e. null, used to mean here: every request was rejected).
 */
function toRateLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : Infinity;
}

export function toStoredRateLimit(value: number | undefined): number {
  const limit = toRateLimit(value);
  return limit === Infinity ? -1 : limit;
}

// ── Implementation ────────────────────────────────────────────────────────────

class ValidateApiKeyUseCaseImpl implements IValidateApiKeyUseCase {
  constructor(
    private readonly redis: Redis,
    private readonly loadKey: DbApiKeyLoader, // ← injected, no Prisma import
  ) {}

  async execute(
    params: ValidateApiKeyParams,
  ): Promise<GatewayValidationResult> {
    // 1. Timestamp window — reject stale requests
    if (Math.abs(Date.now() - params.timestamp) > SIGNATURE_WINDOW_MS) {
      return this.fail(
        "INVALID_SIGNATURE",
        "Request timestamp outside acceptable window",
      );
    }

    // 2. Replay protection — Redis SET NX (atomic, sub-1ms)
    const isNew = await this.markRequestId(params.requestId);
    if (!isNew) {
      return this.fail(
        "REPLAY_ATTACK",
        "Duplicate requestId — possible replay attack",
      );
    }

    // 3. Load key — Redis cache first (~1ms), Postgres fallback (~3ms)
    let cached = await this.loadFromCache(params.keyId);
    if (!cached) {
      const row = await this.loadKey(params.keyId);
      if (!row) {
        return this.fail("INVALID_SIGNATURE", "Unknown API key");
      }
      cached = this.rowToCache(row);
      await this.writeCache(params.keyId, cached);
    }

    // 4. Status checks
    if (cached.status === "REVOKED") {
      return this.fail(
        "REVOKED_KEY",
        "API key has been revoked",
        cached.accountId,
      );
    }
    if (cached.expiresAt !== null && cached.expiresAt < Date.now()) {
      return this.fail(
        "EXPIRED_KEY",
        "API key has expired",
        cached.accountId,
      );
    }
    // PAST_DUE is deliberately allowed here too — see
    // CONNECTABLE_ACCOUNT_STATUSES's own header comment; this is the SDK
    // (TunnelClient) request path's copy of the same test apps/hub's agent
    // handshake makes, now sharing one definition instead of two hand-
    // written `!== "ACTIVE"` checks.
    if (!isConnectableAccountStatus(cached.accountStatus)) {
      return this.fail(
        "SUSPENDED_ACCOUNT",
        "Account is not active",
        cached.accountId,
      );
    }

    // 5. Scope check
    const hasScope =
      cached.scopes.includes("*") ||
      cached.scopes.includes(params.requiredScope);
    if (!hasScope) {
      return this.fail(
        "SCOPE_MISSING",
        `Key missing required scope: ${params.requiredScope}`,
        cached.accountId,
      );
    }

    // 6. HMAC-SHA256 signature verification (timing-safe)
    // canonical = METHOD|PATH|QUERY|BODY_SHA256|REQUEST_ID|TIMESTAMP_MS
    // MUST match buildCanonical() in packages/protocol/src/canonical.ts exactly
    const bodyHash = params.body
      ? crypto.createHash("sha256").update(params.body, "utf8").digest("hex")
      : "";

    const canonical = [
      params.method.toUpperCase(),
      params.path,
      "", // query — hub auth calls use empty query string
      bodyHash,
      params.requestId,
      params.timestamp.toString(),
    ].join("|");

    const verify = (hash: string): boolean => {
      try {
        const expected = crypto
          .createHmac("sha256", hash)
          .update(canonical)
          .digest("hex");
        const a = Buffer.from(expected, "hex");
        const b = Buffer.from(params.signature, "hex");
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
      } catch {
        return false;
      }
    };

    const graceActive =
      cached.rotationGraceEndsAt !== null &&
      cached.rotationGraceEndsAt > Date.now();

    const signatureValid =
      verify(cached.secretHash) ||
      (graceActive && cached.previousSecretHash
        ? verify(cached.previousSecretHash)
        : false);

    if (!signatureValid) {
      return this.fail(
        "INVALID_SIGNATURE",
        "HMAC signature verification failed",
        cached.accountId,
      );
    }

    // 7. Rate limit — Redis INCR with 65s TTL window
    const rateLimit = toRateLimit(cached.rateLimitPerMinute);

    if (rateLimit !== Infinity) {
      const count = await this.incrementRateLimit(params.keyId);
      if (count > rateLimit) {
        return this.fail(
          "RATE_LIMITED",
          `Rate limit exceeded: ${rateLimit} req/min`,
          cached.accountId,
        );
      }
    }

    // 8. Record usage — fire and forget, never blocks response
    this.incrementUsage(cached.accountId, params.keyId).catch(() => {});

    return {
      valid: true,
      apiKeyId: params.keyId,
      accountId: cached.accountId,
      scopes: cached.scopes,
      rateLimitPerMinute: rateLimit === Infinity ? -1 : rateLimit,
    } satisfies GatewayValidationSuccess;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private fail(
    code: string,
    reason: string,
    accountId?: string,
  ): GatewayValidationFailure {
    return { valid: false, code, reason, ...(accountId ? { accountId } : {}) };
  }

  private rowToCache(row: import("./types").ApiKeyRow): CachedKeyData {
    return {
      keyId: row.keyId,
      secretHash: row.secretHash,
      previousSecretHash: row.previousSecretHash,
      rotationGraceEndsAt: row.rotationGraceEndsAt?.getTime() ?? null,
      status: row.status,
      accountId: row.accountId,
      accountStatus: row.accountStatus,
      scopes: row.scopes,
      // The plan's limit when the loader supplied it (buildDbApiKeyLoader
      // does); unlimited (-1) otherwise. Infinity is stored as -1 because JSON
      // turns it into null.
      rateLimitPerMinute: toStoredRateLimit(row.rateLimitPerMinute),
      expiresAt: row.expiresAt?.getTime() ?? null,
    };
  }

  private async loadFromCache(keyId: string): Promise<CachedKeyData | null> {
    try {
      const raw = await this.redis.get<string>(NS.apiKey(keyId));
      if (!raw) return null;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  private async writeCache(keyId: string, data: CachedKeyData): Promise<void> {
    try {
      await this.redis.set(NS.apiKey(keyId), JSON.stringify(data), {
        ex: KEY_CACHE_TTL_SEC,
      });
    } catch {
      // Cache write failure is not fatal — next request will hit DB
    }
  }

  private async markRequestId(requestId: string): Promise<boolean> {
    try {
      const result = await this.redis.set(NS.replay(requestId), "1", {
        px: REPLAY_WINDOW_MS,
        nx: true,
      });
      return result === "OK";
    } catch {
      return true; // fail open — never block on Redis failure
    }
  }

  private async incrementRateLimit(keyId: string): Promise<number> {
    const window = this.currentMinuteBucket();
    const redisKey = NS.rateLimit(keyId, window);
    try {
      const count = await this.redis.incr(redisKey);
      if (count === 1) await this.redis.expire(redisKey, 65);
      return count;
    } catch {
      return 0; // fail open on Redis error
    }
  }

  private async incrementUsage(
    accountId: string,
    keyId: string,
  ): Promise<void> {
    const bucket = this.current5MinBucket();
    const redisKey = `usage:${accountId}:${keyId}:requests:${bucket}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) await this.redis.expire(redisKey, 60 * 60 * 25);
  }

  private currentMinuteBucket(): string {
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, "0");
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  }

  private current5MinBucket(): string {
    const d = new Date();
    const min = Math.floor(d.getUTCMinutes() / 5) * 5;
    const p = (n: number) => n.toString().padStart(2, "0");
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(min)}`;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface BuildValidateApiKeyUseCaseOptions {
  redis: Redis;
  loadKey: DbApiKeyLoader; // ← caller provides, uses their own Prisma instance
}

export function buildValidateApiKeyUseCase(
  opts: BuildValidateApiKeyUseCaseOptions,
): IValidateApiKeyUseCase {
  return new ValidateApiKeyUseCaseImpl(opts.redis, opts.loadKey);
}
