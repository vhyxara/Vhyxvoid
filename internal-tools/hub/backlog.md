# Backlog — apps/hub

Small, already-diagnosed, non-urgent items — not the big architectural
questions tracked in context.md's Known Risks/Gaps (numbered items). When an item here is fixed, move it (original text unchanged) to
`internal-tools/archive/hub-backlog.md` with a `Resolved <date>, <commit/session>,
<one-line fix>` line; don't check it off here and don't delete it outright.

**Scope: apps/hub (tunnel router/WS server).**

## Backlog

- [ ] **One large response blocks every tenant (audit part2 G12).** Every `tunnel:response` is `JSON.parse`d plus base64-decoded on the hub's single event loop; a 10 MB body costs tens of ms of head-of-line blocking for all tunnels. Fix belongs with part2 A2 (binary streaming) / worker threads; measure with stress scenario S5. See `shared/audit-2026-09-24-part2.md` G12. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Feature proposals (audit part2), hub side:** F2 tunnel access policies (public / password / members-only via dashboard session / IP allowlist / expiring share links), F4 webhook inbox (store while offline, replay on reconnect, provider signature helpers), F8 traffic policy / mock rules (rewrites, header injection, latency/error injection, offline mocks). See `shared/audit-2026-09-24-part2.md` section 5. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] Every public tunnel request still costs one Upstash GET (`SubdomainRegistry.resolve`). For today's single hub an in-process cache of `slug--label -> agentId` (seconds-long TTL, re-resolve on an agent-registry miss) would remove it. Found 2026-09-25 (`hub:pending` writes already removed, `3c66040`).
