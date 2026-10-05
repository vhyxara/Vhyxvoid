# CA-0044: maxApiKeys was enforced twice; the guard leaked plan data to non-members

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | api |
| Type | Security |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (found 2026-09-22, S2) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

Creating a key over the limit answered `402 Plan limit reached` from a route guard, never the use case's documented message. The guard also ran before any membership check, so any signed-in user could learn another account's plan and key count once that account was at its limit.

## Root cause

`apiKeyLimitGuard` (`buildPlanLimitGuard`) ran in `onRequest`, ahead of `CreateApiKeyUseCase`'s own check.

## Fix

Removed the guard from the route; `CreateApiKeyUseCase` enforces `maxApiKeys` after its membership and role checks, with the message the docs describe. `planLimitGuard.middleware.ts` had no other caller and was deleted.

## Files changed

- `apps/api/src/modules/key-management/presentation/http/apiKey.routes.ts`
- `apps/api/src/modules/billing/infrastructure/middleware/planLimitGuard.middleware.ts` (deleted)
- `tests/e2e/apiBacklogFixes20261005.test.ts`

## Tests

- tests/e2e/apiBacklogFixes20261005.test.ts: "has no plan-limit guard ahead of the use case: only the auth guard runs before it"

## Verification

api typecheck clean; docs `dashboard/api-keys.mdx` and `reference/plans-and-limits.mdx` already describe the use case's message.

## Follow-ups / not done

Not checked with a real request.
