// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/constants.ts
// ─────────────────────────────────────────────────────────────────────────────

export const PROTOCOL_VERSION = "1" as const;

export const TIMING = {
  /** How long hub waits for agent response before timing out the SDK request */
  REQUEST_TIMEOUT_MS: 30_000,
  /** Buffer over REQUEST_TIMEOUT_MS for hub:pending Redis TTL */
  PENDING_TTL_MS: 32_000,
  /** Hub pings every N ms */
  HEARTBEAT_INTERVAL_MS: 10_000,
  /** Miss this many pings → agent evicted */
  MAX_MISSED_PINGS: 3,
  /** Redis presence key TTL (must be > HEARTBEAT_INTERVAL_MS) */
  AGENT_PRESENCE_TTL_SEC: 25,
  /** Agent reconnect: initial delay */
  RECONNECT_INITIAL_MS: 1_000,
  /** Agent reconnect: maximum delay cap */
  RECONNECT_MAX_MS: 300_000,
  /** Signature timestamp tolerance */
  SIGNATURE_WINDOW_MS: 60_000,
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

export const PLAN_AGENT_LIMITS = {
  FREE: 1,
  PRO: 5,
  ENTERPRISE: Infinity,
} as const;
