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
