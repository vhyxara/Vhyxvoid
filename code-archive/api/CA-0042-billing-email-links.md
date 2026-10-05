# CA-0042: Billing emails linked to a page that doesn't exist

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | api |
| Type | Bug fix |
| Severity | Medium |
| Status | Fixed |
| Source | new finding (2026-10-05, while wiring CA-0041) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

Payment failed, subscription canceled and trial ending emails all linked to `${APP_URL}/settings/billing`. apps/web has no such route; the Billing page is `/organizations/<accountId>/billing`. Every button in those emails led to a 404.

## Root cause

Hardcoded path from before the dashboard routes settled.

## Fix

`billingPageUrl(accountId)` builds `/organizations/<accountId>/billing` (the default locale has no prefix) and falls back to `/dashboard` without an id. The three use cases take an optional `accountId`; the webhook passes it. `billingPortalUrl` still wins for payment failed when given.

## Files changed

- `apps/api/src/modules/notification/application/use-cases/index.ts`
- `apps/api/src/modules/billing/application/use-cases/webhook/HandleStripeWebhook.usecase.ts`
- `tests/e2e/apiBacklogFixes20261005.test.ts`

## Tests

- tests/e2e/apiBacklogFixes20261005.test.ts: "payment failed, subscription canceled and trial ending all point at the account's Billing page"

## Verification

Rendered html and text of all three contain the new link and not the old one.

## Follow-ups / not done

None.
