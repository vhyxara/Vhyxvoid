# CA-0036: Streaming responses (SSE, NDJSON, chunked) and request cancellation

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Addition |
| Severity | High |
| Status | Done |
| Source | new finding (competitive gap) + audit part2 G13 / F3 |
| Commit | `fca13f7` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

The tunnel buffered every response: Server-Sent Events arrived all at once when finished and an endless stream never arrived (504 after 120 s). A caller that disconnected left the backend request running.

## Root cause

One tunnel:response per request by design; no cancel message.

## Fix

- Protocol: `agent:register.capabilities` (`stream`, `cancel`), `tunnel:forward.acceptStream`, `tunnel:response:start/:chunk/:end`, `tunnel:cancel`. Features are used only when the agent announced them, so every old/new agent and hub combination works.
- Agent: streams text/event-stream, NDJSON and chunked-without-length responses as they arrive, with backpressure (pause reading at 4 MB unsent) and no idle timeout once started; everything else is collected (10 MiB cap) and sent as before. Per-request AbortController; streams are aborted on hub disconnect.
- Hub: writes the head immediately (`X-Accel-Buffering: no`), chunks as they come; request timeout covers only the wait for the head; caller disconnect drops the pending request and sends `tunnel:cancel`; a caller with > 8 MB unsent has its stream cut.

## Files changed

- `packages/protocol/src/messages.ts`
- `packages/agent/src/{AgentClient.ts,proxy/BackendProxy.ts}`
- `apps/hub/src/{handlers/HttpTunnel.handler.ts,registry/Pending.registry.ts,registry/Agent.registry.ts,router/Message.router.ts}`
- `apps/docs/content/docs/limitations.mdx`

## Tests

- tests/e2e/tunnelStreaming.test.ts (new, 9 tests: capability gating, incremental delivery, cancel sent/not sent, streaming classification)
- e2e: SSE chunks ~300 ms apart; abandoned endless stream and slow request closed at the backend 2-4 ms after the caller left

## Verification

Before: 5 events delivered together after 2 s. After: one every ~400 ms.

## Follow-ups / not done

SDK clients still receive complete responses; binary framing (audit part2 A2) would remove the base64 overhead on chunks.
