# CA-0004: PUT /admin/identity/users/:id answered 200 when nothing changed

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Bug fix |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-22) |
| Commit | `b9c9f67` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

A blank or whitespace name was silently kept as the old value, and `email`/`password` in the body were silently dropped by Zod, yet the route answered 200 "Admin profile updated successfully".

## Root cause

`updateAdminSchema` accepted any string and stripped unknown keys; the entity ignored blank names.

## Fix

`updateAdminSchema` now trims names and requires at least one character, is `.strict()` (unknown keys such as `email`/`password` are a 400), and requires at least one of `firstName`/`lastName`. apps/admin already sends trimmed, required names, so it is unaffected.

## Files changed

- `apps/api/src/modules/identity/application/dto/admin.dto.ts`

## Tests

- tests/e2e/apiBacklogFixes20260925.test.ts: `updateAdminSchema` accepts a real change; rejects blank name, email, password, empty body

## Verification

Unit tests, api typecheck.

## Follow-ups / not done

None.
