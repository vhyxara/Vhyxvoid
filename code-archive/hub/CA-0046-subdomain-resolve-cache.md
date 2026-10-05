# CA-0046: Every public tunnel request cost one Upstash GET to resolve its host

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | hub |
| Type | Performance |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/hub/backlog.md (found 2026-09-25) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

`SubdomainRegistry.resolve` read Redis on every public request and WebSocket upgrade.

## Root cause

No in-process cache.

## Fix

`resolve` answers found entries from memory for 5 s (`cacheTtlMs`, 0 disables). `register` stores the entry, `unregister` drops it whenever it touches that agent's key (including a superseded compare-and-delete), `unregisterAllForHub` clears it. A write counter stops a read that overlapped a write from caching what it read. Misses are not cached.

## Files changed

- `apps/hub/src/services/SubdomainRegistry.service.ts`
- `tests/e2e/subdomainResolveCache.test.ts`

## Tests

- tests/e2e/subdomainResolveCache.test.ts (9 tests)

## Verification

4 fail on the old code (the cache ones); the overlap test fails with the write-counter guard removed. subdomainRegistryRace and evictionReleasesSubdomain still green.

## Follow-ups / not done

Multi-hub: a change made by another instance can go unseen for up to 5 s (single hub today).
