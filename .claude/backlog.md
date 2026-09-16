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
- [ ] apps/web's `pnpm-lock.yaml` (and root `package.json`,
  `packages/agent/package.json`, `packages/sdk/package.json`) have
  pre-existing, uncommitted local changes predating the 2026-09-16 dead-
  .jsx-pile/`@mui` package.json cleanup session, unrelated to that
  session's work — confirmed: apps/web had no importer entry in the root
  lockfile at all before that session, so any `pnpm install` regenerates
  its entire transitive dependency tree for the first time, a large diff
  regardless of what triggers it. Left uncommitted deliberately; needs
  its own review/commit pass whenever the root/agent/sdk edits are ready.
  Found 2026-09-16 (decision.md, "Phase 4 part 4: dead-.jsx-pile
  archiving + @mui package.json cleanup").
- [ ] apps/web's `@tanstack/react-query` is pinned to an exact version
  (`5.102.8`, no caret) instead of a range, to force-match the
  separately-linked `vhyx-api-kit` sibling repo's own independently
  locked devDependency version and avoid a duplicate-package-instance TS
  private-field mismatch on `QueryClient`. Fragile: if either repo's
  locked version drifts again, the mismatch can recur. Real fix would be
  making `vhyx-api-kit` not carry its own separately-resolved copy of a
  package it also declares as a peerDependency (workspace-linking it
  into the same node_modules, or a pnpm `overrides` entry pinning it
  repo-wide) — deferred as more invasive than this session's scope.
  Found 2026-09-16 (decision.md, "Phase 4 part 4: dead-.jsx-pile
  archiving + @mui package.json cleanup").
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
