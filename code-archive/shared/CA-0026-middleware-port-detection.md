# CA-0026: @vhyxvoid/middleware assumed port 3000 (audit part2 G8)

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Bug fix (DX) |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (filed 2026-09-25 from audit part2); approach decided 2026-09-25 |
| Commit | `4a3131f` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

With no `port`/`VHYXVOID_PORT`, the tunnel forwarded to 3000; an app on any other port got silent 502s.

## Root cause

Express middleware can't see `app.listen`; the port was a config default only.

## Fix

- `AgentClient.setPort()`/`getPort()`: switches the local target without reconnecting (BackendProxy base URL, local discovery payload; the response cache is cleared).
- Middleware config records `portExplicit`. When false: Express adopts `req.socket.localPort` on the first request; Fastify adopts `server.address().port` in `onListen` (falls back to the first request on Fastify versions without it). One log line says so. An explicit port is never overridden.
- `getTunnelAgent()` exported for status checks.

## Files changed

- `packages/agent/src/{AgentClient.ts,proxy/BackendProxy.ts,discovery/LocalDiscoveryServer.ts}`
- `packages/middleware/src/{config.ts,index.ts,fastify.ts,tunnel.ts}`

## Tests

- tests/e2e/middlewarePortDetection.test.ts (new): setPort forwards to a second real backend; invalid ports rejected; Express adopts 4321 from the first request; explicit 5000 kept; a real Fastify server on an ephemeral port is adopted via onListen

## Verification

5 new tests green, full suite green.

## Follow-ups / not done

`@vhyxvoid/next` still detects the port from `-p`/`--port` in the start command; Next has no request hook here.
