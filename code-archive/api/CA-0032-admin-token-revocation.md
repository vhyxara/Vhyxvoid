# CA-0032: Admin logout didn't revoke the admin's access token

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Security |
| Severity | Medium |
| Status | Fixed (in repo; needs deploy + migration) |
| Source | internal-tools/api/backlog.md (2026-09-24, H2 session) |
| Commit | `3eecfae` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

After admin logout the access token stayed valid for up to 15 minutes.

## Root cause

`AdminUser` had no `tokenVersion` (users do since H2).

## Fix

- Migration `20260925200000_admin_token_version`: `AdminUser.tokenVersion INT NOT NULL DEFAULT 0`.
- Admin login/refresh sign `tokenVersion`; the admin guard compares it with the cached auth state (tokens without the claim count as 0, so existing sessions keep working).
- Logout bumps it atomically and invalidates the cached state; `refreshToken` in the logout body is now optional.

## Files changed

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260925200000_admin_token_version/migration.sql`
- `apps/api/src/modules/identity/{domain/entities/admin/AdminUser.entities.ts,infrastructure/prisma/admin/PrismaAdminRepositories.ts,domain/repositories/admin/Admin.repositories.ts,infrastructure/auth/AuthStateCache.service.ts,presentation/plugins/adminAuthGuard.plugin.ts,presentation/http/admin/admin.routes.ts,application/use-cases/admin/{AdminLogin,AdminRefreshToken}.usecase.ts,application/dto/admin.dto.ts}`

## Tests

- tests/e2e/accessTokenRevocation.test.ts: "admin logout makes the admin's access token fail on the next request" (fails without the guard check)
- e2e step "admin: logout revokes the admin access token"

## Verification

Unit + live.

## Follow-ups / not done

`prisma migrate deploy` must run before the new api serves requests.
