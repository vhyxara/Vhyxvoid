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
- [ ] Billing: the pricing page's displayed price is CMS text, separate from the Stripe price; the console says to keep them equal. Could show the Stripe amount automatically when the CMS price is empty. Found 2026-10-06, session upbeat-cannon.
- [ ] Next product features in value order (not started; webhook inbox done 2026-10-06 00aae30; custom domains and alerts done 2026-10-06 0ad047c/9d3beac): trial-ending alert, team activity feed + usage charts, GitHub Action for preview environments, CLI `doctor`, usage-based and annual pricing. Filed 2026-10-06, session upbeat-cannon. **Update 2026-10-06 (session production-stable):** trial-ending and quota notices, team activity feed, usage charts, GitHub Action and CLI `doctor` shipped (349ff83, 4ef82d9, d28cd42). Still open: usage-based and annual pricing (roadmap #6).
- [ ] Custom domains: DNS checks are rate limited per user (12/min on POST /check) and the background job checks up to 300 due domains per 5-minute run, one at a time. With thousands of domains, batch with bounded concurrency and back off domains that have been failing for days. Found 2026-10-06, session upbeat-cannon.
- [ ] Alerts: no Slack/Discord-native channel; webhook payload is our own JSON. Add a Slack-formatted option (incoming webhook `text`) if customers ask. Found 2026-10-06, session upbeat-cannon.
- [ ] Activity feed gaps: `API_KEY_CREATED` rows carry no IP/user agent (the use case has no request context; revoke/rotate rows written by use cases are the same), and `ALERT_RULE_CREATED`/`DOMAIN_ADDED` rows have no resourceId (the POST route has no id param; the table-driven hook in `platform/shared/activity.ts` could read the reply payload). Cosmetic for the feed; matters for a compliance export. Found 2026-10-06, session production-stable.
- [ ] Usage notices read `usage_aggregates`, which the flush worker writes every few minutes, so an account can cross 100 % up to one flush + 15 minutes before the notice. Fine for a soft limit; if the monthly limit is ever enforced, notify from the hub's counters instead. Found 2026-10-06, session production-stable.
- [ ] `queryTraffic` aggregates `tunnel_minute_stats` live on every dashboard load (one GROUP BY over at most 7 days x tunnels minutes, index on `minute` + PK prefix `accountId`). Fine for today's volume; with large accounts, add an hourly rollup table or cache 7d answers for a minute. Found 2026-10-06, session production-stable.
