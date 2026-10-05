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
- [ ] **No account or user deletion path (audit part2 G10), plus self-service deletion (part2 F15).** `deletedAt`/`DELETED` exist but no use case or route; `ApiKey.createdBy`/`revokedBy` have no `onDelete`, so a hard delete of a key creator is FK-blocked. GDPR/DPDP requests can't be served. See `shared/audit-2026-09-24-part2.md` G10/F15. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Notification types defined but never sent (audit part2 G11), and alerts (part2 F6).** `TUNNEL_DISCONNECTED`, `TRIAL_ENDING`, `SYSTEM_ALERT` never emitted; Stripe `customer.subscription.trial_will_end` received and ignored (`HandleStripeWebhook.usecase.ts`). Alerts proposal: tunnel down > N min, usage 80/100%, security events per key, trial ending. See `shared/audit-2026-09-24-part2.md` G11/F6. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes). **Update 2026-10-05 (session 2026-10-05-backlog-sweep, uncommitted):** `trial_will_end` now emails the owner (code-archive/api/CA-0041). Still open: `TUNNEL_DISCONNECTED`, `SYSTEM_ALERT`, and the F6 alerts.
- [ ] **Feature proposal (audit part2 F17): REST API tokens / Terraform provider** for managing keys, labels and policies as code. See `shared/audit-2026-09-24-part2.md` section 5. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Audit M23 still open: sessions only slide.** Each refresh issues a fresh 30-day user session; no absolute lifetime, and revoked `Session`/`AdminSession` rows are never pruned. Add `absoluteExpiresAt` (e.g. 90 days) and an hourly cleanup next to the grace-period worker. Found 2026-10-05, session upbeat-cannon.
- [ ] Audit M21 remainder: the range cap is done (`core/utils/usageWindow.ts`, 93 days), but `totals.avgDurationMs` is still an unweighted mean of hourly means. Weight by request count. Found 2026-10-05, session upbeat-cannon.
- [ ] Admin sign-in has only the per-IP rate limit (5/min); user accounts lock after 5 failures, admin accounts never do. Low risk behind Cloudflare Access, but add the same atomic lockout as `Login.usecase.ts` (`failedLoginAttempts`/`lockedUntil` on `AdminUser`). Found 2026-10-05, session upbeat-cannon.
- [ ] CMS saves are last-write-wins (`content.service.ts update`). Send `updatedAt` from the editor and refuse a stale save with 409. Found 2026-10-05, session upbeat-cannon.
