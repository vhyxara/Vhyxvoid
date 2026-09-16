# Backlog

Small, already-diagnosed, non-urgent items — not the big architectural
questions tracked in context.md's Known Risks/Gaps (numbered items). When
an item here is fixed, delete its line entirely; don't check it off.

## Backlog

- [ ] `apps/api`, `apps/hub`, `apps/demo-backend` have broken `test` npm
  scripts (`turbo run test` fails/no-ops on all three: `apps/api`'s
  `vitest run` finds zero matching files in its own dir; `apps/hub`/
  `apps/demo-backend` are placeholder `echo "Error: no test specified" &&
  exit 1` scripts) — found 2026-09-15, Phase 2 pilot session
  (decision.md, "apps/web gets its own vitest+jsdom+RTL test setup")
- [ ] `GetAccountMembersUseCase` has dead `name`/`email` sortBy switch
  branches, unreachable through the validated route (`getMembersQuerySchema`
  only allows `roleLevel`/`joinedAt`) — found 2026-09-15, Phase 2 pilot
  session (decision.md, "Phase 2 pilot: Member/name column made
  non-sortable")
- [ ] kautilyan-admin and kautilyan-frontend need their own `@vhyx/api-kit`
  Phase 1 adoption sessions (package proven out in VhyxVoid only so far)
  — found 2026-09-15 (decision.md, "Phase 1 adoption: @vhyx/api-kit in
  VhyxVoid")
- [ ] kautilyan-admin needs its own Phase 2 table-pattern conversion
  session (GenericServerTable → props-based contract; kautilyan-frontend's
  `DataTable` already has the right shape, doesn't need this) — found
  2026-09-15, Phase 2 pilot session (decision.md, "Phase 2 pilot: Members
  converted to props-based table pattern")
- [ ] `Confirmation.tsx`'s dual API-call path (dead default action + a
  second, independent HTTP client) exists in kautilyan-admin too — same
  shape as VhyxVoid's now-removed dead path, but not independently
  confirmed live or dead there — found `TABLE_API_ARCHITECTURE_COMPARISON.md`
  Part 2 item 7, 2026-09-14
- [ ] apps/web Phase 3 part 2: FeedbackButton.tsx migration to VhyxUI (Phase
  0-2 and Phase 3 part 1/NotificationBell are all done, see decision.md,
  2026-09-16 "Phase 0 executed", "Phase 1 executed", "Phase 2 executed",
  "Phase 3 part 1") — full component-mapping plan already produced,
  ready to execute directly: see decision.md, 2026-09-16 "Phase 3 part
  1" for the complete FeedbackButton.tsx plan (Fab/Collapse have no
  VhyxUI equivalent; TextareaField needed for 4 of 6 form fields, not
  TextField; no Server/Client boundary risk expected)
- [ ] apps/web Phase 4: the blank-layout-pages illustration-panel problem
  (no VhyxUI breakpoint/responsive primitive as of the last check,
  2026-09-16) — see decision.md, 2026-09-16 ("Fresh MUI/Vuexy dependency
  audit") for context
- [ ] `apps/web/src/@core/components/scroll-to-top/index.tsx` (the
  wrapper around Phase 1's `ScrollToTopButton`) is itself still MUI
  (`Zoom`+`useScrollTrigger`) — missed by the original 2026-09-16 audit,
  found during Phase 3 part 1's investigation. Not scheduled to any
  phase yet.
- [ ] `apps/web`'s `/notification/notifications` endpoint (and likely its
  `read`/`read-all` siblings) returns a bare `{notifications, unreadCount}`
  body with no `success`/`data` wrapper, unlike every other apps/api
  route — found 2026-09-16, Phase 3 part 1 session, while confirming the
  `AppNotification.message`/`body` field-name bug. Not itself a bug (the
  frontend already expects the bare shape), just an API-convention
  inconsistency worth normalizing if this module gets touched again.
