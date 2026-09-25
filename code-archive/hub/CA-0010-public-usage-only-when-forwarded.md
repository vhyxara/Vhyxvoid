# CA-0010: Public-path usage counted requests that got 503 "agent not connected"

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | hub (apps/hub) |
| Type | Bug fix |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/hub/backlog.md (found 2026-09-24) |
| Commit | `96e9c69` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`PublicPathUsageLimiter.checkRequest()` added the request to the monthly usage counter before `HttpTunnelHandler` looked the agent up, so a stale subdomain entry's traffic was counted even though it never reached an agent.

## Root cause

Rate checking and usage counting were one call, made before the agent lookup (deliberately, so a flood on a dead URL is still capped).

## Fix

Split the two: `checkRequest()` only rate-checks (still before the agent lookup); the new `recordForwarded()` counts, and the handler calls it only after it has a live agent.

## Files changed

- `apps/hub/src/services/PublicPathUsageLimiter.service.ts`
- `apps/hub/src/handlers/HttpTunnel.handler.ts`

## Tests

- tests/e2e/httpTunnelHandlerRateLimit.test.ts: "a 503 'agent not connected' is not counted as usage"; forwarded requests call recordForwarded
- tests/e2e/publicPathUsageLimiter.test.ts: "checkRequest() alone never counts toward monthly usage"; existing tests use the handler's check-then-record sequence

## Verification

36 hub tests green.

## Follow-ups / not done

None.
