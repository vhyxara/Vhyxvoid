# CA-0008: admin.token_refreshed had no human label

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Cleanup |
| Severity | Low |
| Status | Partially fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-17, Screen 6) |
| Commit | `b9c9f67` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`getActionDescription()` fell back to the raw string for `admin.token_refreshed`, a real, emitted action.

## Root cause

Missing map entry.

## Fix

Added `AuditAction.ADMIN_TOKEN_REFRESHED` plus its label "Admin access token refreshed"; `AdminRefreshToken` now uses the enum.

## Files changed

- `apps/api/src/modules/identity/domain/entities/admin/AdminAuditLog.entities.ts`
- `apps/api/src/modules/identity/application/use-cases/admin/AdminRefreshToken.usecase.ts`

## Tests

- tests/e2e/apiBacklogFixes20260925.test.ts: label test

## Verification

Unit test.

## Follow-ups / not done

Still open: `GET /audit-logs` returns no total count (the unused `countBy*` methods). Kept in api/backlog.md.
