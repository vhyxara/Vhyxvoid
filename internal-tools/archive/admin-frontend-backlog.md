# Backlog archive — admin-frontend

Resolved items from `internal-tools/admin-frontend/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: apps/admin.**

## Archive

- [ ] `apps/api` has no `trustProxy`, and its only limiter is a global `max 100 / 1 min` (`register.plugin.ts:45`), so behind nginx all clients likely share one bucket (inferred from config, not tested live). Set `trustProxy` for the nginx/Cloudflare hop and add a tighter per-IP limit on `POST /admin/identity/auth/login` (and the user login).
Resolved 2026-09-24, 5e255b0, trustProxy limited to loopback/private-network peers (nginx), limiter registered first, per-IP login limits (user 10/min, admin 5/min); audit H1.
- [ ] `apps/admin.routes.ts`'s orphaned duplicate JSDoc comment block
  (lines ~470-484) — backend cleanup, see `internal-tools/api/backlog.md`.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), removed the orphaned fragment from admin.routes.ts; code-archive/api/CA-0009.
- [ ] Same fire-and-forget `.mutate()` pattern that was fixed in apps/web
  (2026-09-19, `internal-tools/user-frontend/decision.md`, "FeedbackContext
  removed") is also present here: `AdminUsersTable.tsx`'s disable/enable
  row actions (`disableAdmin.mutate(row.id)`/`enableAdmin.mutate(row.id)`)
  and `AdminAbilitiesTable.tsx`'s delete action all call `.mutate()`, not
  `.mutateAsync()`. apps/admin has no `FeedbackContext`-equivalent global
  confirm/alert Dialog, so there's no unreachable-Dialog bug here — but the
  same loading-state-dishonesty class of bug is real: the confirmation
  dialog's loading spinner clears and the dialog closes the instant the
  action is invoked, not when the real request actually finishes, since
  `.mutate()` doesn't return a promise the caller's `await` can meaningfully
  wait on. Flagged, not fixed — out of scope for the apps/web-only session
  that found it (2026-09-19).
  Resolved 2026-09-25, fc9612c (session 2026-09-25-backlog-sweep), disable/enable admin, delete ability, revoke role/ability use mutateAsync; Confirmation shows the error; code-archive/admin-frontend/CA-0022.
- [ ] Three `apps/api`-owned feedback-module findings from Screen 7,
  not actionable from this app — see `internal-tools/api/backlog.md`:
  no audit logging on feedback triage updates, 4 extra DB round trips per
  list call for the status counts, and a non-standard `{error: "..."}`
  400 envelope on the empty-update-payload guard.
  Resolved 2026-10-05, uncommitted (session 2026-10-05-backlog-sweep), all three fixed in apps/api by b9c9f67 (session 2026-09-25-backlog-sweep; code-archive/api/CA-0001..CA-0003); moved here 2026-10-05 as a pointer item.
- [ ] No admin password-reset/change endpoint exists in `apps/api`
  (`updateAdminSchema` is firstName/lastName only). Backend issue, not
  actionable from this app — see `internal-tools/api/backlog.md`. No UI
  planned for it until the backend has it.
  Resolved 2026-10-05, b45824d + 5b3bc48 (session upbeat-cannon), POST /admin/identity/me/password and /users/:id/password (super admin), with Change password dialog and Set password card.
- [ ] No session-bootstrap-on-reload flow exists — `AdminAuthGuard` only
  checks the zustand store's already-hydrated `isAuthenticated` on mount;
  there's no explicit "verify the stored token is still valid" call
  before rendering protected content. Low risk today (a stale/invalid
  token just fails on the first real request and triggers the normal
  401→refresh→retry-or-logout path), but worth a deliberate pass once the
  dashboard shell gets built out for real (screen 2 is still a
  placeholder).
  Resolved 2026-10-05, 5b3bc48 (session upbeat-cannon), AdminAuthGuard bootstraps with a cookie refresh + /me before rendering; access token is memory-only.
- [ ] Refresh-token reuse-detection (confirmed 2026-09-17,
  decision.md) revokes ALL of an admin's sessions the moment one rotated-
  away refresh token is reused — including legitimately if, e.g., two
  browser tabs both hold a stale pre-refresh token and both try to use
  it. `http.ts`'s single-flight refresh queue already prevents this
  *within one tab* (concurrent 401s share one refresh call), but it does
  nothing for genuinely separate tabs/windows. Not fixed — no session
  data yet on whether this is a real problem for how admins will actually
  use this app; flag if it comes up.
  Resolved 2026-10-05, b45824d (session upbeat-cannon), 30 s rotation grace returns the successor to a second tab; refresh is single-flighted across tabs with navigator.locks (crossTabLock.ts).
- [ ] `useResolvedMode()`-equivalent dark-mode wiring doesn't exist yet —
  `apps/admin` has no theme/mode switcher at all (VhyxUI's tokens default
  to light unless `data-theme="dark"` is set somewhere). Deferred
  deliberately this session (not asked for, not needed to prove the auth
  stack) — revisit once there's a real settings/profile screen to host
  a toggle.
  Resolved 2026-10-05, 5b3bc48 (session upbeat-cannon), theme toggle in AdminShell (VhyxUIRoot theme context, persisted per browser).
- [ ] `DashboardShell` shows only `admin.email`; nothing renders the signed-in admin's name, so `useUpdateAdmin`'s session-store `fullName` sync (kept, tested) is invisible. Show the name (or name + email) in the header if that is wanted; then the sync starts to matter. Found 2026-09-22.
  Resolved 2026-10-05, 5b3bc48 (session upbeat-cannon), AdminShell's account menu shows avatar, full name and email.
- [ ] A hard load of a deep link while signed in (e.g. typing `/admin-users`) ends up on `/dashboard`; in-app navigation is fine. Observed in the 2026-09-22 Chrome pass, not root-caused; consistent with the "no session-bootstrap-on-reload" item above. Found 2026-09-22.
  Resolved 2026-10-05, 5b3bc48 (session upbeat-cannon), the guard waits for the bootstrap refresh instead of redirecting on an unhydrated store, and login honours ?next=.
- [ ] **Phase 0 decision (blocks Phase 1 being useful):** `apps/admin` has no production deployment. Recommendation written 2026-09-22 (`decision.md`, `context.md` "Hosting and access control"): VPS + Cloudflare Access + same-origin admin API; awaiting Tanveer's approval, then its next-steps list.
  Resolved 2026-10-05, e51b17d (session upbeat-cannon), built as recommended: admin image (Dockerfile.next), compose service, nginx admin.vhyxvoid.com behind the Cloudflare origin lock with the admin API same-origin; Cloudflare Access is an operator step (docs/operators/deployment).
- [ ] H1 (S-M) `GET /admin/system/overview`: aggregator, each subsystem returns its own `{status, latencyMs, checkedAt, message}`; one failing dependency must not fail the response. `system.read`.
  Resolved 2026-10-05, 12ed3f5 (session upbeat-cannon), GET /admin/system/health and /admin/overview; each subsystem reports independently.
- [ ] H2 (M) Postgres probe: `SELECT 1` latency, `version()`, `pg_database_size`, `pg_stat_activity` count, `pg_stat_user_tables` estimates for `tunnel_requests`/`tunnel_sessions`/`AdminAuditLog`; migration reconcile of `_prisma_migrations` vs the migrations dir (applied / failed / rolled back / pending / orphaned-in-DB, e.g. `20260426101925_serverboot`). Confirm the runtime image ships `prisma/migrations`. On-demand only (Neon autosuspend).
  Resolved 2026-10-05, 12ed3f5 (session upbeat-cannon), SELECT 1 latency, version, size, connections, migrations from _prisma_migrations, table row estimates.
- [ ] H3 (S) Redis probe: PING RTT + set/get/del round-trip on a short-TTL key. Spike first whether `INFO`/`DBSIZE` work through `@upstash/redis` and what they return (Upstash REST docs do not say). Short server-side cache; Upstash bills per command.
  Resolved 2026-10-05, 12ed3f5 (session upbeat-cannon), PING + set/get/del round trip on a short-TTL key; INFO/DBSIZE not used.
- [ ] H4 (M) Hub `GET /internal/stats` (+ agent list): agents, sdks, `PendingRegistry.size()`, `TunnelWsRegistry.size()`, uptime, heap, instanceId; reuse the `/internal/proxy` shared-secret pattern (`isInternalRequestAuthorized`). Set `HUB_INTERNAL_URL` (`http://hub:9001`) and `HUB_INTERNAL_SECRET` in production api/hub env (documented "dev only" today).
  Resolved 2026-10-05, 5ba0679 (session upbeat-cannon), /internal/stats, /internal/agents, /internal/disconnect behind HUB_INTERNAL_SECRET; nginx returns 404 for /internal/ publicly.
