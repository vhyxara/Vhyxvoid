# Backlog — apps/admin

Small, already-diagnosed, non-urgent items — not the big architectural
questions tracked in context.md's Known Risks/Open Questions. When an item here is fixed, move it (original text unchanged) to
`internal-tools/archive/admin-frontend-backlog.md` with a `Resolved <date>, <commit/session>,
<one-line fix>` line; don't check it off here and don't delete it outright.

**Scope: apps/admin.**

## Backlog

- [ ] No admin password-reset/change endpoint exists in `apps/api`
  (`updateAdminSchema` is firstName/lastName only). Backend issue, not
  actionable from this app — see `internal-tools/api/backlog.md`. No UI
  planned for it until the backend has it.
- [ ] No session-bootstrap-on-reload flow exists — `AdminAuthGuard` only
  checks the zustand store's already-hydrated `isAuthenticated` on mount;
  there's no explicit "verify the stored token is still valid" call
  before rendering protected content. Low risk today (a stale/invalid
  token just fails on the first real request and triggers the normal
  401→refresh→retry-or-logout path), but worth a deliberate pass once the
  dashboard shell gets built out for real (screen 2 is still a
  placeholder).
- [ ] Refresh-token reuse-detection (confirmed 2026-09-17,
  decision.md) revokes ALL of an admin's sessions the moment one rotated-
  away refresh token is reused — including legitimately if, e.g., two
  browser tabs both hold a stale pre-refresh token and both try to use
  it. `http.ts`'s single-flight refresh queue already prevents this
  *within one tab* (concurrent 401s share one refresh call), but it does
  nothing for genuinely separate tabs/windows. Not fixed — no session
  data yet on whether this is a real problem for how admins will actually
  use this app; flag if it comes up.
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
- [ ] `useResolvedMode()`-equivalent dark-mode wiring doesn't exist yet —
  `apps/admin` has no theme/mode switcher at all (VhyxUI's tokens default
  to light unless `data-theme="dark"` is set somewhere). Deferred
  deliberately this session (not asked for, not needed to prove the auth
  stack) — revisit once there's a real settings/profile screen to host
  a toggle.
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
- [ ] Three `apps/api`-owned feedback-module findings from Screen 7,
  not actionable from this app — see `internal-tools/api/backlog.md`:
  no audit logging on feedback triage updates, 4 extra DB round trips per
  list call for the status counts, and a non-standard `{error: "..."}`
  400 envelope on the empty-update-payload guard.
- [ ] `DashboardShell` shows only `admin.email`; nothing renders the signed-in admin's name, so `useUpdateAdmin`'s session-store `fullName` sync (kept, tested) is invisible. Show the name (or name + email) in the header if that is wanted; then the sync starts to matter. Found 2026-09-22.
- [ ] A hard load of a deep link while signed in (e.g. typing `/admin-users`) ends up on `/dashboard`; in-app navigation is fine. Observed in the 2026-09-22 Chrome pass, not root-caused; consistent with the "no session-bootstrap-on-reload" item above. Found 2026-09-22.
- [ ] Standing test admins in the local dev DB with the shared test password `Admin@123` (a convention set 2026-09-22 for everything created from here on): `ada.verify@company.local` (created through the Create Admin dialog, holds the "Support Agent" role, name edited to "Adaline Verify") and `contract-check@company.local` (created by curl during the contract check, named "Conrad Tracton" by the PUT probe, and with its original password `Contract@1234`, no roles). No delete route exists for admins, so neither can be removed via the API. Found 2026-09-22.

## Admin Panel v2 — API gaps (found 2026-09-22, plan in `context.md` "Plan — Admin Panel v2"; nothing built)

Sizes: S = one small route; M = new use case/queries/design; L = needs its own decision. Backend work in `apps/api`/`apps/hub`, not this app. New abilities needed: `system.read`, `tunnel.read`, `account.read`, `account.update` (add to `SYSTEM_ABILITIES`, re-run `seed-abilities` in prod); every write must write an `AdminAuditLog` row.

