# CA-0034: WebSocket SDK client (TunnelClient) could never authenticate

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Bug fix |
| Severity | High |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (2026-09-24) |
| Commit | `ea6e1f0` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

Every `TunnelClient` connection failed with INVALID_SIGNATURE, and a refused `connect()` never settled.

## Root cause

The client signed with the raw secret; the hub verified HMACs keyed by HMAC(pepper, rawSecret), which a client can't compute. The connect promise only settled on `sdk:registered` or a socket error.

## Fix

- `sdk:register` carries the raw secret once over TLS, like `agent:register`; the hub verifies it with the agent's code (now `HubAuthService.verifyRawSecret`: key/account status, expiry, rotation grace, scope) and keeps it with the matched hash in memory for that connection only.
- Each `sdk:request` is checked against the connection's secret and key id, then handed to the unchanged validator re-signed with the stored hash, so replay protection, rate limits, status checks and usage counting run as before.
- `connect()` rejects with the hub's code on refusal and when the hub closes before registration.

## Files changed

- `packages/protocol/src/messages.ts`
- `packages/sdk/src/TunnelClient.ts`
- `apps/hub/src/services/HubAuth.service.ts`
- `apps/hub/src/registry/Sdk.registry.ts`
- `apps/hub/src/router/Message.router.ts`

## Tests

- tests/e2e/sdkRawSecretAuth.test.ts (new, 5 tests: register ok/wrong, request passes full validator and counts usage once, wrong secret/key refused, replay refused)
- e2e: TunnelClient GET/POST through a real tunnel; wrong secret refused

## Verification

Live: first ever successful TunnelClient round trip.

## Follow-ups / not done

Ships with the next SDK release; 1.1.0 stays broken (docs say so).
