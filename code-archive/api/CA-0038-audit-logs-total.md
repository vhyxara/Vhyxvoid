# CA-0038: GET /admin/identity/audit-logs had no total, and its pages could come up short

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | api |
| Type | Consistency |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-17, apps/admin Screen 6; label half fixed in CA-0008) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

The audit-log list returned no total, so apps/admin could not show a count or page reliably. The repository also dropped rows with a null `adminId` (admin deleted) after `take`/`skip`, so a page could hold fewer rows than `limit` while more rows existed.

## Root cause

No `countAll()` existed and the route never called the three `countBy*` methods. The orphan filter ran in JavaScript after pagination instead of in the query.

## Fix

The orphan filter (`adminId: { not: null }`) moved into every `findMany`/`count` where clause, so pages and counts agree. Added `countAll()`. The route runs the matching count alongside the page and returns `meta: { total, limit, offset }` next to `data`; `data` stays the same bare array, so apps/admin is unaffected.

## Files changed

- `apps/api/src/modules/identity/domain/repositories/admin/AdminAuditLog.repositories.ts`
- `apps/api/src/modules/identity/infrastructure/prisma/admin/PrismaAdminAuditLogRepository.ts`
- `apps/api/src/modules/identity/presentation/http/admin/admin.routes.ts`
- `tests/e2e/apiBacklogFixes20261005.test.ts`

## Tests

- tests/e2e/apiBacklogFixes20261005.test.ts: "returns data as the same bare array plus meta.total for the unfiltered list", "counts with the same filter as the page (action)", "pages and counts with adminId not null, ..."

## Verification

All 3 fail on the old code, pass on the new. api typecheck clean.

## Follow-ups / not done

apps/admin doesn't read `meta.total` yet (`AuditLogView.tsx` still says no total exists); filed in admin-frontend/backlog.md.
