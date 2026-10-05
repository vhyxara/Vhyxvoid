# CA-0041: Stripe trial_will_end was acknowledged but no email was sent

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | api |
| Type | Bug fix |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (2026-09-25; part of audit part2 G11) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

Three days before a trial ends Stripe sends `customer.subscription.trial_will_end`; the webhook acknowledged it and did nothing, although `sendTrialEnding` and its template existed.

## Root cause

The event was in the "acknowledge but don't act" list.

## Fix

New `handleTrialWillEnd`: resolves the account (subscription row, then subscription metadata, then the Stripe customer), the owner's email, and sends the trial-ending email with `trialEndsAt` and `daysLeft`, fire-and-forget like the other billing emails. Nothing else changes.

## Files changed

- `apps/api/src/modules/billing/application/use-cases/webhook/HandleStripeWebhook.usecase.ts`
- `tests/e2e/apiBacklogFixes20261005.test.ts`

## Tests

- tests/e2e/apiBacklogFixes20261005.test.ts: the three "Stripe trial_will_end emails the account owner" tests

## Verification

Tests green; api typecheck clean. Not run against Stripe test mode.

## Follow-ups / not done

Still open from G11: `TUNNEL_DISCONNECTED`, `SYSTEM_ALERT`, and the alerts proposal (F6). `firstName` is blank and `accountName` is the account id, as in the other billing emails (backlog).
