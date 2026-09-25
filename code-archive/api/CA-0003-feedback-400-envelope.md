# CA-0003: Feedback empty-update 400 used a bare `{error}` body

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Consistency |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/api/backlog.md (found 2026-09-17) |
| Commit | `b9c9f67` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

The "provide at least one field" guard on `PATCH /admin/feedback/:feedbackId` replied `{error: "..."}` instead of the standard `{success, message, code, data, requestId}` envelope.

## Root cause

The route wrote the reply by hand instead of throwing a typed error.

## Fix

The guard throws `ValidationError`, so the global error handler produces the standard 400 `VALIDATION_ERROR` envelope.

## Files changed

- `apps/api/src/modules/feedback/presentation/http/feedback.routes.ts`

## Tests

- tests/e2e/apiBacklogFixes20260925.test.ts: "throws the standard VALIDATION_ERROR (400) instead of a bare {error} body"

## Verification

Unit test.

## Follow-ups / not done

None.
