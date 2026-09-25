# CA-0016: @vhyxvoid/middleware swallowed the first Ctrl+C/SIGTERM (audit part2 G6)

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Bug fix (DX) |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (filed 2026-09-25 from audit part2) |
| Commit | `d61f681` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`process.once('SIGINT'/'SIGTERM', cleanup)` disables Node's default exit. A plain Express app needed two Ctrl+C, and `docker stop` waited for SIGKILL.

## Root cause

Registering any signal listener replaces Node's default handler; `cleanup` only stopped the agent.

## Fix

`cleanupThenReraise(cleanup, signal)`: stop the tunnel, then `process.kill(process.pid, signal)` if no other listener exists (ours was `once`, so it is already gone). An app with its own handler keeps control. Applied in `@vhyxvoid/middleware` and `@vhyxvoid/next`.

## Files changed

- `packages/middleware/src/tunnel.ts`
- `packages/next/src/index.ts`

## Tests

- tests/e2e/frameworkSignalsAndCi.test.ts: re-raises when alone; leaves shutdown to an app handler

## Verification

Real process check against the built dist: one SIGINT ran the cleanup and exited with status 130.

## Follow-ups / not done

Ships with the next middleware/next release.
