# CA-0021: Per-row guards on Remove member / Revoke key were silently ignored

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | user-frontend (apps/web) |
| Type | Bug fix |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/user-frontend/backlog.md (found 2026-09-18, filed as latent) |
| Commit | `fc9612c` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`Confirmation` had no `disabled` prop and `RowAction`'s confirmation branch never passed `action.disabled?.(row)`. The backlog said no call site used it, but typechecking showed two do: Members "Remove" (`!manageable || member.isYou`) and API keys "Revoke" (`!isActive`). Those buttons were clickable on your own row, on members you can't manage, and on already revoked/expired keys.

## Root cause

Same bug apps/admin fixed on 2026-09-18; apps/web's copy was never updated.

## Fix

`Confirmation` gains `disabled?: boolean` on both trigger buttons; `RowAction` passes `action.disabled?.(row)`; `ConfirmationAction` omits `disabled` from `ConfirmationProps` so the row-level `(row) => boolean` stays the one authors write (same as apps/admin).

## Files changed

- `apps/web/src/libs/components/Confirmation.tsx`
- `apps/web/src/libs/table/RowAction.tsx`
- `apps/web/src/libs/table/type.ts`

## Tests

- apps/web's own vitest suite cannot load here (sibling `vhyx-api-kit`/`VhyxUI` checkouts missing, pre-existing)

## Verification

`tsc` error set for apps/web before vs after is identical (78 pre-existing missing-sibling errors; only a line number moved).

## Follow-ups / not done

Click-through check in a browser once the sibling repos are available.
