# CA-0014: Agent retried once a second forever on a wrong secret or missing scope

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Bug fix |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (found 2026-09-21) |
| Commit | `d61f681` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

On `INVALID_SIGNATURE`, `SCOPE_MISSING`, `KEY_REVOKED`, `KEY_EXPIRED` and `AGENT_LIMIT_REACHED` the agent reconnected every second forever. `onHubError` only stopped on `AUTH_FAILED`/`VERSION_UNSUPPORTED`.

## Root cause

Two problems. (1) The stop list was too short. (2) The reconnect delay was reset in `onOpen` (every TCP open), so a connection that opened and was then refused always retried after the initial 1 s.

## Fix

- `FATAL_STOP_CODES` = AUTH_FAILED, VERSION_UNSUPPORTED, INVALID_SIGNATURE, SCOPE_MISSING, KEY_REVOKED, KEY_EXPIRED: the agent stops.
- The backoff resets in `onRegistered` (a real success) instead of `onOpen`.
- `AGENT_LIMIT_REACHED` keeps retrying (a slot may free up) but now backs off 1 s, 2 s, 4 s ... up to 5 min.
- The CLI exits with status 1 when the agent stops for a reason other than Ctrl+C/SIGTERM (part of audit part2 F10).

## Files changed

- `packages/agent/src/AgentClient.ts`
- `packages/agent/src/cli.ts`

## Tests

- tests/e2e/agentFatalHubErrors.test.ts (new, real WebSocket server): stops on each of 5 codes with exactly one connection; AGENT_LIMIT_REACHED keeps retrying with a growing delay; backoff resets only after hub:registered

## Verification

6 of 7 new tests fail on the old AgentClient (AUTH_FAILED already worked) and all pass on the new one.

## Follow-ups / not done

Ships with the next agent release (and next/middleware, which bundle it). Docs updated with "not released yet" notes.
