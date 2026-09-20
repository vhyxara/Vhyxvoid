// ─────────────────────────────────────────────────────────────────────────────
// packages/protocol/src/closeCode.ts
// WebSocket close codes that may be SENT on the wire.
//
// A peer that closes without a status code is reported as 1005, an abnormal
// termination as 1006, and a failed TLS handshake as 1015 — all three are
// reserved "never send this" values, and `ws` throws when asked to close with
// them (also 1004 and anything outside 1000-4999). The tunnel relays close
// codes between two independent sockets, so every hop must translate a code it
// *received* into one it may *send*. Used by both the hub and the agent.
// See internal-tools/shared/ws-tunnel-design.md, D7.
// ─────────────────────────────────────────────────────────────────────────────

export function toSendableCloseCode(code: number | undefined | null): number {
  if (typeof code !== "number" || !Number.isInteger(code)) return 1011;
  if (code === 1005) return 1000; // "no status received" — the peer just closed cleanly
  if (code >= 1000 && code <= 1003) return code;
  if (code >= 1007 && code <= 1014) return code;
  if (code >= 3000 && code <= 4999) return code;
  return 1011; // 1004, 1006, 1015, and anything unassigned/out of range
}
