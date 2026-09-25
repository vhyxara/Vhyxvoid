# CA-0019: Each SDK connection's sdk:register handshake counted as a request

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Bug fix |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (found 2026-09-24) |
| Commit | `96e9c69` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`HubAuthService.authenticateSdkRegister` goes through `ValidateApiKeyUseCase.execute()`, which increments usage on every success, so 2 requests over one connection counted 3.

## Root cause

The validator had no way to know a call was a handshake.

## Fix

`ValidateApiKeyParams.countUsage?: boolean` (default true). The validator skips `incrementUsage` when it is `false`; `authenticateSdkRegister` passes `false`. Rate limiting and replay protection still apply to the handshake.

## Files changed

- `packages/shared/src/types.ts`
- `packages/shared/src/validateApiKey.ts`
- `apps/hub/src/services/HubAuth.service.ts`

## Tests

- tests/e2e/validateApiKeyUseCase.test.ts: a request counts; countUsage: false does not; authenticateSdkRegister passes countUsage: false

## Verification

22 validator tests green.

## Follow-ups / not done

None.
