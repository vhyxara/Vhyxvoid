# Backlog — apps/api

Small, already-diagnosed, non-urgent items — not the big architectural
questions tracked in context.md's Known Risks/Gaps (numbered items). When an item here is fixed, move it (original text unchanged) to
`internal-tools/archive/api-backlog.md` with a `Resolved <date>, <commit/session>,
<one-line fix>` line; don't check it off here and don't delete it outright.

**Scope: apps/api (control-plane REST API).**

## Backlog

- [ ] `GetAccountMembersUseCase` has dead `name`/`email` sortBy switch
  branches, unreachable through the validated route (`getMembersQuerySchema`
  only allows `roleLevel`/`joinedAt`) — found 2026-09-15, Phase 2 pilot
  session (`internal-tools/user-frontend/decision.md`, "Phase 2 pilot: Member/name column made
  non-sortable")
- [ ] `apps/web`'s `/notification/notifications` endpoint (and likely its
  `read`/`read-all` siblings) returns a bare `{notifications, unreadCount}`
  body with no `success`/`data` wrapper, unlike every other apps/api
  route — found 2026-09-16, Phase 3 part 1 session, while confirming the
  `AppNotification.message`/`body` field-name bug. Not itself a bug (the
  frontend already expects the bare shape), just an API-convention
  inconsistency worth normalizing if this module gets touched again.
- [ ] Dead code, harmless but confusing: `key-management/presentation/
  plugins/infrastructure/api.ts` has a commented-out
  `// fastify.decorate('uow', {});` line that looks like an abandoned,
  wrong-shaped attempt at the exact decorator context.md item 49 just
  added for real (`{}` instead of a real `PrismaUnitOfWork` instance) —
  worth deleting next time this file is touched, now that the real
  decoration lives in `core.plugin.ts`. Found 2026-09-17.
- [ ] The reverse of item 49/50's bug shape exists in 4 places:
  `apiKeyRepository`, `securityEventRepository` (decorated in
  `apiKeyPlugin.ts`), `deactivateRoleUseCase`, `updateRoleUseCase`
  (decorated in `admin.plugin.ts`) are all real, live `fastify.decorate()`
  calls with no corresponding `fastify.d.ts` declaration at all —
  confirmed harmless today (grepped for `fastify.<name>` reads of each,
  zero matches — decorated and never consumed, same as the 5 declarations
  item 50 removed but in the opposite direction). Worth either declaring
  them properly or removing the dead decorations next time someone's in
  this area — not urgent, zero live impact either way. Found 2026-09-17,
  sweep session (context.md item 50).
- [ ] `tunnel.routes.ts` has a commented-out, fully dead duplicate
  registration of `GET /organizations/:accountId/usage/summary` sitting
  above the real, live handler for the same path later in the file —
  harmless, never executes, worth deleting next time this file is
  touched. Found 2026-09-17, route-param-mismatch sweep session
  (context.md item 52).
- [ ] `AdminAuditLog.entities.ts`'s `getActionDescription()` action→label
  map is missing at least one real, currently-emitted action:
  `admin.token_refreshed` (written by `AdminRefreshToken.usecase.ts`,
  confirmed via a real audit-log entry) falls back to returning the raw
  action string instead of a human label. Harmless (the fallback is
  intentional and documented), just an incomplete map — worth adding an
  entry (`'admin.token_refreshed': 'Admin access token refreshed'` or
  similar) next time this file is touched. `AdminAuditLogRepository` also
  declares `countByAdminId`/`countByAction`/`countByTargetId` but no
  `countAll()`, and none of the three are ever called by
  `admin.routes.ts`'s `GET /audit-logs` handler — dead code, and the
  reason that endpoint's response has no total/count field at all (see
  `internal-tools/admin-frontend/context.md`'s Screen 6 entry for the
  frontend-side consequence). Found 2026-09-17, apps/admin Screen 6
  session.
- [ ] `AdminUpdateFeedbackUseCase` (feedback module) writes no
  `AdminAuditLog` entry at all when triaging a feedback item — unlike
  every other admin mutation in this app (Users/Roles/Abilities all
  audit-log). Confirmed empirically: triaged a real feedback item via
  `PATCH /admin/feedback/:feedbackId`, checked `GET
  /admin/identity/audit-logs` immediately after, no `feedback.*` action
  appeared. Would need a new `AuditAction` enum entry (e.g.
  `FEEDBACK_UPDATED`) plus a real `AdminAuditLog.create()` call inside
  the use case. Found 2026-09-17, apps/admin Screen 7 session.
