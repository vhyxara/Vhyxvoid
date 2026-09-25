# CA-0009: Dead and misleading code removed from apps/api

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Cleanup |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (several items, 2026-09-15 to 2026-09-24), internal-tools/admin-frontend/backlog.md, internal-tools/shared/backlog.md |
| Commit | `b9c9f67` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

Several pieces of code never ran but looked live: they misled readers and in some cases carried stale security constants.

## Root cause

Leftovers from refactors (validator unification 2026-09-13, DI rewiring, route moves).

## Fix

Removed:
- `GetAccountMembersUseCase`'s `name`/`email` sort branches (the route schema only allows `roleLevel`/`joinedAt`) and the matching type union members.
- The commented-out `fastify.decorate('uow', {})` block in `key-management/.../infrastructure/api.ts` and the commented block in `apiKeyPlugin.ts`.
- Four live-but-unused, undeclared decorations: `apiKeyRepository`, `securityEventRepository`, `updateRoleUseCase`, `deactivateRoleUseCase` (both use cases stay registered in the DI container).
- The commented-out duplicate `GET /organizations/:accountId/usage/summary` in `tunnel.routes.ts`.
- The orphaned JSDoc fragment in `admin.routes.ts` (a half-copied handler inside a comment).
- `registerBillingUseCases.ts` (never called; billing wires itself in `billing.plugin.ts`).
- `RedisApiKeyCacheService.markRequestId`, its interface entry and Redis namespace, `REPLAY_WINDOW_MS`/`SIGNATURE_WINDOW_MS` in `apikey.constant.ts` (old 60 s values next to packages/shared's real ones), and `ApiKey.buildCanonical`.

## Files changed

- `apps/api/src/modules/identity/application/use-cases/user/GetAccountMembers.usecase.ts`
- `apps/api/src/core/types/identity.types/user.types.ts`
- `apps/api/src/modules/key-management/presentation/plugins/{apiKeyPlugin.ts,infrastructure/api.ts}`
- `apps/api/src/modules/identity/presentation/plugins/{admin.plugin.ts,module.module.ts,infrastructure/core.plugin.ts}`
- `apps/api/src/modules/identity/presentation/http/{admin/admin.routes.ts,user/tunnel.routes.ts}`
- `apps/api/src/modules/billing/presentation/plugins/usecases/registerBillingUseCases.ts (deleted)`
- `apps/api/src/modules/key-management/domain/{services/RedisApiKeyCache.service.ts,entities/apiKey.entities.ts}`
- `apps/api/src/core/{constant/apikey.constant.ts,types/api-key/cacheservice.type.ts}`

## Tests

- tests/e2e/redisApiKeyCacheFailSoft.test.ts: the two markRequestId tests removed with the method

## Verification

grep for every removed symbol: no remaining callers. api typecheck and build green.

## Follow-ups / not done

None.
