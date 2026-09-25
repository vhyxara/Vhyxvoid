# Backlog — apps/hub

Small, already-diagnosed, non-urgent items — not the big architectural
questions tracked in context.md's Known Risks/Gaps (numbered items). When an item here is fixed, move it (original text unchanged) to
`internal-tools/archive/hub-backlog.md` with a `Resolved <date>, <commit/session>,
<one-line fix>` line; don't check it off here and don't delete it outright.

**Scope: apps/hub (tunnel router/WS server).**

## Backlog

- [ ] `tests/e2e/subdomainRegistryRace.test.ts` -- "operations on different labels are not serialized against each other" asserts wall-clock `elapsed < 35` on a ~20ms operation, so it flakes under CPU load (seen 43ms and 79ms; passes most runs and on a full-suite rerun). Assert on ordering/concurrency (e.g. both operations in flight at once) instead of elapsed time, or widen the margin. Found 2026-09-22, error-handler verification session.
- [ ] Public-path usage counts a request that then gets 503 "Tunnel is registered but agent is not connected": `PublicPathUsageLimiter.checkRequest()` records monthly usage before `HttpTunnelHandler.handle()` looks the agent up, so a stale subdomain entry's traffic is counted though it never reached an agent (the limiter's own comment says only allowed-and-forwarded requests should count). Minor, soft counter. Found 2026-09-24.
- [ ] `POST /internal/proxy` (`HubServer.ts`) sends the agent `type: 'http_request'`, which neither `packages/protocol` nor the agent handles, so it can't reach a backend at all (the audit listed it as an H9 SSRF route; it isn't one). Its only caller, `apps/api`'s `tunnelProxy` route, can't authenticate either (api backlog). Remove both, or rebuild on `tunnel:forward` with the H9 path check. Found 2026-09-24, audit H9 session.
- [ ] A sweep eviction (account or key, `AccountStatusSweep.evict`) leaves the agent's `tunnel:sub:<slug>--<label>` Redis entry behind; it's only removed when the next public request finds no live agent (`HttpTunnelHandler`'s compare-and-delete), and `HeartbeatService`'s eviction likely does the same. Harmless for routing (503 then cleanup) but it leaks a key per evicted agent until then. Seen live 2026-09-24 (H3 session: two leftover entries after revoke/expiry evictions). Fix: call `subdomainRegistry.unregister(label, slug, agentId)` in both evictions.
- [ ] **One large response blocks every tenant (audit part2 G12).** Every `tunnel:response` is `JSON.parse`d plus base64-decoded on the hub's single event loop; a 10 MB body costs tens of ms of head-of-line blocking for all tunnels. Fix belongs with part2 A2 (binary streaming) / worker threads; measure with stress scenario S5. See `shared/audit-2026-09-24-part2.md` G12. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Feature proposals (audit part2), hub side:** F2 tunnel access policies (public / password / members-only via dashboard session / IP allowlist / expiring share links), F4 webhook inbox (store while offline, replay on reconnect, provider signature helpers), F8 traffic policy / mock rules (rewrites, header injection, latency/error injection, offline mocks). See `shared/audit-2026-09-24-part2.md` section 5. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
