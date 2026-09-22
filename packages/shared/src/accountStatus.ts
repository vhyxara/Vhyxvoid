// packages/shared/src/accountStatus.ts
//
// The single definition of "can this account's agents talk to the hub right
// now" — replaces two independently-hand-written `!== 'ACTIVE'` tests that
// used to live in apps/hub's HubAuthService (agent handshake) and this
// package's own validateApiKey.ts (SDK request path). Both now import this.
//
// PAST_DUE is included deliberately: the seven-day grace period is meant to
// keep service running, not just keep plan limits in force (see
// shared/decision.md, 2026-09-22, "Answers to the E1-E7 open questions",
// answer 1). SUSPENDED/RESTRICTED/CANCELED/DELETED are not.
//
// This only decides "is a *new* connection/request from this status
// allowed." What happens to an *already-connected* agent when its account's
// status changes mid-session is apps/hub's own eviction sweep
// (Sweep.service.ts) — this constant is what that sweep checks against too,
// so the two can never disagree about what "connectable" means.

export const CONNECTABLE_ACCOUNT_STATUSES = ["ACTIVE", "PAST_DUE"] as const;

export type ConnectableAccountStatus =
  (typeof CONNECTABLE_ACCOUNT_STATUSES)[number];

export function isConnectableAccountStatus(status: string): boolean {
  return (CONNECTABLE_ACCOUNT_STATUSES as readonly string[]).includes(status);
}
