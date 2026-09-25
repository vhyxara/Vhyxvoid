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
- [ ] `apps/api`, `apps/hub`, `apps/demo-backend` have broken `test` npm
  scripts (`turbo run test` fails/no-ops on all three: `apps/api`'s
  `vitest run` finds zero matching files in its own dir; `apps/hub`/
  `apps/demo-backend` are placeholder `echo "Error: no test specified" &&
  exit 1` scripts) — found 2026-09-15, Phase 2 pilot session
  (`internal-tools/user-frontend/decision.md`, "apps/web gets its own vitest+jsdom+RTL test setup")
  Resolved 2026-09-25, d61f681 (session 2026-09-25-backlog-sweep), apps/api and apps/hub test scripts run the root suite (pnpm -w test); apps/demo-backend no longer exists; code-archive/shared/CA-0020.
- [ ] Agent 1.0.19 retries once a second forever on a wrong secret (`INVALID_SIGNATURE`) or a key without `tunnel:connect` (`SCOPE_MISSING`), and on `AGENT_LIMIT_REACHED`: `onHubError` only stops on `AUTH_FAILED`/`VERSION_UNSUPPORTED`, and the reconnect delay resets on each attempt (observed: `delayMs: 1000` every time against a stand-in hub). Stop (or back off hard) on `INVALID_SIGNATURE`/`SCOPE_MISSING`/`KEY_REVOKED`/`KEY_EXPIRED`. Found 2026-09-21.
  Resolved 2026-09-25, d61f681 (session 2026-09-25-backlog-sweep), agent stops on INVALID_SIGNATURE/SCOPE_MISSING/KEY_REVOKED/KEY_EXPIRED, backoff resets on hub:registered (not on open), CLI exits 1; AGENT_LIMIT_REACHED retries with growing backoff; code-archive/shared/CA-0014.
- [ ] `apps/api/src/modules/billing/presentation/plugins/usecases/registerBillingUseCases.ts`
  is dead code (confirmed again in S2 while touching `CheckPlanLimitsService`'s
  constructor there too) — `registerModules` (`module.module.ts`) never calls
  it, only `registerNotificationUseCases`/`registerIdentityUseCases`/
  `registerAdminUseCases`/`registerAccountUseCases`. Everything it registers
  (including `CheckPlanLimitsService` and `HandleStripeWebhookUseCase`) is
  actually wired live in `billing.plugin.ts` instead, which builds
  infrastructure directly rather than through the DI container. Harmless
  (never executes) but worth deleting or wiring for real next time this area
  is touched, so it stops looking like a second, competing wiring path.
  Resolved 2026-09-25, b9c9f67 (session 2026-09-25-backlog-sweep), deleted; code-archive/api/CA-0009.
- [ ] **`sdk:register` counts as a usage request.** `HubAuthService.authenticateSdkRegister` goes through `ValidateApiKeyUseCase.execute()`, which increments `usage:{account}:{keyId}:requests` on every success (`validateApiKey.ts:211`), so each SDK connection's handshake is counted like a tunnelled request. Seen live 2026-09-24: 2 requests over one connection counted 3. Decide whether a handshake should count (probably not: skip `incrementUsage` for method `SDK_REGISTER`, or pass a flag). Soft counter, not urgent. Found 2026-09-24, usage-drain fix session.
  Resolved 2026-09-25, 96e9c69 (session 2026-09-25-backlog-sweep), ValidateApiKeyParams.countUsage; authenticateSdkRegister passes false; code-archive/shared/CA-0019.
- [ ] **Agent `ResponseCache` has no memory budget (audit part2 G5).** 500-entry cap but no byte cap (500 x 10 MB bodies in the developer's own process, which is the user's app for next/middleware); FIFO not LRU; request `Cache-Control: no-cache` ignored; prefix invalidation misses `/users` -> `/users/5`. See `shared/audit-2026-09-24-part2.md` G5. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
  Resolved 2026-09-25, d61f681 (session 2026-09-25-backlog-sweep), 50 MB byte budget, LRU, request no-cache honoured, segment-aware invalidation; code-archive/shared/CA-0015.
- [ ] **`@vhyxvoid/middleware` swallows the first Ctrl+C/SIGTERM (audit part2 G6).** `process.once('SIGTERM'/'SIGINT', cleanup)` disables Node's default exit; `cleanup` only stops the agent, so plain Express apps need two Ctrl+C and `docker stop` hangs until SIGKILL. Re-raise the signal after cleanup when no other listener exists. See `shared/audit-2026-09-24-part2.md` G6. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
  Resolved 2026-09-25, d61f681 (session 2026-09-25-backlog-sweep), cleanupThenReraise() in middleware and next; code-archive/shared/CA-0016.
- [ ] **Tunnel nginx block appends to client-supplied `X-Forwarded-For` (audit part2 G14).** `$proxy_add_x_forwarded_for` lets a caller prepend any IP that backends trusting the left-most entry will believe. Overwrite with `$remote_addr` in the wildcard block and document which forwarded headers are trustworthy. See `shared/audit-2026-09-24-part2.md` G14. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
  Resolved 2026-09-25, d61f681 (session 2026-09-25-backlog-sweep), X-Forwarded-For $remote_addr in the wildcard block, verified with nginx -t and a live echo check; needs an nginx recreate on deploy; code-archive/shared/CA-0018.
- [ ] **`@vhyxvoid/next` has no CI check; `@vhyxvoid/middleware` now does (`bd02394`).** next starts the tunnel under `next dev` even with `CI=true`. Align (skip on CI unless `enabled: true`) in the next next release, or document the difference. Found 2026-09-25, session 2026-09-25-audit-part2-fixes.
  Resolved 2026-09-25, d61f681 (session 2026-09-25-backlog-sweep), next's default is isDev && !isCI(); code-archive/shared/CA-0017.
