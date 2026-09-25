# CA-0017: @vhyxvoid/next started the tunnel under next dev on CI

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Bug fix |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (found 2026-09-25) |
| Commit | `d61f681` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`@vhyxvoid/middleware` skips CI since `bd02394`; `@vhyxvoid/next` did not.

## Root cause

The CI check was only added to middleware.

## Fix

`withVhyxvoid`'s default is now `isDev && !isCI()` (same `CI` rule as middleware). `enabled: true` still forces it on.

## Files changed

- `packages/next/src/index.ts`

## Tests

- tests/e2e/frameworkSignalsAndCi.test.ts: "does not start in development when CI is set, unless enabled: true"

## Verification

Unit test.

## Follow-ups / not done

Ships with the next @vhyxvoid/next release.