- [ ] H8 (S) Build info: pass `GIT_SHA`/build time into `Dockerfile.api`/`Dockerfile.hub`; expose in the overview and a read-only runtime-config route (`TIMING` constants, booleans for which required env vars are set, never values).
  Resolved 2026-10-05, 12ed3f5 + this session's Dockerfile ARGs (session upbeat-cannon), GIT_SHA/BUILD_TIME build args reach the System page.
- [ ] A1/A2 (M) Admin account list/search and detail aggregate (subscription, members, key counts, recent `TunnelSession`, usage vs limits, invoices). The admin module has no account/user/subscription queries today. `account.read`.
  Resolved 2026-10-05, 12ed3f5 + 5b3bc48 (session upbeat-cannon), /admin/accounts list/detail with members, keys, tunnels, billing and limits tabs.
- [ ] A3 (M-L, needs a decision) Admin suspend/reactivate account: `Account.status` is honored only at connect time, so suspend must also evict live sessions on the hub (`closeAllForAgent` covers tunnel-WS only); interacts with E6/E7. `account.update`.
  Resolved 2026-10-05, 12ed3f5 (session upbeat-cannon), PATCH /admin/accounts/:id status with required reason (statusReason), key-cache invalidation; the hub's AccountStatusSweep evicts live agents.
