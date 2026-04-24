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

  // ── Rate limiting ──────────────────────────────────────────────────────────

  /**
   * Increment request counter for this key in the current window.
   * Returns the new count. Uses sliding window (60s).
   */
  incrementRateLimit(keyId: string): Promise<number>;

  getRateLimit(keyId: string): Promise<number>;

  // ── Replay protection ──────────────────────────────────────────────────────

  /**
   * Mark a requestId as seen. Returns false if already seen (replay attack).
   * Uses SET NX with TTL = REPLAY_WINDOW_MS.
   */
  markRequestId(requestId: string): Promise<boolean>;

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
   * Used by the flush worker.
   */
  drainUsageCounters(accountId: string): Promise<
    Array<{
      apiKeyId: string;
      metric: string;
      periodStart: Date;
      quantity: bigint;
    }>
  >;
}

// core/types/api-key/cacheService.ts

// ─── What gets stored in Redis for each API key ───────────────────────────────
// All fields are primitives — no Date objects (Redis stores strings).
// Timestamps stored as unix milliseconds (number).
