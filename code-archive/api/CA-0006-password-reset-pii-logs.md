# CA-0006: Emails, IPs and user agents logged on the password-reset path

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Privacy |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-24) |
| Commit | `b9c9f67` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`/forgot-password` logged the submitted email, `request.ip` and user agent on every call, `RequestPasswordReset` logged the email again, and `PATCH /me/password` logged `isSame`.

## Root cause

Leftover debug `console.log` lines.

## Fix

Deleted all four log lines.

## Files changed

- `apps/api/src/modules/identity/presentation/http/user/identity.routes.ts`
- `apps/api/src/modules/identity/application/use-cases/user/RequestPasswordReset.usecase.ts`

## Tests

- None needed (log removal); covered by typecheck and the existing suite.

## Verification

grep: no remaining email log on that path.

## Follow-ups / not done

None.
