# Backlog archive — api

Resolved items from `internal-tools/api/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: apps/api.**

## Archive

- [x] **Usage never reaches `UsageAggregate` on any path: the drain drops every counter (data loss, not deferred-cosmetic).** `RedisApiKeyCacheService.drainUsageCounters()` reads `results[i][1]`, which is ioredis's `[err, value]` tuple shape, but the client is `@upstash/redis` (1.36.1), whose `pipeline().exec()` returns plain deserialized values (`chunk-*.mjs` `exec`: `res.map(... => deserialize(result))`). `results[i]` is e.g. the number `2`, so `2[1]` is `undefined`, `if (!raw) continue` skips every counter, and then `redis.del(...keys)` deletes them all anyway. Affects SDK and public-path usage alike. Fix: `const raw = results?.[i]`, then handle number or string. `tests/e2e/publicPathUsageRollup.test.ts:27` hides it by mocking `exec` with ioredis tuples, so fix the mock to Upstash's shape too. Also note the flush only visits accounts with an ACTIVE key (`apiKeyPlugin.ts` flushInterval), so a keyless account's public-path usage is never drained even after this fix. Found 2026-09-24 by cross-verifying the S5 close-out report (its "bug #2"); production UsageAggregate row count not checked (prod DB read not permitted that session).
  Resolved 2026-09-24, a68f355 + 369f350 (+ 9840c8a, audit H4 core), drain reads Upstash's plain pipeline values, the flush visits every account with pending counters, and keyed counters are written under `ApiKey.id` instead of the public keyId. (Deleted from backlog.md by the fixing session under the old delete-on-fix rule; text restored here verbatim from a copy read earlier that day. Re-confirmed against the code 2026-09-24, session 2026-09-24-archive-crosscheck-c3c4.)
- [ ] `GetAccountMembersUseCase` has dead `name`/`email` sortBy switch
  branches, unreachable through the validated route (`getMembersQuerySchema`
  only allows `roleLevel`/`joinedAt`) — found 2026-09-15, Phase 2 pilot
  session (`internal-tools/user-frontend/decision.md`, "Phase 2 pilot: Member/name column made
  non-sortable")
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), removed the unreachable sort branches and the matching type union members; code-archive/api/CA-0009.
- [ ] Dead code, harmless but confusing: `key-management/presentation/
  plugins/infrastructure/api.ts` has a commented-out
  `// fastify.decorate('uow', {});` line that looks like an abandoned,
  wrong-shaped attempt at the exact decorator context.md item 49 just
  added for real (`{}` instead of a real `PrismaUnitOfWork` instance) —
  worth deleting next time this file is touched, now that the real
  decoration lives in `core.plugin.ts`. Found 2026-09-17.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), deleted the commented-out block (and the one in apiKeyPlugin.ts); code-archive/api/CA-0009.
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
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), removed all four unused decorations (use cases stay in the DI container); code-archive/api/CA-0009.
- [ ] `tunnel.routes.ts` has a commented-out, fully dead duplicate
  registration of `GET /organizations/:accountId/usage/summary` sitting
  above the real, live handler for the same path later in the file —
  harmless, never executes, worth deleting next time this file is
  touched. Found 2026-09-17, route-param-mismatch sweep session
  (context.md item 52).
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), deleted the commented-out duplicate; code-archive/api/CA-0009.
- [ ] `AdminUpdateFeedbackUseCase` (feedback module) writes no
  `AdminAuditLog` entry at all when triaging a feedback item — unlike
  every other admin mutation in this app (Users/Roles/Abilities all
  audit-log). Confirmed empirically: triaged a real feedback item via
  `PATCH /admin/feedback/:feedbackId`, checked `GET
  /admin/identity/audit-logs` immediately after, no `feedback.*` action
  appeared. Would need a new `AuditAction` enum entry (e.g.
  `FEEDBACK_UPDATED`) plus a real `AdminAuditLog.create()` call inside
  the use case. Found 2026-09-17, apps/admin Screen 7 session.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), new AuditAction.FEEDBACK_UPDATED, one AdminAuditLog row per triage update with before/after; code-archive/api/CA-0001.
- [ ] `AdminListFeedbackUseCase.execute()` issues 4 extra
  `findAll({status: X, limit: 1})` calls purely to read each status's
  `.total` for the dashboard-sidebar `counts` — 5 DB round trips per
  `GET /admin/feedback` call instead of 1. Works correctly, just
  inefficient; a single grouped `count()`/`groupBy` query would be
  cheaper. Found 2026-09-17, apps/admin Screen 7 session.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), FeedbackRepository.countByStatus() (one groupBy) replaces the four findAll calls; code-archive/api/CA-0002.
