# CA-0039: A failed usage write lost that tick's count

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | api |
| Type | Bug fix (data loss) |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-24; first half fixed in CA-0005) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

`FlushUsageWorker` drains counters with `GETDEL` and then writes Postgres. When the write failed, the count was already gone from Redis and was only logged.

## Root cause

Read-and-delete happens before the write, with no way back.

## Fix

On a failed upsert the worker calls the new `restoreUsageCounter()`, which `INCRBY`s the count back into its original key, so the next tick retries it. The key keeps the lifetime it was written with (25 h from its bucket, not a fresh 25 h), so a write that keeps failing is retried until then and then dropped, with a log line saying which. Drained counters now carry their `redisKey`.

## Files changed

- `apps/api/src/core/types/api-key/cacheservice.type.ts`
- `apps/api/src/modules/key-management/domain/services/RedisApiKeyCache.service.ts`
- `apps/api/src/modules/key-management/application/use-cases/FlushUsageWorker.usecase.ts`
- `tests/e2e/apiBacklogFixes20261005.test.ts`

## Tests

- tests/e2e/apiBacklogFixes20261005.test.ts: "restores the drained count into Redis and the next tick writes it", "drops (and says so) a counter already past its 25 h lifetime"

## Verification

First test fails on the old code (count lost); the drop test passes either way by construction. Existing drain tests (usageDrainUpstashShape, publicPathUsageRollup) unchanged and green.

## Follow-ups / not done

A write that committed but then reported an error (e.g. a timeout after commit) would be counted twice. Soft counter, accepted.
