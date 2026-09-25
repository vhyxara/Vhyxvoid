# CA-0028: Agent SQLite queue and better-sqlite3 removed

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Removal |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (2026-09-25, no producer; G2 shared queue file); decided 2026-09-25 by the user |
| Commit | `4a3131f` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

Nothing enqueued into `DurableQueue` (and since G3 nothing outbound either), yet every CLI user installed `better-sqlite3` (a native build on some platforms) and the agent opened `~/.vhyxvoid/queue.db`, shared by every agent on the machine (G2).

## Root cause

Leftover from an inbound-replay design the hub never implemented.

## Fix

Deleted `DurableQueue`, `NoOpQueue`, `replayQueue` and their exports; removed `better-sqlite3` from the agent's dependencies, all esbuild `--external` flags and pnpm's build allowlist. `queuePath`/`disableQueue` stay as ignored, `@deprecated` options and `--queue-path` is still accepted, so no caller or script breaks. The CLI deletes an older agent's `queue.db` (and `-wal`/`-shm`), which could hold response bodies.

## Files changed

- `packages/agent/src/{AgentClient.ts,cli.ts,index.ts}`
- `packages/agent/src/queue/*, packages/agent/src/replay/* (deleted)`
- `packages/{agent,middleware,next}/package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml (187 lines removed, none added)`

## Tests

- Deleted queueReplay, agentDurableQueueDeadLetter, agentDisableQueue tests with the code
- agentOutboundNotPersisted: no queue file even when queuePath is given
- publishedManifests: agent declares no better-sqlite3

## Verification

Full suite, typecheck and build green.

## Follow-ups / not done

Public API removal: publish as a minor (or major) agent release. Resolves G2 (shared queue file) as well.
