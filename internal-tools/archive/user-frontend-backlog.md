# Backlog archive — user-frontend

Resolved items from `internal-tools/user-frontend/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: apps/web.**

## Archive

- [ ] `libs/components/Confirmation.tsx`'s `ConfirmationProps` has no
  `disabled` prop, and `libs/table/RowAction.tsx`'s `type: 'confirmation'`
  branch never forwards `action.disabled?.(row)` to it — unlike the
  `click`/`dialog` action types, which both do. Found 2026-09-18 while
  fixing the equivalent, actively-exercised bug in `apps/admin` (its copy
  of these same two files — see `internal-tools/admin-frontend/backlog.md`'s
  fix history and `decision.md`, 2026-09-18): confirmed via grep that no
  `apps/web` call site currently sets `disabled` on a `confirmation`-type
  row action, so this is a latent gap here, not an active bug — nothing in
  `apps/web` needs the fix today. Not fixed in this repo (out of scope for
  the apps/admin session that found it); if a future `apps/web` screen ever
  needs a guarded confirmation-type row action, add `disabled?: boolean` to
  `ConfirmationProps` and pass it through in `RowAction.tsx`, matching the
  fix already applied in `apps/admin`.
  Resolved 2026-09-25, fc9612c (session 2026-09-25-backlog-sweep), Confirmation gains disabled and RowAction passes it. Not latent after all: MembersTable's Remove and ApiKeysView's Revoke set disabled and it was being ignored; code-archive/user-frontend/CA-0021.
