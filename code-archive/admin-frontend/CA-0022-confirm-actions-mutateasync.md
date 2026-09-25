# CA-0022: Confirm dialogs closed before the request finished; disable/enable errors were silent

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | admin-frontend (apps/admin) |
| Type | Bug fix |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/admin-frontend/backlog.md (found 2026-09-19) |
| Commit | `fc9612c` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

Row actions called fire-and-forget `.mutate()`, so the confirm dialog's spinner cleared and the dialog closed at once. apps/admin has no global mutation error handler, so a failed disable/enable admin showed nothing at all.

## Root cause

`onConfirm` returned `void` instead of the request's promise.

## Fix

Disable/enable admin, delete ability, revoke role and revoke ability now return `mutateAsync(...)`. `Confirmation` awaits it and shows the error via its existing feedback dialog; the ability table's separate toast was replaced with `errorFeedbackMessage`. `onConfirm` types widened to `Promise<unknown>` (as in apps/web).

## Files changed

- `apps/admin/src/views/admin-users/AdminUsersTable.tsx`
- `apps/admin/src/views/admin-abilities/AdminAbilitiesTable.tsx`
- `apps/admin/src/views/admin-roles/AdminRoleDetailView.tsx`
- `apps/admin/src/views/admin-users/AdminUserDetailView.tsx`
- `apps/admin/src/libs/table/type.ts`
- `apps/admin/src/libs/components/Confirmation.tsx`

## Tests

- apps/admin's own vitest suite cannot load here (same sibling-repo issue)

## Verification

`tsc` error set for apps/admin before vs after is identical (63 pre-existing errors; only a column moved).

## Follow-ups / not done

Browser check once the sibling repos are available.
