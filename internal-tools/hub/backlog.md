# Backlog — apps/hub

Small, already-diagnosed, non-urgent items — not the big architectural
questions tracked in context.md's Known Risks/Gaps (numbered items). When an item here is fixed, move it (original text unchanged) to
`internal-tools/archive/hub-backlog.md` with a `Resolved <date>, <commit/session>,
<one-line fix>` line; don't check it off here and don't delete it outright.

**Scope: apps/hub (tunnel router/WS server).**

## Backlog

- [ ] **One large response blocks every tenant (audit part2 G12).** Every `tunnel:response` is `JSON.parse`d plus base64-decoded on the hub's single event loop; a 10 MB body costs tens of ms of head-of-line blocking for all tunnels. Fix belongs with part2 A2 (binary streaming) / worker threads; measure with stress scenario S5. See `shared/audit-2026-09-24-part2.md` G12. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Feature proposals (audit part2), hub side:** F2 tunnel access policies (public / password / members-only via dashboard session / IP allowlist / expiring share links), F4 webhook inbox (store while offline, replay on reconnect, provider signature helpers), F8 traffic policy / mock rules (rewrites, header injection, latency/error injection, offline mocks). See `shared/audit-2026-09-24-part2.md` section 5. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] Inspector: WebSocket frames are not captured (only the upgrade request's tunnel traffic around it); replay is HTTP only. Found 2026-10-06, session upbeat-cannon.
- [ ] Multi-hub: TunnelPolicyCache invalidation reaches only the hub the API calls (HUB_INTERNAL_URL); other instances wait out the 30 s TTL. Publish invalidations over HubPubSub when multi-hub lands. Found 2026-10-06, session upbeat-cannon.
- [ ] Webhook inbox: delivery is sequential per tunnel and one tunnel per sweep tick runs to completion before the next; a tunnel with thousands waiting delays others on the same hub for that tick. Bound per-tick work (e.g. 100 per tunnel) once there are real numbers. Found 2026-10-06, session upbeat-cannon.
- [ ] Webhook inbox: stored bodies/headers sit in Postgres in clear text for up to 7 days (masked in responses). Consider encrypting `body` and `headers` at rest with a key from env. Found 2026-10-06, session upbeat-cannon.
- [ ] Multi-hub: custom-domain cache invalidation (`/internal/domains/invalidate`) reaches only the hub the API calls; others wait out the 60 s TTL. Same fix as the policy cache (HubPubSub). Found 2026-10-06, session upbeat-cannon.
- [ ] Custom domains: WebSocket upgrades on a custom host are routed, but the inspector/stats only see the upgrade request (same as subdomains). Found 2026-10-06, session upbeat-cannon.
- [ ] Multi-hub: `PasswordGuessLimiter` (tunnel password guesses) is in-process per hub like the public-path limiter, so N hubs allow N x 10 guesses a minute per address. Move to Redis when multi-hub lands. Found 2026-10-06, session production-stable.
- [ ] Traffic rules: WebSocket upgrades bypass rules entirely (documented); mocks are text only (no binary bodies); no per-rule hit counter. Add if customers ask. Found 2026-10-06, session production-stable.
- [ ] Multi-hub: the traffic-rule cache is invalidated only on the hub the API calls (same as access rules); others wait out 30 s. Same HubPubSub fix. Found 2026-10-06, session production-stable.
- [ ] Mock APIs: "each in turn" (sequential) counters are per hub instance and reset when the mock is saved; with several hubs the sequence interleaves. Move counters to Redis (INCR per mock+endpoint) if users depend on exact order. Found 2026-10-06, session upbeat-cannon.
- [ ] Mock APIs: WebSocket upgrades on a mocked label are not mocked (they go to the agent or fail as before). Found 2026-10-06, session upbeat-cannon.

