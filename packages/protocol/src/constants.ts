// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/constants.ts
// ─────────────────────────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = "1" as const;

export const TIMING = {
  /**
   * Default for how long hub waits for an agent response before timing out a
   * tunneled request. The hub overrides this via TUNNEL_REQUEST_TIMEOUT_MS.
   */
  REQUEST_TIMEOUT_MS: 120_000,
  /** Buffer over REQUEST_TIMEOUT_MS for hub:pending Redis TTL */
  PENDING_TTL_MS: 122_000,
  /** Hub pings every N ms */
  HEARTBEAT_INTERVAL_MS: 15_000,
  /** Miss this many pings → agent evicted */
  MAX_MISSED_PINGS: 6,
  /** Redis presence key TTL (must be > HEARTBEAT_INTERVAL_MS) */
  AGENT_PRESENCE_TTL_SEC: 25,
  /** Agent reconnect: initial delay */
  RECONNECT_INITIAL_MS: 1_000,
  /** Agent reconnect: maximum delay cap */
  RECONNECT_MAX_MS: 300_000,
  /**
   * Signature timestamp tolerance: a signed request is accepted while
   * |now - ts| <= this. A request stamped at the edge (ts = now + window) stays
   * valid for 2 x window from its first use.
   */
  SIGNATURE_WINDOW_MS: 30_000,
  /**
   * How long a used requestId is remembered. Must cover the whole 2 x
   * SIGNATURE_WINDOW_MS a signed request can stay valid, plus a margin for
   * hub/Redis clock differences and TTL granularity; with it equal to the
   * window (as it was, 60 s / 60 s) a captured request could be replayed
   * once its key expired (audit H8).
   */
  REPLAY_WINDOW_MS: 2 * 30_000 + 5_000,
  /** MessageBatcher flush window */
  BATCH_WINDOW_MS: 50,
  /** MessageBatcher max items before immediate flush */
  BATCH_MAX_SIZE: 100,
  /** LocalAgentDiscovery timeout */
  LOCAL_DISCOVERY_TIMEOUT_MS: 50,
} as const;

export const LIMITS = {
  /** Max WS message size (10MB) */
  MAX_PAYLOAD_BYTES: 10 * 1024 * 1024,
  /** Port agent broadcasts for local discovery */
  LOCAL_AGENT_DISCOVERY_PORT: 4242,
  /** Max retry attempts for queue items */
  QUEUE_MAX_ATTEMPTS_OUTBOUND: 10,
  QUEUE_MAX_ATTEMPTS_INBOUND: 5,
} as const;

// PLAN_AGENT_LIMITS was removed 2026-09-22: it duplicated PLAN_LIMITS[plan].maxAgents,
// which now lives in packages/shared (planLimits.ts) and is what the hub reads.
