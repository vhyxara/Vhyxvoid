// ─────────────────────────────────────────────────────────────────────────────
// CACHE SERVICE INTERFACE (Redis abstraction)
// ─────────────────────────────────────────────────────────────────────────────

export interface CachedApiKeyData {
  keyId: string;
  secretHash: string;
  previousSecretHash: string | null;
  rotationGraceEndsAt: number | null; // unix ms
  status: string;
  accountId: string;
  accountStatus: string; // cached to avoid join on every request
  scopes: string[];
  rateLimitPerMinute: number;
  expiresAt: number | null; // unix ms
}

export interface ApiKeyCacheService {
  /** Cache key data. Called after every save. */
  set(keyId: string, data: CachedApiKeyData): Promise<void>;

  /** Read from cache. Returns null on miss. */
  get(keyId: string): Promise<CachedApiKeyData | null>;

  /**
   * Invalidate immediately.
   * MUST be called on revoke and rotate — critical for security.
   */
  invalidate(keyId: string): Promise<void>;

  /**
   * Invalidate every cached entry for a set of keys in one call. Used when
   * something account-level changes (a Stripe webhook event, the grace-
   * period worker suspending an account) rather than one specific key —
   * the caller is responsible for resolving the account's key ids first.
   * Added 2026-09-22 (S4, E6) to close the up-to-5-minute lag between an
   * account's real status changing and the hub/gateway noticing.
   */
  invalidateAllForAccount(keyIds: string[]): Promise<void>;

  // ── Rate limiting ──────────────────────────────────────────────────────────

  /**
   * Increment request counter for this key in the current window.
   * Returns the new count. Uses sliding window (60s).
   */
  incrementRateLimit(keyId: string): Promise<number>;

  getRateLimit(keyId: string): Promise<number>;

  // ── Usage counters (hot path) ──────────────────────────────────────────────

  /**
   * Increment usage counter in current time bucket.
   * Fire-and-forget — never throws.
   */
  incrementUsage(params: {
    accountId: string;
    apiKeyId: string;
    metric: string;
    amount: number;
  }): Promise<void>;

  /**
   * Read all usage counters for an account since a given time.
   * Used by the flush worker. apiKeyId is null for the public tunnel-URL
   * path's account-level rollup (PUBLIC_USAGE_SENTINEL, mapped back to null
   * here) — every other bucket has a real key.
   */
  drainUsageCounters(
    accountId: string,
    keys?: string[],
  ): Promise<DrainedUsageCounter[]>;

  /**
   * Every accountId that currently has at least one usage:* counter in
   * Redis, whatever wrote it (SDK path, public tunnel path) and whether or
   * not the account still has an ACTIVE key. Not filtered to accounts this
   * environment knows about: local dev and production share one Upstash
   * instance, so callers must intersect with their own database before
   * draining.
   */
  listAccountIdsWithPendingUsage(): Promise<string[]>;

  /**
   * The same pending usage:* keys, grouped by accountId, from one SCAN.
   * Pass an account's list to drainUsageCounters() to skip its own scan.
   */
  listPendingUsageKeysByAccount(): Promise<Map<string, string[]>>;

  /**
   * Add a drained counter back to Redis after its Postgres write failed, so
   * the next flush retries it. Returns false when the counter is past its
   * original 25 h lifetime (or Redis refused), i.e. the count is dropped.
   */
  restoreUsageCounter(counter: DrainedUsageCounter): Promise<boolean>;
}

export interface DrainedUsageCounter {
  apiKeyId: string | null;
  metric: string;
  periodStart: Date;
  quantity: bigint;
  /** The Redis key it was drained from; restoreUsageCounter() writes it back. */
  redisKey: string;
}

// core/types/api-key/cacheService.ts

// ─── What gets stored in Redis for each API key ───────────────────────────────
// All fields are primitives — no Date objects (Redis stores strings).
// Timestamps stored as unix milliseconds (number).
