# CA-0040: Account usage left out SDK traffic; periodEnd was the flush time; two SCANs per account per flush

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | api |
| Type | Bug fix |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/api/backlog.md, "H4 remainder" (audit H4 items 5-7, found 2026-09-24) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

(a) `GET /organizations/:accountId/usage` without `keyId` (dashboard Analytics) read only `apiKeyId: null` rows, which hold public-path counts; keyed SDK counts were in per-key rows and never shown. (b) `UsageAggregate.periodEnd` was set to the flush time. (c) Each flush did one full `SCAN usage:*` plus another full scan per account.

## Root cause

(a) The reader filtered to the account-level rollup, which nothing writes SDK counts into. (b) `periodEnd = new Date()` in the worker; readers filtered `periodEnd <= now`, which hid the problem. (c) `listAccountIdsWithPendingUsage` and `drainUsageCounters` each scanned.

## Fix

(a) `findByAccountAndPeriod` reads every row of the account; callers already sum per time bucket (`buildTimeSeries`), and the month summary already summed all rows. (b) `periodEnd` is the bucket end (`periodStart + 5 min`); both readers window on `periodStart: { gte: start, lt: end }` and no longer filter on `periodEnd`. (c) New `listPendingUsageKeysByAccount()` does one SCAN and groups keys; `drainUsageCounters(accountId, keys?)` reuses them.

## Files changed

- `apps/api/src/core/types/api-key/cacheservice.type.ts`
- `apps/api/src/modules/key-management/domain/services/RedisApiKeyCache.service.ts`
- `apps/api/src/modules/key-management/application/use-cases/FlushUsageWorker.usecase.ts`
- `apps/api/src/modules/key-management/domain/repositories/UsageAggregate.repositories.ts`
- `tests/e2e/apiBacklogFixes20261005.test.ts`

## Tests

- tests/e2e/apiBacklogFixes20261005.test.ts: "drains several accounts with a single SCAN", "writes periodEnd as the bucket's end, not the flush time", "account-level reads include keyed rows and window on the bucket start"

## Verification

All 3 fail on the old code. `GET /api-keys/usage` (raw aggregates) now returns keyed rows in account scope too; it has no UI caller (`useApiKeyUsage` is unused).

## Follow-ups / not done

Rows already written keep their old `periodEnd`; nothing reads it now. Not checked against a real Postgres (unit fakes only).
