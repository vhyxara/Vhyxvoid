# Backlog — apps/admin

Small, already-diagnosed, non-urgent items — not the big architectural
questions tracked in context.md's Known Risks/Open Questions. When an item here is fixed, move it (original text unchanged) to
`internal-tools/archive/admin-frontend-backlog.md` with a `Resolved <date>, <commit/session>,
<one-line fix>` line; don't check it off here and don't delete it outright.

**Scope: apps/admin.**

## Backlog

- [ ] Three disposable custom roles remain as standing rows in the local
  dev DB (no delete/deactivate route exists for roles, confirmed
  2026-09-17 — see context.md/decision.md — so none can be cleaned up via
  the API; harmless as standing test data, same convention as
  `LOCAL_DEV_BACKEND.md`'s test accounts, but worth knowing if the Roles
  list ever needs to look "clean" for a demo): "Support Agent"
  (`c03d5e80-ee58-4675-857b-292459f1b836`, holds the `audit.read`
  ability, Screen 4 session, 2026-09-17), "Screen4 Verify Role"
  (`0ee4f177-8bc9-4fd0-a044-34145f8f78a7`, Screen 4 session, 2026-09-17),
  and "Chrome Verify Role" (created during the Create Role dialog check,
  chrome-visual verification pass, 2026-09-18).
- [ ] Two disposable feedback rows from Screen 7's investigation/
  verification remain as standing rows in the local dev DB: a `BUG_REPORT`
  (`8341d98e-2e4f-4a6e-9bf1-d60d0f79c059`, status `UNDER_REVIEW`, priority
  `HIGH`, has real adminNotes) and a `FEATURE_REQUEST`
  (`2297d2f6-5aee-472d-89bc-9c1e2e28a072`, status `RESOLVED`, priority
  `LOW`, has real adminNotes), both submitted via `test@example.com`. No
  delete endpoint exists for feedback (confirmed via grep, same situation
  as Roles), so neither can be cleaned up via the API; harmless as
  standing test data but worth knowing if the Feedback list ever needs to
  look "clean" for a demo. Found 2026-09-17.
- [ ] Standing test admins in the local dev DB with the shared test password `Admin@123` (a convention set 2026-09-22 for everything created from here on): `ada.verify@company.local` (created through the Create Admin dialog, holds the "Support Agent" role, name edited to "Adaline Verify") and `contract-check@company.local` (created by curl during the contract check, named "Conrad Tracton" by the PUT probe, and with its original password `Contract@1234`, no roles). No delete route exists for admins, so neither can be removed via the API. Found 2026-09-22.

## Admin Panel v2 — API gaps (found 2026-09-22, plan in `context.md` "Plan — Admin Panel v2"; nothing built)

Sizes: S = one small route; M = new use case/queries/design; L = needs its own decision. Backend work in `apps/api`/`apps/hub`, not this app. New abilities needed: `system.read`, `tunnel.read`, `account.read`, `account.update` (add to `SYSTEM_ABILITIES`, re-run `seed-abilities` in prod); every write must write an `AdminAuditLog` row.

