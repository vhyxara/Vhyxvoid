# CA-0012: Unreachable /internal/proxy and its api caller removed

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | hub (apps/hub) |
| Type | Removal |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/hub/backlog.md and internal-tools/api/backlog.md (both 2026-09-24, audit H8/H9 sessions) |
| Commit | `96e9c69` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`POST /internal/proxy` sent the agent `type: 'http_request'`, which neither the protocol nor the agent handles, so it could never reach a backend. Its only caller, apps/api's `POST /api/v1/tunnelproxy/request`, could never authenticate (it passed the secret header as the HMAC signature and Fastify's per-process `req-N` id as the replay id).

## Root cause

An early design left behind after the WS protocol settled on `tunnel:forward`.

## Fix

Deleted the route handler, `checkInternalAuth`, the `internalSecret` config and startup warning, the unused `pendingRequests`/`resolveRequest`, and apps/api's `tunnelProxy.routes.ts` plus its registration. `utils/internalAuth.ts` (and its test) stays, since the planned admin-v2 `/internal/stats` (H4) reuses it.

## Files changed

- `apps/hub/src/HubServer.ts`
- `apps/hub/src/main.ts`
- `apps/hub/src/utils/internalAuth.ts`
- `apps/api/src/modules/identity/presentation/http/user/tunnelProxy.routes.ts (deleted)`
- `apps/api/src/modules/identity/presentation/http/index.ts`

## Tests

- tests/e2e/internalProxyAuth.test.ts still covers the kept helper

## Verification

grep: no references to `/internal/proxy`, `tunnelproxy` or `http_request` in source. hub and api typecheck green.

## Follow-ups / not done

`HUB_INTERNAL_URL`/`HUB_INTERNAL_SECRET` are no longer read by anything until H4 is built.
