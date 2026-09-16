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
- [ ] apps/web has a ~37-file pile of unreachable dead `.jsx`/`.js` code
  under `libs/ui/`, `libs/card-statistics/`, `libs/styles/`, and most of
  `libs/components/*.jsx` that still contains real, uncommented `@mui`/
  `@mui/lab` imports — confirmed zero importers anywhere (no barrel/index
  file, no dynamic `import()`, no alias reference) for every file in the
  pile; the only cross-references are within the pile itself (e.g.
  `FileUploadDialog.jsx` → `DragAndDropComponent.jsx`). Same category as
  the 4 dead `.jsx` files already flagged this session for referencing
  `TextField.tsx` — just a much larger slice of the same pre-existing
  pile, only fully enumerated now via an `@mui`-specific grep across
  `.jsx`/`.js` (not just `.tsx`/`.ts`). Not touched during Phase 4 part 3
  (none of it gated `ThemeProvider`/`CssBaseline`), but it's now the
  single largest concentration of raw `@mui` source text left in the
  tree and worth a dedicated delete-or-archive pass. Found 2026-09-16,
  Phase 4 part 3 session (decision.md, "Phase 4 part 3").
- [ ] apps/web's now-fully-unused `@mui/lab`/`@mui/material`/
  `@mui/material-nextjs`/`@mui/utils` packages have not been removed from
  `package.json` yet — deliberately deferred out of the Phase 4 part 3
  session since it touches `package.json`/`pnpm-lock.yaml` (a
  whole-workspace-affecting change) rather than pure `apps/web` source.
  Keep `@emotion/styled`/`@emotion/react`/`@emotion/cache` — still
  genuinely used directly by `libs/layout/shared/Logo.tsx`, independent
  of MUI. Found 2026-09-16, Phase 4 part 3 session (decision.md, "Phase 4
  part 3").
- [ ] `Register.tsx`'s new `grid grid-cols-2 gap-4` (matching
  `ProfileView.tsx`'s already-shipped precedent) doesn't match this app's
  own `theme.spacing(N)` → Tailwind-`N` mapping: MUI's `Grid spacing={2}`
  would map to `gap-2` by that convention, but both real usages use
  `gap-4` instead. Not resolved — matched the existing precedent for
  consistency per explicit instruction, but the spacing-unit-math
  discrepancy itself is unexplained and worth a small design-system
  cleanup pass later (either the mapping convention or these two
  components is wrong). Found 2026-09-16, Phase 4 part 3 session
  (decision.md, "Phase 4 part 3").
- [ ] `apps/web`'s `/notification/notifications` endpoint (and likely its
  `read`/`read-all` siblings) returns a bare `{notifications, unreadCount}`
  body with no `success`/`data` wrapper, unlike every other apps/api
  route — found 2026-09-16, Phase 3 part 1 session, while confirming the
  `AppNotification.message`/`body` field-name bug. Not itself a bug (the
  frontend already expects the bare shape), just an API-convention
  inconsistency worth normalizing if this module gets touched again.