- [ ] **Phase 0 decision (blocks Phase 1 being useful):** `apps/admin` has no production deployment. Recommendation written 2026-09-22 (`decision.md`, `context.md` "Hosting and access control"): VPS + Cloudflare Access + same-origin admin API; awaiting Tanveer's approval, then its next-steps list.
- [ ] H1 (S-M) `GET /admin/system/overview`: aggregator, each subsystem returns its own `{status, latencyMs, checkedAt, message}`; one failing dependency must not fail the response. `system.read`.
- [ ] H2 (M) Postgres probe: `SELECT 1` latency, `version()`, `pg_database_size`, `pg_stat_activity` count, `pg_stat_user_tables` estimates for `tunnel_requests`/`tunnel_sessions`/`AdminAuditLog`; migration reconcile of `_prisma_migrations` vs the migrations dir (applied / failed / rolled back / pending / orphaned-in-DB, e.g. `20260426101925_serverboot`). Confirm the runtime image ships `prisma/migrations`. On-demand only (Neon autosuspend).
- [ ] H3 (S) Redis probe: PING RTT + set/get/del round-trip on a short-TTL key. Spike first whether `INFO`/`DBSIZE` work through `@upstash/redis` and what they return (Upstash REST docs do not say). Short server-side cache; Upstash bills per command.
- [ ] H4 (M) Hub `GET /internal/stats` (+ agent list): agents, sdks, `PendingRegistry.size()`, `TunnelWsRegistry.size()`, uptime, heap, instanceId; reuse the `/internal/proxy` shared-secret pattern (`isInternalRequestAuthorized`). Set `HUB_INTERNAL_URL` (`http://hub:9001`) and `HUB_INTERNAL_SECRET` in production api/hub env (documented "dev only" today).
- [ ] H5 (S-M) Cert probe: TLS handshake from the api container to `nginx:443` per SNI (api., hub., a tunnel host), report `notAfter`/SAN/issuer/days left. Do not probe public `api.`/`hub.` (Cloudflare edge cert). Spike first: does the handshake complete despite the HTTP-level Cloudflare allow-list.
- [ ] H6 (M) Hub counters that do not exist: dropped/unroutable WS frames, pending timeouts, 502/504 counts (WS Phase 1 fixed the loss but added no metrics). Error rate/latency already derivable from `TunnelRequest`.
- [ ] H7 (M, optional) Upstash Developer API (`GET /redis/database/{id}/stats`; email + API key Basic auth) and Neon API (`https://console.neon.tech/api/v2`, `NEON_API_KEY`: endpoint state, consumption, failed operations). New secrets; only if H2/H3 prove insufficient.
- [ ] H8 (S) Build info: pass `GIT_SHA`/build time into `Dockerfile.api`/`Dockerfile.hub`; expose in the overview and a read-only runtime-config route (`TIMING` constants, booleans for which required env vars are set, never values).
- [ ] A1/A2 (M) Admin account list/search and detail aggregate (subscription, members, key counts, recent `TunnelSession`, usage vs limits, invoices). The admin module has no account/user/subscription queries today. `account.read`.
- [ ] A3 (M-L, needs a decision) Admin suspend/reactivate account: `Account.status` is honored only at connect time, so suspend must also evict live sessions on the hub (`closeAllForAgent` covers tunnel-WS only); interacts with E6/E7. `account.update`.
- [ ] A4 (M) Revoke an API key as an admin (existing use cases take a *user* context). Optional safe companion: invalidate one key's Redis cache entry (`RedisApiKeyCache.del`).
- [ ] A5 (L, recommend NOT building) Admin plan/limit override: touches the flat-rate model and Stripe-as-source-of-truth. Use a Stripe-dashboard link-out via `stripeCustomerId` instead.
- [ ] A6 (S) `GET /admin/system/plan-limits`: `PLAN_LIMITS` per plan plus an enforcement classification from an exhaustive `Record<keyof PlanLimits, 'enforced'|'partial'|'none'>` colocated with it (TypeScript forces classifying new keys; same idea as the docs generator's allowlist).
- [ ] Enforcement gaps the panel must not paper over (separate backend work; most are already in `internal-tools/shared/backlog.md`): **Re-verified against the code 2026-09-22; authoritative detail and fix plan in `internal-tools/shared/context.md` Known Risks #57 and `shared/decision.md` (sessions S1-S4). None of the fixes below are deployed.** E1 hub applies the real plan's agent limit (`FREE 1 / PRO 5 / ENTERPRISE unlimited`) with a same-label-reconnect exclusion — **FIXED IN SOURCE by S3 (`a967c03`)**, was `PLAN_AGENT_LIMITS.PRO` (5) applied to every account; E2 a cache reload now carries the real plan's rate limit instead of resetting to `-1`, and ENTERPRISE's non-finite limit no longer becomes a cached `null` that gets rejected as zero — **FIXED IN SOURCE by S1+S3 (E2b) and S3 (the reload itself)**, still open: the window before the very first post-invalidate reload has no cached entry at all (not a bypass — the DB-loader path applies the real limit before caching); E3 public HTTP tunnel (`HttpTunnelHandler.handle`) checks no key, account status or rate, by design (per-key limits cannot apply there) — unchanged, S5; E4 the dead `rateLimitPerMinute` field on the agent handshake is **removed by S3** rather than left unread; E5 `maxMembers` **FIXED IN SOURCE by S2 (`9f246be`)** — counted (members + pending) at invite time, re-checked at accept time; `maxRequestsPerMonth`/`customDomains`/retention unchanged, S5/S6; E6 **FIXED IN SOURCE by S4 (`2465450`)** — `PAST_DUE` now connects (the grace period keeps tunnels running, not just limits), status reaches the hub within seconds of a real change (a new per-account cache invalidator), and a hub sweep (~60s) evicts a connected agent whose account stops being connectable, with a real reason sent first; only SUSPENDED/RESTRICTED/CANCELED/DELETED are refused; E7 `GracePeriodWorker` is registered and running and, as of S1 (`c8b98e6`), the webhook sets a real deadline so `PAST_DUE` does auto-suspend after 7 days. For the admin UI's enforcement matrix (once S1-S4 are deployed): `maxAgents`/`maxMembers` enforced (real plan); `rateLimitPerMinute` partial (SDK path only — most traffic is agents/tunnel-URL, never checked); `maxRequestsPerMonth`/`customDomains`/retention none; PAST_DUE grace: deadline real, connectivity kept, live-evicted on suspension.

## Found 2026-09-22 (hosting / production investigation)

- [ ] **Production has no admin user, ability or role rows** (the whole database is empty), so no one can log in to the admin panel there. `seed-super-admin.ts` creates `admin@company.local` / `Admin@12345678` and there is no admin password change/reset endpoint, so do not run it as-is in production: parameterize the email/password (env) first, then run `seed-abilities`, `seed-roles`, `seed-super-admin` against production deliberately. **Update 2026-09-25 (session 2026-09-25-decisions-and-e2e, 3eecfae):** the seed is parameterized (SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD, 16+ chars required in production, password never printed; code-archive/api/CA-0033). Still to do: run seed-abilities, seed-roles, seed-super-admin against production deliberately.
- [ ] The admin API is reachable on `api.vhyxvoid.com` today (`GET /api/v1/admin/identity/me` -> 403 from the internet). Block `/api/v1/admin/` on the `api.` nginx block once the admin host proxies it (part of the hosting plan).
- [ ] `apps/admin` builds only with the sibling repos `VhyxUI` and `vhyx-api-kit` checked out beside this one (`link:`). `@vhyx/api-kit` is not on npm; `@vhyxui/react` on npm (`0.1.0-alpha.1`) is older than what the code uses (`0.3.1-alpha`). Any Docker/CI/Vercel build needs an off-box build with all three repos or published packages; CI already excludes `apps/web` for the same reason.
- [ ] `apps/admin`'s three `[id]` detail routes are client-only; if a static export is ever wanted, they need query-string ids or a rewrite fallback.
- [ ] `pnpm turbo run typecheck`/`build` fail on `@vhyxvoid/admin` (15 errors, `TS7006` implicit-any on `@vhyxui/react` callbacks plus one prop-type mismatch), same root cause as `apps/web`'s (user-frontend backlog): the sibling `../VhyxUI` checkout has no `node_modules`, so `@vhyxui/react`'s dependencies don't resolve. Surfaced 2026-09-24 when a lockfile change invalidated turbo's cached admin typecheck; `apps/admin`'s own sources are unchanged, and swapping its one relinked dependency (`next`'s peer variant) back made no difference. Fix: `pnpm install` in `../VhyxUI`.
