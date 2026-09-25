# Backlog — apps/api

Small, already-diagnosed, non-urgent items — not the big architectural
questions tracked in context.md's Known Risks/Gaps (numbered items). When an item here is fixed, move it (original text unchanged) to
`internal-tools/archive/api-backlog.md` with a `Resolved <date>, <commit/session>,
<one-line fix>` line; don't check it off here and don't delete it outright.

**Scope: apps/api (control-plane REST API).**

## Backlog

- [ ] `apps/web`'s `/notification/notifications` endpoint (and likely its
  `read`/`read-all` siblings) returns a bare `{notifications, unreadCount}`
  body with no `success`/`data` wrapper, unlike every other apps/api
  route — found 2026-09-16, Phase 3 part 1 session, while confirming the
  `AppNotification.message`/`body` field-name bug. Not itself a bug (the
  frontend already expects the bare shape), just an API-convention
  inconsistency worth normalizing if this module gets touched again.
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
- [ ] **Usage drain can still lose counts in two narrow windows (pre-existing, not the 2026-09-24 bugs).** `RedisApiKeyCacheService.drainUsageCounters()` does GET (pipeline) then `DEL` of the same keys, so an `INCRBY` landing between the two is deleted unread; and it deletes before `FlushUsageWorker` writes to Postgres, so a failed write loses that counter (now logged with its quantity by `[FlushUsageWorker] failed to write a usage counter`, and no longer aborts the rest of the tick). Fix shape: `GETDEL` per key in the pipeline (removes the first window; Upstash supports it) and/or delete only after a successful upsert. Soft counter today (decision.md "Answers to the E1-E7 open questions" #6), so not urgent. Found 2026-09-24, usage-drain fix session. **Update 2026-09-25 (session 2026-09-25-backlog-sweep, b9c9f67):** the first window is closed (`GETDEL` per key, no separate `DEL`; code-archive/api/CA-0005). Still open: delete-before-write, so a failed upsert loses that tick's count.
- [ ] **H4 remainder (usage pipeline), scope for a dedicated session; the GET-then-DEL race is the line above.** Confirmed still open 2026-09-24 against `9840c8a` (audit `shared/audit-2026-09-24.md` H4 items 5-7): (a) **account-level usage excludes SDK traffic.** `UsageAggregateRepository.findByAccountAndPeriod` reads only `apiKeyId: null` rows, which since `9840c8a` hold only public-path counts and counters whose key no longer resolves; keyed SDK counts land in per-key rows and no account-level rollup of them is ever written, so `GET /organizations/:accountId/usage` without `keyId` undercounts. (The key-level half of the old id mismatch is fixed: the route's `keyId` is `ApiKey.id` and the writer now stores `ApiKey.id`.) (b) **`periodEnd` is the flush time, not the bucket end** (`FlushUsageWorker.run`: `periodEnd = new Date()`); latent today because every reader's window ends at `now` (`rangeToWindow`), but wrong for any window ending in the past, and later flushes into the same bucket keep the first flush's value. (c) **Upstash SCAN cost is O(accounts x keyspace) per flush:** `listAccountIdsWithPendingUsage` does one full `SCAN usage:*`, then `drainUsageCounters` does another full `SCAN usage:{accountId}:*` per account (a MATCH scan still walks the whole keyspace). One scan per tick grouping keys by account removes it. Found 2026-09-24, session 2026-09-24-archive-crosscheck-c3c4.
- [ ] Rate limiting doesn't count requests that a route's own `onRequest` guard rejects: on `userAuthGuard`/`adminAuthGuard` routes the guard's hook runs before `@fastify/rate-limit`'s (proved with a minimal Fastify 5.6 / rate-limit 10.3 setup), so an unauthenticated flood gets 401 forever instead of 429 (each costs a JWT verify). If it matters, run the limiter at `onRequest` via a root hook ahead of route hooks or add the limiter hook into those routes' `onRequest` arrays first. Also likely, unverified: the 429 carries no CORS headers (limiter runs before `@fastify/cors`), so `apps/web` would see a CORS error rather than a 429. Found 2026-09-24, H1 session.
- [ ] Audit M18 remainder (slugs): the uniqueness check in `VerifyEmail`/`CreateOrganization` is check-then-insert, so two concurrent creations can both pass and the second surfaces a raw P2002 500 (catch the unique violation and regenerate); and nothing validates with `isValidSlug` at write time. The empty-prefix case is covered by `7a71695` (`workspace-…`). Existing pre-H11 slugs are still name-derived; rotating them is a product call. Found 2026-09-24, audit H11 session. **Update 2026-09-25 (session 2026-09-25-backlog-sweep, b9c9f67):** `Account` now validates every slug with `isValidSlug` on write (code-archive/api/CA-0007). The check-then-insert P2002 race is left: it needs two concurrent creations drawing the same 8-character random suffix.
- [ ] No API path changes `isSuperAdmin` or can disable/delete a super-admin (`AdminUser.disable/softDelete` throw for one): both are database edits today, which `AuthStateCache` picks up within its 30 s TTL. If an admin UI for either is ever built, call `fastify.authStateCache.invalidateAdmin(id)` after the write, like the disable/enable routes. Found 2026-09-24, H2 session.
- [ ] Admin refresh (`AdminRefreshToken.usecase.ts`) has the same race H10 fixed for users: no row lock (and `execute()` isn't a transaction, api/context.md #63), rotation creates a new row, and a re-presented token revokes every admin session. apps/admin also single-flights per tab only. Apply the same pattern (locked `transaction()`, successor grace, `navigator.locks` in apps/admin's http.ts) when admins use multiple tabs. Found 2026-09-25, H10 session.
- [ ] **No account or user deletion path (audit part2 G10), plus self-service deletion (part2 F15).** `deletedAt`/`DELETED` exist but no use case or route; `ApiKey.createdBy`/`revokedBy` have no `onDelete`, so a hard delete of a key creator is FK-blocked. GDPR/DPDP requests can't be served. See `shared/audit-2026-09-24-part2.md` G10/F15. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Notification types defined but never sent (audit part2 G11), and alerts (part2 F6).** `TUNNEL_DISCONNECTED`, `TRIAL_ENDING`, `SYSTEM_ALERT` never emitted; Stripe `customer.subscription.trial_will_end` received and ignored (`HandleStripeWebhook.usecase.ts`). Alerts proposal: tunnel down > N min, usage 80/100%, security events per key, trial ending. See `shared/audit-2026-09-24-part2.md` G11/F6. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Feature proposal (audit part2 F17): REST API tokens / Terraform provider** for managing keys, labels and policies as code. See `shared/audit-2026-09-24-part2.md` section 5. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] `HUB_INTERNAL_URL`/`HUB_INTERNAL_SECRET` are no longer read by anything: their only reader was `tunnelProxy.routes.ts`, removed with the hub's `/internal/proxy` (code-archive/hub/CA-0012). Keep them in mind for the admin-v2 `/internal/stats` (H4); drop them from env docs/examples if H4 is not built. Found 2026-09-25, session 2026-09-25-backlog-sweep.
- [ ] `customer.subscription.trial_will_end` is acknowledged but sends nothing, though `sendTrialEnding` exists (part of audit part2 G11, already filed above). Needs the account owner's email resolved from the subscription's account. Noted again 2026-09-25 while testing billing end to end.
