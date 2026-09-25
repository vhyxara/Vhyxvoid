# Backlog archive — admin-frontend

Resolved items from `internal-tools/admin-frontend/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: apps/admin.**

## Archive

- [ ] `apps/api` has no `trustProxy`, and its only limiter is a global `max 100 / 1 min` (`register.plugin.ts:45`), so behind nginx all clients likely share one bucket (inferred from config, not tested live). Set `trustProxy` for the nginx/Cloudflare hop and add a tighter per-IP limit on `POST /admin/identity/auth/login` (and the user login).
Resolved 2026-09-24, 5e255b0, trustProxy limited to loopback/private-network peers (nginx), limiter registered first, per-IP login limits (user 10/min, admin 5/min); audit H1.
- [ ] `apps/admin.routes.ts`'s orphaned duplicate JSDoc comment block
  (lines ~470-484) — backend cleanup, see `internal-tools/api/backlog.md`.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), removed the orphaned fragment from admin.routes.ts; code-archive/api/CA-0009.
- [ ] Same fire-and-forget `.mutate()` pattern that was fixed in apps/web
  (2026-09-19, `internal-tools/user-frontend/decision.md`, "FeedbackContext
  removed") is also present here: `AdminUsersTable.tsx`'s disable/enable
  row actions (`disableAdmin.mutate(row.id)`/`enableAdmin.mutate(row.id)`)
  and `AdminAbilitiesTable.tsx`'s delete action all call `.mutate()`, not
  `.mutateAsync()`. apps/admin has no `FeedbackContext`-equivalent global
  confirm/alert Dialog, so there's no unreachable-Dialog bug here — but the
  same loading-state-dishonesty class of bug is real: the confirmation
  dialog's loading spinner clears and the dialog closes the instant the
  action is invoked, not when the real request actually finishes, since
  `.mutate()` doesn't return a promise the caller's `await` can meaningfully
  wait on. Flagged, not fixed — out of scope for the apps/web-only session
  that found it (2026-09-19).
  Resolved 2026-09-25, fc9612c (session 2026-09-25-backlog-sweep), disable/enable admin, delete ability, revoke role/ability use mutateAsync; Confirmation shows the error; code-archive/admin-frontend/CA-0022.
