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
- [ ] apps/web Phase 4: the blank-layout-pages illustration-panel problem
  — full design already produced and ready to execute directly, no
  re-investigation needed: see decision.md, 2026-09-16 ("Phase 4 part 1")
  for the complete plan (a shared AuthIllustrationPanel component + a new
  useBreakpointDown hook + Tailwind's built-in rtl: variant, CSS-only, no
  VhyxUI primitive needed). That entry also found the illustration panel
  alone does NOT fully unlock ThemeProvider/CssBaseline removal —
  Register.tsx's MUI Grid, and useImageVariant.ts/useLayoutInit.ts/
  ModeChanger.tsx's real useColorScheme()/setMode() calls (used by BOTH
  route groups, not just blank-layout-pages) also need clearing first,
  in the sequence the plan lays out
- [ ] `apps/web/src/@core/components/mui/TextField.tsx` is now fully dead
  (zero importers anywhere — its last two consumers, CreateOrgDialog.tsx
  and FeedbackButton.tsx, were migrated off it in Phase 2 and Phase 3
  part 2 respectively) — found 2026-09-16, Phase 4 part 1 session. Safe
  to delete outright, independent of the rest of Phase 4's design.
- [ ] `apps/web`'s `/notification/notifications` endpoint (and likely its
  `read`/`read-all` siblings) returns a bare `{notifications, unreadCount}`
  body with no `success`/`data` wrapper, unlike every other apps/api
  route — found 2026-09-16, Phase 3 part 1 session, while confirming the
  `AppNotification.message`/`body` field-name bug. Not itself a bug (the
  frontend already expects the bare shape), just an API-convention
  inconsistency worth normalizing if this module gets touched again.
