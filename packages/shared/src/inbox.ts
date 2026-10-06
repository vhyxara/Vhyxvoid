// packages/shared/src/inbox.ts
//
// Webhook inbox rules (Prisma models TunnelInbox, InboxRequest). While a
// tunnel's agent is offline the hub stores requests for it instead of
// answering 404/503; when the agent reconnects the hub delivers them, oldest
// first, through the normal tunnel path. apps/api lists and manages them.
//
// What counts as delivered: any response produced by the user's app,
// including 4xx (the app answered; the user can redeliver after fixing it).
// The app's 5xx is retried with backoff up to INBOX_MAX_ATTEMPTS. A response
// produced by the hub itself (tunnel offline again, agent timeout) is not an
// attempt at all: delivery pauses until the tunnel is back.

export const INBOX_BODY_MAX_BYTES = 1024 * 1024;
export const INBOX_RETENTION_DAYS = 7;
export const INBOX_MAX_ATTEMPTS = 8;
/** Status the sender gets when a request is stored. */
export const INBOX_ACK_STATUS = 202;
/** Header the hub puts on responses it generated itself (errors), so callers can tell them from the app's. */
export const HUB_ERROR_HEADER = "x-vhyxvoid-error";
/** Marks a delivery the hub sends to itself (with the internal secret). */
export const INBOX_DELIVERY_HEADER = "x-vhyxvoid-inbox";

/** Webhooks are writes; reads to an offline tunnel still get 404/503. */
export function isInboxMethod(method: string | undefined): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes((method ?? "").toUpperCase());
}

/** Wait before attempt n+1 after n failed attempts: 30 s, 1 m, 2 m … capped at 1 h. */
export function inboxBackoffMs(attempts: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

export type DeliveryOutcome =
  | { state: "DELIVERED" }
  /** The tunnel is not reachable right now: not an attempt, keep it queued and stop draining. */
  | { state: "PAUSED"; reason: string }
  | { state: "RETRY"; nextAttemptAt: Date; reason: string }
  | { state: "FAILED"; reason: string };

/** Hub error codes that mean "not reachable right now" rather than "the app failed". */
export const INBOX_PAUSE_CODES: ReadonlySet<string> = new Set(["TUNNEL_OFFLINE", "RATE_LIMITED", "ACCESS_DENIED"]);

/**
 * What a delivery attempt means.
 * @param hubError value of HUB_ERROR_HEADER on the response (set only on hub-made responses)
 * @param attempts attempts made so far, including this one
 */
export function deliveryOutcome(status: number | null, hubError: string | null, attempts: number, now = Date.now()): DeliveryOutcome {
  if (status === null) return { state: "PAUSED", reason: hubError ?? "No response from the hub" };
  if (hubError && INBOX_PAUSE_CODES.has(hubError)) return { state: "PAUSED", reason: hubError };
  if (!hubError && status < 500) return { state: "DELIVERED" };
  // The app's own 5xx, or the agent could not get an answer from it
  // (AGENT_TIMEOUT, BACKEND_UNREACHABLE, …): a real attempt, retried.
  const reason = hubError ? `Your app did not answer (${hubError})` : `Your app answered ${status}`;
  if (attempts >= INBOX_MAX_ATTEMPTS) return { state: "FAILED", reason };
  return { state: "RETRY", nextAttemptAt: new Date(now + inboxBackoffMs(attempts)), reason };
}

/** Headers stored for delivery: hop-by-hop and hub-internal ones dropped. */
export function inboxStoredHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const drop = new Set([
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "proxy-connection",
    "x-vhyxvoid-internal",
    "x-vhyxvoid-replay-of",
    INBOX_DELIVERY_HEADER,
  ]);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || drop.has(lower)) continue;
    out[lower] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}
