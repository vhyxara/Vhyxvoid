# CA-0001: Feedback triage writes no AdminAuditLog entry

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Bug fix |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-17, apps/admin Screen 7) |
| Commit | `b9c9f67` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`PATCH /admin/feedback/:feedbackId` changed a feedback item's status, priority or admin notes without writing an `AdminAuditLog` row. Every other admin mutation (users, roles, abilities) is audited, so feedback triage was invisible in the audit log.

## Root cause

`AdminUpdateFeedbackUseCase` only had the feedback repository; there was no `AuditAction` for feedback and nothing wrote a log row.

## Fix

- Added `AuditAction.FEEDBACK_UPDATED = 'feedback.updated'` and its label ("Feedback triaged").
- `AdminUpdateFeedbackUseCase` now takes the audit-log repository and writes one row per update, with `before`/`after` of `{status, priority, adminNotes}`, the acting admin's id and the request metadata (IP, user agent).
- The route passes `getAdminContext(request).id` and `getAuditMetadata(request, 200)`.

## Files changed

- `apps/api/src/modules/feedback/application/use-cases/index.ts`
- `apps/api/src/modules/feedback/presentation/http/feedback.routes.ts`
- `apps/api/src/modules/identity/domain/entities/admin/AdminAuditLog.entities.ts`

## Tests

- tests/e2e/apiBacklogFixes20260925.test.ts: "records feedback.updated with before/after triage fields and the acting admin"
- tests/e2e/adminFeedbackDetailAuth.test.ts: fake Fastify gained `uow.adminAuditLogRepository`

## Verification

Full root suite green. Not exercised against a live database this session.

## Follow-ups / not done

Feedback save and audit write are two separate statements (not one transaction), the same as the other audited admin routes.