- [ ] `PATCH /admin/feedback/:feedbackId`'s "provide at least one field
  to update" 400 response is shaped `{error: "..."}` — the only place in
  this route file (and one of very few in the whole app) that doesn't use
  `successResponse`/the standard `{success, message, code, data,
  requestId}` error envelope every other route produces. Harmless today
  (no caller currently sends an empty update payload), but worth
  normalizing to the standard shape next time this file is touched.
  Found 2026-09-17, apps/admin Screen 7 session.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), the guard throws ValidationError (standard 400 envelope); code-archive/api/CA-0003.
- [ ] `PUT /admin/identity/users/:id` (`admin.routes.ts`, `updateProfile(input.firstName || "", input.lastName || "")`) answers **200 "Admin profile updated successfully"** when nothing changed: a blank or whitespace name is silently kept as the old value, and `email`/`password` in the body are silently dropped (Zod strips unknown keys). Proven with curl 2026-09-22. Either validate (400 for a blank name; `.strict()` schema) or leave as is; `apps/admin`'s form works around it client-side. Found 2026-09-22, apps/admin Create Admin/Edit Profile session.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), updateAdminSchema trims and requires non-blank names, is .strict(), and needs at least one field; code-archive/api/CA-0004.
- [ ] **Non-secret PII still logged on the password-reset path.** `identity.routes.ts` `/forgot-password` logs the submitted email, `request.ip` and user-agent on every call, and `RequestPasswordReset.usecase.ts:38` logs the email again; `PATCH /me/password` logs `isSame` (boolean, harmless). Not secrets, so outside audit C1/C2's scope, but emails in stdout end up in the container log history. Delete the lines. Found 2026-09-24, session 2026-09-24-archive-crosscheck-c3c4.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), deleted the four log lines; code-archive/api/CA-0006.
- [ ] `POST /api/v1/tunnelproxy/request` can never authenticate: it passes the `X-API-Secret` header value as the HMAC `signature` (the verifier compares it to an HMAC of the canonical string), and Fastify's per-process `request.id` (`req-1`, `req-2`, …) as the replay `requestId`, which repeats after every restart. It also forwards via `/internal/proxy`, which the agent doesn't understand (hub backlog). Either give it a real signing contract or remove it with `/internal/proxy`. Found 2026-09-24, audit H8 session (checked every signer before changing the canonical format).
  Resolved 2026-09-25, 96e9c69 (session 2026-09-25-backlog-sweep), removed the route together with the hub's /internal/proxy; code-archive/hub/CA-0012.
