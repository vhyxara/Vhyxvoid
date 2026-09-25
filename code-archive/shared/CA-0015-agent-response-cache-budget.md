# CA-0015: Agent ResponseCache had no memory budget (audit part2 G5)

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Bug fix (memory) |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/shared/backlog.md (filed 2026-09-25 from audit part2) |
| Commit | `d61f681` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

500-entry cap but no byte cap (500 x 10 MB bodies inside the developer's own process with next/middleware), FIFO rather than LRU eviction, a request's `Cache-Control: no-cache` ignored, and raw string-prefix invalidation.

## Root cause

Original design only bounded entry count.

## Fix

- Byte budget (default 50 MB, UTF-16 estimate of key, body and headers); a single response larger than the budget is never cached.
- LRU: a hit re-inserts the entry; eviction takes the least recently used first, for both the entry cap and the byte cap.
- A request with `Cache-Control: no-cache`/`no-store`/`max-age=0` or `Pragma: no-cache` misses (and the fresh response replaces the entry).
- `invalidatePrefix` matches whole path segments: `/users` clears `/users`, `/users?page=2` and `/users/5`, but not `/users-archive`. `/` clears everything.
- `stats()` also reports bytes.

## Files changed

- `packages/agent/src/cache/ResponseCache.ts`

## Tests

- tests/e2e/agentResponseCacheBudget.test.ts (new, 10 tests)
- tests/e2e/agentResponseCacheCallers.test.ts unchanged and green

## Verification

23 cache tests green.

## Follow-ups / not done

The audit's claim that a POST to `/users` did not clear `/users/5` was not reproducible (plain prefix matching did clear it); the real defect there was over-invalidation, now fixed.
