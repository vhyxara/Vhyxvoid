# CA-0007: Personal-account rename answered 500; slugs not validated on write

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Bug fix |
| Severity | Low |
| Status | Partially fixed |
| Source | internal-tools/user-frontend/backlog.md (2026-09-21, personal account) and internal-tools/api/backlog.md (audit M18 remainder) |
| Commit | `b9c9f67` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`Account.rename()` threw a plain `Error` for a personal account ("Cannot rename a personal account") and for a short name, which the error handler turned into a 500 INTERNAL_ERROR. Separately, nothing checked `isValidSlug` when a slug was written.

## Root cause

Domain entity used untyped errors; slug validity was only a property of the generator.

## Fix

- `rename()` throws `ForbiddenError` (403) for a personal account and `ValidationError` (400) for a short name.
- `Account` validates every slug it is given (`createPersonal`, `createOrganization`, `setSlug`) with `isValidSlug`.

## Files changed

- `apps/api/src/modules/identity/domain/entities/account/Account.entities.ts`

## Tests

- tests/e2e/apiBacklogFixes20260925.test.ts: "renaming a personal account is a 403, not a 500", "rejects an invalid slug at write time"

## Verification

Unit tests.

## Follow-ups / not done

Still open: the product question of what Members/Billing mean for a personal account (user-frontend backlog), and the check-then-insert slug race (P2002). The race now needs two concurrent creations to draw the same 8-character random suffix, so it was left as is and noted in the backlog.
