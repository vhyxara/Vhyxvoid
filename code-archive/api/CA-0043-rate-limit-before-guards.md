# CA-0043: Requests rejected by an auth guard were never rate limited

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | api |
| Type | Security |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-24, H1 session) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

On `userAuthGuard`/`adminAuthGuard` routes an unauthenticated flood got 401 forever instead of 429, each costing a JWT verification.

## Root cause

`@fastify/rate-limit` 10.3 attaches through an onRoute hook that appends its handler after the route's own `onRequest` hooks.

## Fix

`registerRateLimitFirst()` (core/utils) wraps the plugin registration with two root onRoute hooks: one before it records how many onRequest hooks the route declared, one after it moves what the plugin appended to the front. Applies to the global limit and per-route `config.rateLimit`. The backlog's second worry (429 without CORS headers) is unfounded: CORS is registered before the routes, so its hook runs first; verified.

## Files changed

- `apps/api/src/core/utils/rateLimitFirst.ts`
- `apps/api/src/modules/identity/presentation/plugins/register.plugin.ts`
- `tests/e2e/apiBacklogFixes20261005.test.ts`

## Tests

- tests/e2e/apiBacklogFixes20261005.test.ts: the three "registerRateLimitFirst" tests (real Fastify, rate-limit and cors from apps/api)

## Verification

All 3 fail with the reordering disabled. Only other plugin-level onRequest hook in apps/api is the request-id hook.

## Follow-ups / not done

None.
