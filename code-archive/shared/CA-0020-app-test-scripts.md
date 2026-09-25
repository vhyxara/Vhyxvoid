# CA-0020: apps/api and apps/hub had broken test scripts

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Tooling |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (found 2026-09-15) |
| Commit | `d61f681` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`apps/api`'s `vitest run` found zero files in its own directory; `apps/hub`'s was the npm placeholder `exit 1`. (`apps/demo-backend` no longer exists in the repo.)

## Root cause

All server tests live in the root `tests/e2e` suite.

## Fix

Both `test` scripts run `pnpm -w test` (the root suite, which is what CI runs); `apps/api`'s `test:watch` runs root vitest in watch mode.

## Files changed

- `apps/api/package.json`
- `apps/hub/package.json`

## Tests

- n/a

## Verification

`pnpm --filter @vhyxvoid/hub test` ran the full suite (it caught a real regression during this session, fixed before commit).

## Follow-ups / not done

`turbo run test` now runs the root suite once per app (api and hub); CI calls `pnpm test` directly, so it is unaffected.
