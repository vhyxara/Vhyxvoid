// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/errors.ts
// ─────────────────────────────────────────────────────────────────────────────

export type HubErrorCode =
  | "AUTH_FAILED"
  | "KEY_REVOKED"
  | "KEY_EXPIRED"
  | "SCOPE_MISSING"
  | "VERSION_UNSUPPORTED"
  | "RATE_LIMITED"
  | "AGENT_LIMIT_REACHED"
  | "INVALID_MESSAGE"
  | "INTERNAL_ERROR";

export type TunnelErrorCode =
  | "AGENT_NOT_FOUND"
  | "AGENT_DISCONNECTED"
  | "AGENT_TIMEOUT"
  | "BACKEND_UNAVAILABLE"
  | "BACKEND_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "FORBIDDEN_SCOPE";

/** WS close codes (4000-4999 = application level) */
export const WS_CLOSE_CODES = {
  AUTH_FAILED: 4001,
  VERSION_UNSUPPORTED: 4002,
  AGENT_LIMIT_REACHED: 4003,
  RATE_LIMITED: 4004,
  INTERNAL_ERROR: 4999,
} as const;
