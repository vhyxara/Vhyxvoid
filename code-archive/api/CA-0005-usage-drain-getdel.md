# CA-0005: Usage drain lost increments landing between GET and DEL

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Bug fix (data loss) |
| Severity | Medium |
| Status | Partially fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-24, usage-drain fix session) |
| Commit | `b9c9f67` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`RedisApiKeyCacheService.drainUsageCounters()` read every counter with a pipelined `GET` and then deleted them all with a separate `DEL`. An `INCRBY` that landed between the two was deleted without being read.

## Root cause

Read and delete were two separate steps.

## Fix

Each counter is read with `GETDEL` inside the pipeline (supported by `@upstash/redis` 1.36.1 pipelines), and the trailing `DEL` is gone. An increment that lands after the `GETDEL` starts a new key that the next tick drains.

## Files changed

- `apps/api/src/modules/key-management/domain/services/RedisApiKeyCache.service.ts`
- `tests/e2e/usageDrainUpstashShape.test.ts`
- `tests/e2e/publicPathUsageRollup.test.ts`

## Tests

- tests/e2e/usageDrainUpstashShape.test.ts: "reads with GETDEL and issues no separate DEL" (a concurrent INCRBY right after the read survives)
- Existing drain tests' fakes moved from get/del to getdel

## Verification

17 drain/rollup tests green.

## Follow-ups / not done

Still open (kept in api/backlog.md): the counter is deleted before `FlushUsageWorker` writes Postgres, so a failed upsert still loses that tick's count (it is logged).