- [ ] `AdminListFeedbackUseCase.execute()` issues 4 extra
  `findAll({status: X, limit: 1})` calls purely to read each status's
  `.total` for the dashboard-sidebar `counts` — 5 DB round trips per
  `GET /admin/feedback` call instead of 1. Works correctly, just
  inefficient; a single grouped `count()`/`groupBy` query would be
  cheaper. Found 2026-09-17, apps/admin Screen 7 session.
- [ ] `PATCH /admin/feedback/:feedbackId`'s "provide at least one field
  to update" 400 response is shaped `{error: "..."}` — the only place in
  this route file (and one of very few in the whole app) that doesn't use
  `successResponse`/the standard `{success, message, code, data,
  requestId}` error envelope every other route produces. Harmless today
  (no caller currently sends an empty update payload), but worth
  normalizing to the standard shape next time this file is touched.
  Found 2026-09-17, apps/admin Screen 7 session.
- [ ] `PUT /admin/identity/users/:id` (`admin.routes.ts`, `updateProfile(input.firstName || "", input.lastName || "")`) answers **200 "Admin profile updated successfully"** when nothing changed: a blank or whitespace name is silently kept as the old value, and `email`/`password` in the body are silently dropped (Zod strips unknown keys). Proven with curl 2026-09-22. Either validate (400 for a blank name; `.strict()` schema) or leave as is; `apps/admin`'s form works around it client-side. Found 2026-09-22, apps/admin Create Admin/Edit Profile session.
- [ ] **Usage drain can still lose counts in two narrow windows (pre-existing, not the 2026-09-24 bugs).** `RedisApiKeyCacheService.drainUsageCounters()` does GET (pipeline) then `DEL` of the same keys, so an `INCRBY` landing between the two is deleted unread; and it deletes before `FlushUsageWorker` writes to Postgres, so a failed write loses that counter (now logged with its quantity by `[FlushUsageWorker] failed to write a usage counter`, and no longer aborts the rest of the tick). Fix shape: `GETDEL` per key in the pipeline (removes the first window; Upstash supports it) and/or delete only after a successful upsert. Soft counter today (decision.md "Answers to the E1-E7 open questions" #6), so not urgent. Found 2026-09-24, usage-drain fix session.
- [ ] **H4 remainder (usage pipeline), scope for a dedicated session; the GET-then-DEL race is the line above.** Confirmed still open 2026-09-24 against `9840c8a` (audit `shared/audit-2026-09-24.md` H4 items 5-7): (a) **account-level usage excludes SDK traffic.** `UsageAggregateRepository.findByAccountAndPeriod` reads only `apiKeyId: null` rows, which since `9840c8a` hold only public-path counts and counters whose key no longer resolves; keyed SDK counts land in per-key rows and no account-level rollup of them is ever written, so `GET /organizations/:accountId/usage` without `keyId` undercounts. (The key-level half of the old id mismatch is fixed: the route's `keyId` is `ApiKey.id` and the writer now stores `ApiKey.id`.) (b) **`periodEnd` is the flush time, not the bucket end** (`FlushUsageWorker.run`: `periodEnd = new Date()`); latent today because every reader's window ends at `now` (`rangeToWindow`), but wrong for any window ending in the past, and later flushes into the same bucket keep the first flush's value. (c) **Upstash SCAN cost is O(accounts x keyspace) per flush:** `listAccountIdsWithPendingUsage` does one full `SCAN usage:*`, then `drainUsageCounters` does another full `SCAN usage:{accountId}:*` per account (a MATCH scan still walks the whole keyspace). One scan per tick grouping keys by account removes it. Found 2026-09-24, session 2026-09-24-archive-crosscheck-c3c4.
- [ ] **Non-secret PII still logged on the password-reset path.** `identity.routes.ts` `/forgot-password` logs the submitted email, `request.ip` and user-agent on every call, and `RequestPasswordReset.usecase.ts:38` logs the email again; `PATCH /me/password` logs `isSame` (boolean, harmless). Not secrets, so outside audit C1/C2's scope, but emails in stdout end up in the container log history. Delete the lines. Found 2026-09-24, session 2026-09-24-archive-crosscheck-c3c4.
- [ ] Rate limiting doesn't count requests that a route's own `onRequest` guard rejects: on `userAuthGuard`/`adminAuthGuard` routes the guard's hook runs before `@fastify/rate-limit`'s (proved with a minimal Fastify 5.6 / rate-limit 10.3 setup), so an unauthenticated flood gets 401 forever instead of 429 (each costs a JWT verify). If it matters, run the limiter at `onRequest` via a root hook ahead of route hooks or add the limiter hook into those routes' `onRequest` arrays first. Also likely, unverified: the 429 carries no CORS headers (limiter runs before `@fastify/cors`), so `apps/web` would see a CORS error rather than a 429. Found 2026-09-24, H1 session.
- [ ] `POST /api/v1/tunnelproxy/request` can never authenticate: it passes the `X-API-Secret` header value as the HMAC `signature` (the verifier compares it to an HMAC of the canonical string), and Fastify's per-process `request.id` (`req-1`, `req-2`, …) as the replay `requestId`, which repeats after every restart. It also forwards via `/internal/proxy`, which the agent doesn't understand (hub backlog). Either give it a real signing contract or remove it with `/internal/proxy`. Found 2026-09-24, audit H8 session (checked every signer before changing the canonical format).
- [ ] Dead since the 2026-09-13 validator unification: `RedisApiKeyCacheService.markRequestId` and `REPLAY_WINDOW_MS`/`SIGNATURE_WINDOW_MS` in `core/constant/apikey.constant.ts` (no callers; still the old global replay namespace and 60 s values, so misleading next to `packages/shared`'s real ones). `ApiKey.buildCanonical` in `apiKey.entities.ts` is likewise uncalled. Delete next time this area is touched. Found 2026-09-24, audit H8 session.
- [ ] Audit M18 remainder (slugs): the uniqueness check in `VerifyEmail`/`CreateOrganization` is check-then-insert, so two concurrent creations can both pass and the second surfaces a raw P2002 500 (catch the unique violation and regenerate); and nothing validates with `isValidSlug` at write time. The empty-prefix case is covered by `7a71695` (`workspace-…`). Existing pre-H11 slugs are still name-derived; rotating them is a product call. Found 2026-09-24, audit H11 session.
- [ ] Admin logout doesn't revoke the admin's access token: `POST /admin/identity/auth/logout` revokes the refresh session only, and `AdminUser` has no `tokenVersion` to bump (users' logout does, since H2). Bounded by the 15-minute admin TTL. Fix: add `AdminUser.tokenVersion` (migration), sign it into admin tokens, bump on logout/disable, and have `AuthStateCache.getAdmin` return it. Found 2026-09-24, H2 session.
- [ ] No API path changes `isSuperAdmin` or can disable/delete a super-admin (`AdminUser.disable/softDelete` throw for one): both are database edits today, which `AuthStateCache` picks up within its 30 s TTL. If an admin UI for either is ever built, call `fastify.authStateCache.invalidateAdmin(id)` after the write, like the disable/enable routes. Found 2026-09-24, H2 session.
- [ ] Admin refresh (`AdminRefreshToken.usecase.ts`) has the same race H10 fixed for users: no row lock (and `execute()` isn't a transaction, api/context.md #63), rotation creates a new row, and a re-presented token revokes every admin session. apps/admin also single-flights per tab only. Apply the same pattern (locked `transaction()`, successor grace, `navigator.locks` in apps/admin's http.ts) when admins use multiple tabs. Found 2026-09-25, H10 session.
- [ ] **No account or user deletion path (audit part2 G10), plus self-service deletion (part2 F15).** `deletedAt`/`DELETED` exist but no use case or route; `ApiKey.createdBy`/`revokedBy` have no `onDelete`, so a hard delete of a key creator is FK-blocked. GDPR/DPDP requests can't be served. See `shared/audit-2026-09-24-part2.md` G10/F15. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Notification types defined but never sent (audit part2 G11), and alerts (part2 F6).** `TUNNEL_DISCONNECTED`, `TRIAL_ENDING`, `SYSTEM_ALERT` never emitted; Stripe `customer.subscription.trial_will_end` received and ignored (`HandleStripeWebhook.usecase.ts`). Alerts proposal: tunnel down > N min, usage 80/100%, security events per key, trial ending. See `shared/audit-2026-09-24-part2.md` G11/F6. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Feature proposal (audit part2 F17): REST API tokens / Terraform provider** for managing keys, labels and policies as code. See `shared/audit-2026-09-24-part2.md` section 5. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
