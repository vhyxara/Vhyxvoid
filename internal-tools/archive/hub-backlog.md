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
- [ ] `tests/e2e/subdomainRegistryRace.test.ts` -- "operations on different labels are not serialized against each other" asserts wall-clock `elapsed < 35` on a ~20ms operation, so it flakes under CPU load (seen 43ms and 79ms; passes most runs and on a full-suite rerun). Assert on ordering/concurrency (e.g. both operations in flight at once) instead of elapsed time, or widen the margin. Found 2026-09-22, error-handler verification session.
  Resolved 2026-09-25, 96e9c69 (session 2026-09-25-backlog-sweep), asserts both SETs are in flight at once instead of elapsed time; code-archive/hub/CA-0013.
- [ ] Public-path usage counts a request that then gets 503 "Tunnel is registered but agent is not connected": `PublicPathUsageLimiter.checkRequest()` records monthly usage before `HttpTunnelHandler.handle()` looks the agent up, so a stale subdomain entry's traffic is counted though it never reached an agent (the limiter's own comment says only allowed-and-forwarded requests should count). Minor, soft counter. Found 2026-09-24.
  Resolved 2026-09-25, 96e9c69 (session 2026-09-25-backlog-sweep), checkRequest() only rate-checks; recordForwarded() counts once a live agent has the request; code-archive/hub/CA-0010.
- [ ] `POST /internal/proxy` (`HubServer.ts`) sends the agent `type: 'http_request'`, which neither `packages/protocol` nor the agent handles, so it can't reach a backend at all (the audit listed it as an H9 SSRF route; it isn't one). Its only caller, `apps/api`'s `tunnelProxy` route, can't authenticate either (api backlog). Remove both, or rebuild on `tunnel:forward` with the H9 path check. Found 2026-09-24, audit H9 session.
  Resolved 2026-09-25, 96e9c69 (session 2026-09-25-backlog-sweep), removed the route and apps/api's tunnelProxy caller; internalAuth.ts kept for H4 /internal/stats; code-archive/hub/CA-0012.
- [ ] A sweep eviction (account or key, `AccountStatusSweep.evict`) leaves the agent's `tunnel:sub:<slug>--<label>` Redis entry behind; it's only removed when the next public request finds no live agent (`HttpTunnelHandler`'s compare-and-delete), and `HeartbeatService`'s eviction likely does the same. Harmless for routing (503 then cleanup) but it leaks a key per evicted agent until then. Seen live 2026-09-24 (H3 session: two leftover entries after revoke/expiry evictions). Fix: call `subdomainRegistry.unregister(label, slug, agentId)` in both evictions.
  Resolved 2026-09-25, 96e9c69 (session 2026-09-25-backlog-sweep), heartbeat and sweep evictions call releaseSubdomain() (compare-and-delete unregister); code-archive/hub/CA-0011.
