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
- [ ] Audit M18 remainder (slugs): the uniqueness check in `VerifyEmail`/`CreateOrganization` is check-then-insert, so two concurrent creations can both pass and the second surfaces a raw P2002 500 (catch the unique violation and regenerate); and nothing validates with `isValidSlug` at write time. The empty-prefix case is covered by `7a71695` (`workspace-…`). Existing pre-H11 slugs are still name-derived; rotating them is a product call. Found 2026-09-24, audit H11 session. **Update 2026-09-25 (session 2026-09-25-backlog-sweep, b9c9f67):** `Account` now validates every slug with `isValidSlug` on write (code-archive/api/CA-0007). The check-then-insert P2002 race is left: it needs two concurrent creations drawing the same 8-character random suffix.
- [ ] No API path changes `isSuperAdmin` or can disable/delete a super-admin (`AdminUser.disable/softDelete` throw for one): both are database edits today, which `AuthStateCache` picks up within its 30 s TTL. If an admin UI for either is ever built, call `fastify.authStateCache.invalidateAdmin(id)` after the write, like the disable/enable routes. Found 2026-09-24, H2 session.
- [ ] Admin refresh (`AdminRefreshToken.usecase.ts`) has the same race H10 fixed for users: no row lock (and `execute()` isn't a transaction, api/context.md #63), rotation creates a new row, and a re-presented token revokes every admin session. apps/admin also single-flights per tab only. Apply the same pattern (locked `transaction()`, successor grace, `navigator.locks` in apps/admin's http.ts) when admins use multiple tabs. Found 2026-09-25, H10 session.
- [ ] **No account or user deletion path (audit part2 G10), plus self-service deletion (part2 F15).** `deletedAt`/`DELETED` exist but no use case or route; `ApiKey.createdBy`/`revokedBy` have no `onDelete`, so a hard delete of a key creator is FK-blocked. GDPR/DPDP requests can't be served. See `shared/audit-2026-09-24-part2.md` G10/F15. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Notification types defined but never sent (audit part2 G11), and alerts (part2 F6).** `TUNNEL_DISCONNECTED`, `TRIAL_ENDING`, `SYSTEM_ALERT` never emitted; Stripe `customer.subscription.trial_will_end` received and ignored (`HandleStripeWebhook.usecase.ts`). Alerts proposal: tunnel down > N min, usage 80/100%, security events per key, trial ending. See `shared/audit-2026-09-24-part2.md` G11/F6. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes). **Update 2026-10-05 (session 2026-10-05-backlog-sweep, uncommitted):** `trial_will_end` now emails the owner (code-archive/api/CA-0041). Still open: `TUNNEL_DISCONNECTED`, `SYSTEM_ALERT`, and the F6 alerts.
- [ ] **Feature proposal (audit part2 F17): REST API tokens / Terraform provider** for managing keys, labels and policies as code. See `shared/audit-2026-09-24-part2.md` section 5. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] `HUB_INTERNAL_URL`/`HUB_INTERNAL_SECRET` are no longer read by anything: their only reader was `tunnelProxy.routes.ts`, removed with the hub's `/internal/proxy` (code-archive/hub/CA-0012). Keep them in mind for the admin-v2 `/internal/stats` (H4); drop them from env docs/examples if H4 is not built. Found 2026-09-25, session 2026-09-25-backlog-sweep.
- [ ] Billing emails (payment failed/succeeded, subscription canceled, trial ending) are sent with `firstName: ""` and `accountName: <accountId>` from `HandleStripeWebhook.usecase.ts`, so the greeting is blank and the account appears as a UUID. Resolve the owner's first name and the account's name (one query next to `getAccountOwnerEmail`). Found 2026-10-05, session 2026-10-05-backlog-sweep (while wiring CA-0041).
