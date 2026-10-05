# CA-0045: The agent CLI printed a dotenv tip line on every start

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | shared |
| Type | Cleanup |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (found 2026-09-19) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

`[dotenv@17.x] injecting env (1) from .env -- tip: ...` on every CLI start with an env file.

## Root cause

dotenv 17 logs by default.

## Fix

`quiet: true` on the CLI's three env-file loads.

## Files changed

- `packages/agent/src/cli.ts`

## Tests

- None (output-only change)

## Verification

Built the agent and ran `dist/cli.js --version` in a directory with a `.env`: old build prints the tip line, new build prints only `1.1.0`.

## Follow-ups / not done

The `[agent] authenticating with hub` / `tunnel is live` info lines are unchanged (a UX call). Ships with the next agent release.
