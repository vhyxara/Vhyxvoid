# CA-0033: Super-admin seed had hardcoded credentials

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Security |
| Severity | Medium |
| Status | Fixed |
| Source | internal-tools/admin-frontend/backlog.md (2026-09-22, production has no admin) |
| Commit | `3eecfae` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

`seed-super-admin.ts` created `admin@company.local` / `Admin@12345678` and printed the password; there is no admin password-change endpoint, so running it in production would leave a known password.

## Root cause

Development seed reused for production.

## Fix

Reads `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` (and optional names). In production both are required and the password needs 16+ characters; the password is never printed. Development defaults unchanged.

## Files changed

- `apps/api/src/modules/identity/infrastructure/scripts/seed-super-admin.ts`

## Tests

- Run locally: dev seed works; `NODE_ENV=production` without the variables refuses

## Verification

Seeded the local stack's super admin with env credentials; e2e admin section logs in with them.

## Follow-ups / not done

Production still needs `seed-abilities`, `seed-roles`, then this seed, run deliberately.
