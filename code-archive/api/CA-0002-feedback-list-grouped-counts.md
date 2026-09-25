# CA-0002: Admin feedback list made 5 DB round trips for its status counts

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Performance |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-17) |
| Commit | `b9c9f67` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`AdminListFeedbackUseCase` ran four extra `findAll({status, limit: 1})` calls (each a `findMany` plus a `count`) just to read each status's total for the sidebar counts.

## Root cause

No repository method returned counts per status.

## Fix

- New `FeedbackRepository.countByStatus()`, implemented with one Prisma `groupBy({ by: ['status'], _count })`.
- The use case runs the page query and `countByStatus()` in parallel and maps missing statuses to 0. The response shape is unchanged.

## Files changed

- `apps/api/src/modules/feedback/domain/repositories/Feedback.repositories.ts`
- `apps/api/src/modules/feedback/infrastructure/prisma/PrismaFeedbackRepository.ts`
- `apps/api/src/modules/feedback/application/use-cases/index.ts`

## Tests

- tests/e2e/apiBacklogFixes20260925.test.ts: "calls findAll once and countByStatus once (was 5 findAll calls)"

## Verification

Unit test plus api typecheck.

## Follow-ups / not done

None.