- [ ] H5 (S-M) Cert probe: TLS handshake from the api container to `nginx:443` per SNI (api., hub., a tunnel host), report `notAfter`/SAN/issuer/days left. Do not probe public `api.`/`hub.` (Cloudflare edge cert). Spike first: does the handshake complete despite the HTTP-level Cloudflare allow-list.
- [ ] H6 (M) Hub counters that do not exist: dropped/unroutable WS frames, pending timeouts, 502/504 counts (WS Phase 1 fixed the loss but added no metrics). Error rate/latency already derivable from `TunnelRequest`.
- [ ] H7 (M, optional) Upstash Developer API (`GET /redis/database/{id}/stats`; email + API key Basic auth) and Neon API (`https://console.neon.tech/api/v2`, `NEON_API_KEY`: endpoint state, consumption, failed operations). New secrets; only if H2/H3 prove insufficient.
- [ ] Enforcement gaps the panel must not paper over (separate backend work; most are already in `internal-tools/shared/backlog.md`): **Re-verified against the code 2026-09-22; authoritative detail and fix plan in `internal-tools/shared/context.md` Known Risks #57 and `shared/decision.md` (sessions S1-S4). None of the fixes below are deployed.** E1 hub applies the real plan's agent limit (`FREE 1 / PRO 5 / ENTERPRISE unlimited`) with a same-label-reconnect exclusion — **FIXED IN SOURCE by S3 (`a967c03`)**, was `PLAN_AGENT_LIMITS.PRO` (5) applied to every account; E2 a cache reload now carries the real plan's rate limit instead of resetting to `-1`, and ENTERPRISE's non-finite limit no longer becomes a cached `null` that gets rejected as zero — **FIXED IN SOURCE by S1+S3 (E2b) and S3 (the reload itself)**, still open: the window before the very first post-invalidate reload has no cached entry at all (not a bypass — the DB-loader path applies the real limit before caching); E3 public HTTP tunnel (`HttpTunnelHandler.handle`) checks no key, account status or rate, by design (per-key limits cannot apply there) — unchanged, S5; E4 the dead `rateLimitPerMinute` field on the agent handshake is **removed by S3** rather than left unread; E5 `maxMembers` **FIXED IN SOURCE by S2 (`9f246be`)** — counted (members + pending) at invite time, re-checked at accept time; `maxRequestsPerMonth`/`customDomains`/retention unchanged, S5/S6; E6 **FIXED IN SOURCE by S4 (`2465450`)** — `PAST_DUE` now connects (the grace period keeps tunnels running, not just limits), status reaches the hub within seconds of a real change (a new per-account cache invalidator), and a hub sweep (~60s) evicts a connected agent whose account stops being connectable, with a real reason sent first; only SUSPENDED/RESTRICTED/CANCELED/DELETED are refused; E7 `GracePeriodWorker` is registered and running and, as of S1 (`c8b98e6`), the webhook sets a real deadline so `PAST_DUE` does auto-suspend after 7 days. For the admin UI's enforcement matrix (once S1-S4 are deployed): `maxAgents`/`maxMembers` enforced (real plan); `rateLimitPerMinute` partial (SDK path only — most traffic is agents/tunnel-URL, never checked); `maxRequestsPerMonth`/`customDomains`/retention none; PAST_DUE grace: deadline real, connectivity kept, live-evicted on suspension.

## Found 2026-09-22 (hosting / production investigation)

- [ ] **Production has no admin user, ability or role rows** (the whole database is empty), so no one can log in to the admin panel there. `seed-super-admin.ts` creates `admin@company.local` / `Admin@12345678` and there is no admin password change/reset endpoint, so do not run it as-is in production: parameterize the email/password (env) first, then run `seed-abilities`, `seed-roles`, `seed-super-admin` against production deliberately. **Update 2026-09-25 (session 2026-09-25-decisions-and-e2e, 3eecfae):** the seed is parameterized (SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD, 16+ chars required in production, password never printed; code-archive/api/CA-0033). Still to do: run seed-abilities, seed-roles, seed-super-admin against production deliberately.
- [ ] `apps/admin`'s three `[id]` detail routes are client-only; if a static export is ever wanted, they need query-string ids or a rewrite fallback.
- [ ] Still not built from the admin-v2 plan: H5 certificate probe, H6 hub counters (dropped frames, pending timeouts, 502/504), H7 Upstash/Neon provider APIs. The System page shows Postgres, Redis, hub and build info. Re-listed 2026-10-05, session upbeat-cannon.
- [ ] Production still needs its first admin: after deploy run `docker compose exec api node bootstrap.js seed` with `SUPER_ADMIN_*` set (docs/operators/deployment). Tooling added 2026-10-05 (e51b17d), session upbeat-cannon; the action itself is the operator's.