- [ ] A4 (M) Revoke an API key as an admin (existing use cases take a *user* context). Optional safe companion: invalidate one key's Redis cache entry (`RedisApiKeyCache.del`).
  Resolved 2026-10-05, 12ed3f5 (session upbeat-cannon), POST /admin/api-keys/:id/revoke drops the key's Redis cache entry.
- [ ] A5 (L, recommend NOT building) Admin plan/limit override: touches the flat-rate model and Stripe-as-source-of-truth. Use a Stripe-dashboard link-out via `stripeCustomerId` instead.
  Resolved 2026-10-05, 12ed3f5 (session upbeat-cannon), built against the recommendation by the owner's request for operator control: Account.limitOverrides + plans.overrides setting layered on PLAN_LIMITS; Stripe stays the source of truth for price and plan (see admin-frontend/decision.md 2026-10-05).
- [ ] A6 (S) `GET /admin/system/plan-limits`: `PLAN_LIMITS` per plan plus an enforcement classification from an exhaustive `Record<keyof PlanLimits, 'enforced'|'partial'|'none'>` colocated with it (TypeScript forces classifying new keys; same idea as the docs generator's allowlist).
  Resolved 2026-10-05, 12ed3f5 (session upbeat-cannon), effective limits with overrides plus an enforcement note per key.
- [ ] The admin API is reachable on `api.vhyxvoid.com` today (`GET /api/v1/admin/identity/me` -> 403 from the internet). Block `/api/v1/admin/` on the `api.` nginx block once the admin host proxies it (part of the hosting plan).
  Resolved 2026-10-05, e51b17d (session upbeat-cannon), nginx returns 404 for /api/v1/admin/ on api.; served only through admin.vhyxvoid.com.
- [ ] `apps/admin` builds only with the sibling repos `VhyxUI` and `vhyx-api-kit` checked out beside this one (`link:`). `@vhyx/api-kit` is not on npm; `@vhyxui/react` on npm (`0.1.0-alpha.1`) is older than what the code uses (`0.3.1-alpha`). Any Docker/CI/Vercel build needs an off-box build with all three repos or published packages; CI already excludes `apps/web` for the same reason.
  Resolved 2026-10-05, f967f8a (session upbeat-cannon), published @vhyxui/* from npm and the in-repo @vhyxvoid/api-kit; CI builds it.
- [ ] `pnpm turbo run typecheck`/`build` fail on `@vhyxvoid/admin` (15 errors, `TS7006` implicit-any on `@vhyxui/react` callbacks plus one prop-type mismatch), same root cause as `apps/web`'s (user-frontend backlog): the sibling `../VhyxUI` checkout has no `node_modules`, so `@vhyxui/react`'s dependencies don't resolve. Surfaced 2026-09-24 when a lockfile change invalidated turbo's cached admin typecheck; `apps/admin`'s own sources are unchanged, and swapping its one relinked dependency (`next`'s peer variant) back made no difference. Fix: `pnpm install` in `../VhyxUI`.
  Resolved 2026-10-05, f967f8a (session upbeat-cannon), resolved with the npm VhyxUI packages; CI typechecks and builds every workspace.
- [ ] `GET /admin/identity/audit-logs` now returns `meta: { total, limit, offset }` next to `data` (code-archive/api/CA-0038, uncommitted), but `AuditLogView.tsx` still says no total exists and `admin-audit-log.types.ts`'s header comment says the same. Show the total (and use it for pagination) and fix both comments; the http client may need to return the envelope's `meta`. Not done 2026-10-05 because apps/admin can't be typechecked here (sibling `VhyxUI` checkout missing). Found 2026-10-05, session 2026-10-05-backlog-sweep.
  Resolved 2026-10-05, 5b3bc48 (session upbeat-cannon), the audit log view shows the total from meta.
