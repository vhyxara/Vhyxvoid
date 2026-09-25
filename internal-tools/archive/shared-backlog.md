# Backlog archive — shared

Resolved items from `internal-tools/shared/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: packages/*, monorepo-wide config, cross-repo items.**

## Archive

- [x] **Production cleanup needed (created by accident 2026-09-25):** one unverified user `reg-live<epoch>@uow-live.test` plus its `EmailVerificationToken` row in the production database, created by a live-check request that a VS Code port forward sent to production (api/decision.md, 2026-09-25, "#63"). Delete with: `DELETE FROM "EmailVerificationToken" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE '%@uow-live.test'); DELETE FROM "User" WHERE email LIKE '%@uow-live.test';` (check the count first).
  Resolved 2026-09-25, session 2026-09-25-prod-cleanup-and-push, deleted from production through the platform-api container (one transaction, aborting unless exactly 2 rows matched): 2 `User` rows (`reg-live1790316274@uow-live.test`, and `live-fail-register@uow-live.test` from the earlier transaction-fix session's own port-forward incident) and their 2 `EmailVerificationToken` rows. Read-only check before: those 2 users were the only users in production, and every other table checked (Session, Account, AccountMember, AuditLog, ApiKey, Notification, PasswordResetToken, AdminUser, AdminSession, AdminAuditLog) was 0; no other test patterns (s5-verify-*, solo-check@, …) existed. After: all 0.