- [ ] Dead since the 2026-09-13 validator unification: `RedisApiKeyCacheService.markRequestId` and `REPLAY_WINDOW_MS`/`SIGNATURE_WINDOW_MS` in `core/constant/apikey.constant.ts` (no callers; still the old global replay namespace and 60 s values, so misleading next to `packages/shared`'s real ones). `ApiKey.buildCanonical` in `apiKey.entities.ts` is likewise uncalled. Delete next time this area is touched. Found 2026-09-24, audit H8 session.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), deleted markRequestId (+ interface entry and namespace), REPLAY_WINDOW_MS/SIGNATURE_WINDOW_MS and ApiKey.buildCanonical; code-archive/api/CA-0009.
- [ ] Admin logout doesn't revoke the admin's access token: `POST /admin/identity/auth/logout` revokes the refresh session only, and `AdminUser` has no `tokenVersion` to bump (users' logout does, since H2). Bounded by the 15-minute admin TTL. Fix: add `AdminUser.tokenVersion` (migration), sign it into admin tokens, bump on logout/disable, and have `AuthStateCache.getAdmin` return it. Found 2026-09-24, H2 session.
  Resolved 2026-09-25, 3eecfae (session 2026-09-25-decisions-and-e2e), AdminUser.tokenVersion (migration 20260925200000_admin_token_version) signed into admin tokens and checked by the guard; logout bumps it; code-archive/api/CA-0032.
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
  session. **Update 2026-09-25 (session 2026-09-25-backlog-sweep, b9c9f67):** `admin.token_refreshed` now has a label (and `AuditAction.ADMIN_TOKEN_REFRESHED`); still open: no total/count on `GET /audit-logs`. code-archive/api/CA-0008.
  Resolved 2026-10-05, uncommitted (session 2026-10-05-backlog-sweep), GET /audit-logs now returns meta.total (countAll + matching countBy*), orphan filter moved into the queries; code-archive/api/CA-0038.
- [ ] **Usage drain can still lose counts in two narrow windows (pre-existing, not the 2026-09-24 bugs).** `RedisApiKeyCacheService.drainUsageCounters()` does GET (pipeline) then `DEL` of the same keys, so an `INCRBY` landing between the two is deleted unread; and it deletes before `FlushUsageWorker` writes to Postgres, so a failed write loses that counter (now logged with its quantity by `[FlushUsageWorker] failed to write a usage counter`, and no longer aborts the rest of the tick). Fix shape: `GETDEL` per key in the pipeline (removes the first window; Upstash supports it) and/or delete only after a successful upsert. Soft counter today (decision.md "Answers to the E1-E7 open questions" #6), so not urgent. Found 2026-09-24, usage-drain fix session. **Update 2026-09-25 (session 2026-09-25-backlog-sweep, b9c9f67):** the first window is closed (`GETDEL` per key, no separate `DEL`; code-archive/api/CA-0005). Still open: delete-before-write, so a failed upsert loses that tick's count.
  Resolved 2026-10-05, uncommitted (session 2026-10-05-backlog-sweep), a failed upsert puts the count back in its Redis key (original 25 h lifetime) for the next tick; code-archive/api/CA-0039.
- [ ] **H4 remainder (usage pipeline), scope for a dedicated session; the GET-then-DEL race is the line above.** Confirmed still open 2026-09-24 against `9840c8a` (audit `shared/audit-2026-09-24.md` H4 items 5-7): (a) **account-level usage excludes SDK traffic.** `UsageAggregateRepository.findByAccountAndPeriod` reads only `apiKeyId: null` rows, which since `9840c8a` hold only public-path counts and counters whose key no longer resolves; keyed SDK counts land in per-key rows and no account-level rollup of them is ever written, so `GET /organizations/:accountId/usage` without `keyId` undercounts. (The key-level half of the old id mismatch is fixed: the route's `keyId` is `ApiKey.id` and the writer now stores `ApiKey.id`.) (b) **`periodEnd` is the flush time, not the bucket end** (`FlushUsageWorker.run`: `periodEnd = new Date()`); latent today because every reader's window ends at `now` (`rangeToWindow`), but wrong for any window ending in the past, and later flushes into the same bucket keep the first flush's value. (c) **Upstash SCAN cost is O(accounts x keyspace) per flush:** `listAccountIdsWithPendingUsage` does one full `SCAN usage:*`, then `drainUsageCounters` does another full `SCAN usage:{accountId}:*` per account (a MATCH scan still walks the whole keyspace). One scan per tick grouping keys by account removes it. Found 2026-09-24, session 2026-09-24-archive-crosscheck-c3c4.
  Resolved 2026-10-05, uncommitted (session 2026-10-05-backlog-sweep), (a) account reads include keyed rows, (b) periodEnd = bucket end and readers window on periodStart, (c) one SCAN per tick; code-archive/api/CA-0040.
- [ ] Rate limiting doesn't count requests that a route's own `onRequest` guard rejects: on `userAuthGuard`/`adminAuthGuard` routes the guard's hook runs before `@fastify/rate-limit`'s (proved with a minimal Fastify 5.6 / rate-limit 10.3 setup), so an unauthenticated flood gets 401 forever instead of 429 (each costs a JWT verify). If it matters, run the limiter at `onRequest` via a root hook ahead of route hooks or add the limiter hook into those routes' `onRequest` arrays first. Also likely, unverified: the 429 carries no CORS headers (limiter runs before `@fastify/cors`), so `apps/web` would see a CORS error rather than a 429. Found 2026-09-24, H1 session.
  Resolved 2026-10-05, uncommitted (session 2026-10-05-backlog-sweep), registerRateLimitFirst moves the limiter ahead of route onRequest guards; 429s carry CORS headers (verified); code-archive/api/CA-0043.
- [ ] `customer.subscription.trial_will_end` is acknowledged but sends nothing, though `sendTrialEnding` exists (part of audit part2 G11, already filed above). Needs the account owner's email resolved from the subscription's account. Noted again 2026-09-25 while testing billing end to end.
  Resolved 2026-10-05, uncommitted (session 2026-10-05-backlog-sweep), handleTrialWillEnd emails the owner (sendTrialEnding); code-archive/api/CA-0041.
- [ ] Admin refresh (`AdminRefreshToken.usecase.ts`) has the same race H10 fixed for users: no row lock (and `execute()` isn't a transaction, api/context.md #63), rotation creates a new row, and a re-presented token revokes every admin session. apps/admin also single-flights per tab only. Apply the same pattern (locked `transaction()`, successor grace, `navigator.locks` in apps/admin's http.ts) when admins use multiple tabs. Found 2026-09-25, H10 session.
  Resolved 2026-10-05, b45824d (session upbeat-cannon), locked transaction with a 30 s successor grace (replacedById + encrypted replacement token), refresh token moved to an httpOnly cookie, cross-tab lock in apps/admin.
- [ ] `HUB_INTERNAL_URL`/`HUB_INTERNAL_SECRET` are no longer read by anything: their only reader was `tunnelProxy.routes.ts`, removed with the hub's `/internal/proxy` (code-archive/hub/CA-0012). Keep them in mind for the admin-v2 `/internal/stats` (H4); drop them from env docs/examples if H4 is not built. Found 2026-09-25, session 2026-09-25-backlog-sweep.
  Resolved 2026-10-05, 5ba0679 + 12ed3f5 (session upbeat-cannon), the hub's /internal/stats, /internal/agents and /internal/disconnect (H4) read them; the admin API's hubClient calls them.
- [ ] Billing emails (payment failed/succeeded, subscription canceled, trial ending) are sent with `firstName: ""` and `accountName: <accountId>` from `HandleStripeWebhook.usecase.ts`, so the greeting is blank and the account appears as a UUID. Resolve the owner's first name and the account's name (one query next to `getAccountOwnerEmail`). Found 2026-10-05, session 2026-10-05-backlog-sweep (while wiring CA-0041).
  Resolved 2026-10-05, b45824d (session upbeat-cannon), HandleStripeWebhook.ownerNames() resolves owner first name and account name via getAccountOwnerContact.
- [ ] **Audit M23 still open: sessions only slide.** Each refresh issues a fresh 30-day user session; no absolute lifetime, and revoked `Session`/`AdminSession` rows are never pruned. Add `absoluteExpiresAt` (e.g. 90 days) and an hourly cleanup next to the grace-period worker. Found 2026-10-05, session upbeat-cannon.
  Resolved 2026-10-06, 349ff83 (session production-stable (2026-10-06)), Session/AdminSession.absoluteExpiresAt (users 90 d, admins 30 d) that rotation inherits and never passes; hourly `maintenance` job deletes sessions dead > 7 days.
- [ ] Audit M21 remainder: the range cap is done (`core/utils/usageWindow.ts`, 93 days), but `totals.avgDurationMs` is still an unweighted mean of hourly means. Weight by request count. Found 2026-10-05, session upbeat-cannon.
  Resolved 2026-10-06, ce7ff76 (session production-stable (2026-10-06)), weightedAverageMs() weights hourly means by request count.
- [ ] Admin sign-in has only the per-IP rate limit (5/min); user accounts lock after 5 failures, admin accounts never do. Low risk behind Cloudflare Access, but add the same atomic lockout as `Login.usecase.ts` (`failedLoginAttempts`/`lockedUntil` on `AdminUser`). Found 2026-10-05, session upbeat-cannon.
  Resolved 2026-10-06, 349ff83 + 49499c7 (session production-stable (2026-10-06)), AdminUser.failedLoginAttempts/lockedUntil with one atomic UPDATE (5 failures -> 15 min), dummy bcrypt for unknown emails; setting an admin password clears the lock.
- [ ] CMS saves are last-write-wins (`content.service.ts update`). Send `updatedAt` from the editor and refuse a stale save with 409. Found 2026-10-05, session upbeat-cannon.
  Resolved 2026-10-06, ce7ff76 (session production-stable (2026-10-06)), the editor sends expectedUpdatedAt; a stale save gets 409 Conflict.
- [ ] Inspector: no per-account opt-out; capture is controlled by the plan limit `inspectorRequests` and the global `features.requestInspector`. Add an account setting (workspace Settings) for customers who must not have payloads stored. Found 2026-10-06, session upbeat-cannon.
  Resolved 2026-10-06, ce7ff76 (session production-stable (2026-10-06)), Account.inspectorCapture switch on the Inspector page (owners/admins); off deletes stored captures; hub cache invalidated through /internal/policies/invalidate.
- [ ] Usage charts: `tunnel_minute_stats` (per-minute requests/5xx per tunnel, 7 days) is collected for alerts but not shown yet. A requests/errors chart on the Tunnels page via `@vhyxchart/react` is cheap now. Found 2026-10-06, session upbeat-cannon.
  Resolved 2026-10-06, 349ff83 (session production-stable (2026-10-06)), GET /api/v1/traffic/:accountId and /api/v1/admin/traffic; TrafficChart (plain SVG, stacked 2xx/4xx/5xx) on Tunnels, overview and the console dashboard. @vhyxchart is a diagram library (no data charts), so the chart is in-repo.
