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
- [ ] apps/web `ThemeProvider`/`CssBaseline` removal: full design ready
  to execute directly, no re-investigation needed — see decision.md,
  2026-09-16 "Phase 4 part 2b" for the complete plan and exact code for
  every file. Five things gate the actual removal, all now designed: (1)
  `Register.tsx`'s MUI `Grid` → plain `grid grid-cols-2 gap-4` div,
  trivial; (2) `useImageVariant.ts`/`useLayoutInit.ts`/`ModeChanger.tsx`'s
  real `useColorScheme()`/`setMode()` calls → a new `useResolvedMode()`
  hook (wraps `react-use`'s `useMedia`, not a new `matchMedia` listener)
  for `useImageVariant.ts`; `useLayoutInit.ts` drops its now-fully-unused
  `useSettings` import too once the MUI block is gone;
  `ModeChanger.tsx` keeps its `data-theme` write but fixes a real,
  currently-live bug found this session — its effect only depended on
  `[settings.mode]`, so a live OS dark-mode toggle while
  `settings.mode === 'system'` has never updated `data-theme` at all
  (only MUI's `setMode()` caught that case, for MUI components only) —
  now depends on `[settings.mode, isDark]` too; (3) `app/layout.tsx`'s
  `InitColorSchemeScript` (newly found this session — a real MUI import
  in the *root* layout no prior phase named individually) → delete
  outright, no replacement needed (`data-theme={systemMode}` already
  covers VhyxUI's own SSR flash-prevention on the same line); (4) the
  actual deletion of `libs/theme/index.tsx`'s `ThemeProvider`/
  `CssBaseline`/`AppRouterCacheProvider` wiring, `Providers.tsx`'s import
  of it, and the ~44-file `@core/theme`/`libs/theme` construction tree
  that only exists to feed it; (5) the already-dead `TextField.tsx`
  below, independently deletable any time. Confirmed NOT a blocker,
  informational only: `libs/layout/shared/Logo.tsx` uses
  `@emotion/styled` directly (invisible to every prior `@mui`-string
  grep) but its styled callback never reads `theme` — zero
  `ThemeProvider` coupling, checked directly not assumed.
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
