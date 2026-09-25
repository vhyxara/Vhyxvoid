# CA-0031: Tunnel WebSocket: frames sent right after open were dropped

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Bug fix |
| Severity | High |
| Status | Fixed |
| Source | new finding, 2026-09-25 end-to-end run |
| Commit | `c415239` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

A browser message sent immediately after the WebSocket opened (chat hello, GraphQL `connection_init`, subscribe) never reached the backend.

## Root cause

The hub answers the browser's upgrade before the agent's socket to the local backend is open; `BackendProxy.sendWebSocketMessage` silently ignored frames while that socket was CONNECTING.

## Fix

Frames arriving while CONNECTING are buffered and flushed in order on `open`; bounded (256 frames / 4 MB), past which the connection is failed instead of dropping frames mid-stream.

## Files changed

- `packages/agent/src/proxy/BackendProxy.ts`

## Tests

- tests/e2e/agentWsEarlyFrames.test.ts (new): in-order delivery (text + binary); bounded buffer fails the connection. Both fail on the old code.

## Verification

Live repro script: before, the backend never got "hi"; after, `BACKEND got hi` / `CLIENT got echo:hi`. e2e WebSocket echo step passes.

## Follow-ups / not done

Ships with the next agent release.
