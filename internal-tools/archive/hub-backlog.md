# Backlog archive — hub

Resolved items from `internal-tools/hub/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: apps/hub.**

## Archive

- [ ] **A revoked or expired API key's live agent keeps serving.** Key status is checked only at the `agent:register` handshake (`HubAuthService.authenticateAgent`); `AccountStatusSweepService` re-checks account status every ~60s but never key status, and nothing on the hub reacts to a revoke. So revoking a key stops new connections but an already-connected agent keeps tunnelling public traffic (and counting usage) until it disconnects on its own. Same class as E6 (fixed for account status in S4, `2465450`); the sweep's batched lookup could carry key status too. Confirmed by code reading 2026-09-24 (usage-drain fix session), while scoping why accounts with no ACTIVE key can still have pending usage. Not exercised live.
Resolved 2026-09-24, 621ee3f (docs 6b65972), AccountStatusSweep re-checks each connection's key (status, expiry, rotation grace via a secret fingerprint) every ~60 s and evicts with the reason; audit H3.
