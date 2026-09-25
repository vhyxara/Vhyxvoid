# Code archive index

Newest entries at the bottom. One row per entry; the entry file has the details.

| ID | Date | Component | Type | Status | Title | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| [CA-0001](api/CA-0001-feedback-triage-audit-log.md) | 2026-09-25 | api | Bug fix | Fixed | Feedback triage writes no AdminAuditLog entry | `b9c9f67` |
| [CA-0002](api/CA-0002-feedback-list-grouped-counts.md) | 2026-09-25 | api | Performance | Fixed | Admin feedback list made 5 DB round trips for its status counts | `b9c9f67` |
| [CA-0003](api/CA-0003-feedback-400-envelope.md) | 2026-09-25 | api | Consistency | Fixed | Feedback empty-update 400 used a bare `{error}` body | `b9c9f67` |
| [CA-0004](api/CA-0004-admin-profile-update-validation.md) | 2026-09-25 | api | Bug fix | Fixed | PUT /admin/identity/users/:id answered 200 when nothing changed | `b9c9f67` |
| [CA-0005](api/CA-0005-usage-drain-getdel.md) | 2026-09-25 | api | Bug fix (data loss) | Partially fixed | Usage drain lost increments landing between GET and DEL | `b9c9f67` |
| [CA-0006](api/CA-0006-password-reset-pii-logs.md) | 2026-09-25 | api | Privacy | Fixed | Emails, IPs and user agents logged on the password-reset path | `b9c9f67` |
| [CA-0007](api/CA-0007-account-slug-and-rename-errors.md) | 2026-09-25 | api | Bug fix | Partially fixed | Personal-account rename answered 500; slugs not validated on write | `b9c9f67` |
| [CA-0008](api/CA-0008-audit-log-action-labels.md) | 2026-09-25 | api | Cleanup | Partially fixed | admin.token_refreshed had no human label | `b9c9f67` |
| [CA-0009](api/CA-0009-dead-code-sweep.md) | 2026-09-25 | api | Cleanup | Fixed | Dead and misleading code removed from apps/api | `b9c9f67` |
| [CA-0010](hub/CA-0010-public-usage-only-when-forwarded.md) | 2026-09-25 | hub | Bug fix | Fixed | Public-path usage counted requests that got 503 "agent not connected" | `96e9c69` |
| [CA-0011](hub/CA-0011-eviction-releases-subdomain.md) | 2026-09-25 | hub | Bug fix (leak) | Fixed | Evicted agents left their tunnel:sub:* Redis entry behind | `96e9c69` |
| [CA-0012](hub/CA-0012-remove-internal-proxy.md) | 2026-09-25 | hub | Removal | Fixed | Unreachable /internal/proxy and its api caller removed | `96e9c69` |
| [CA-0013](hub/CA-0013-race-test-no-wallclock.md) | 2026-09-25 | hub | Test fix (flake) | Fixed | subdomainRegistryRace test flaked under CPU load | `96e9c69` |
| [CA-0014](shared/CA-0014-agent-stops-on-fatal-auth.md) | 2026-09-25 | shared | Bug fix | Fixed | Agent retried once a second forever on a wrong secret or missing scope | `d61f681` |
| [CA-0015](shared/CA-0015-agent-response-cache-budget.md) | 2026-09-25 | shared | Bug fix (memory) | Fixed | Agent ResponseCache had no memory budget (audit part2 G5) | `d61f681` |
| [CA-0016](shared/CA-0016-signal-reraise.md) | 2026-09-25 | shared | Bug fix (DX) | Fixed | @vhyxvoid/middleware swallowed the first Ctrl+C/SIGTERM (audit part2 G6) | `d61f681` |
| [CA-0017](shared/CA-0017-next-ci-check.md) | 2026-09-25 | shared | Bug fix | Fixed | @vhyxvoid/next started the tunnel under next dev on CI | `d61f681` |
| [CA-0018](shared/CA-0018-nginx-xff-overwrite.md) | 2026-09-25 | shared | Security | Fixed (in repo; needs deploy) | Tunnel nginx block appended to a client-supplied X-Forwarded-For (audit part2 G14) | `d61f681` |
| [CA-0019](shared/CA-0019-sdk-register-not-usage.md) | 2026-09-25 | shared | Bug fix | Fixed | Each SDK connection's sdk:register handshake counted as a request | `96e9c69` |
| [CA-0020](shared/CA-0020-app-test-scripts.md) | 2026-09-25 | shared | Tooling | Fixed | apps/api and apps/hub had broken test scripts | `d61f681` |
| [CA-0021](user-frontend/CA-0021-confirmation-disabled-guard.md) | 2026-09-25 | user-frontend | Bug fix | Fixed | Per-row guards on Remove member / Revoke key were silently ignored | `fc9612c` |
| [CA-0022](admin-frontend/CA-0022-confirm-actions-mutateasync.md) | 2026-09-25 | admin-frontend | Bug fix | Fixed | Confirm dialogs closed before the request finished; disable/enable errors were silent | `fc9612c` |
| [CA-0023](docs/CA-0023-sdk-jsdoc-overrides.md) | 2026-09-25 | docs | Docs source fix | Fixed | Wrong/internal SDK JSDoc papered over by docs overrides | `d61f681` |
| [CA-0024](docs/CA-0024-docs-for-behaviour-changes.md) | 2026-09-25 | docs | Addition | Done | Docs updated for this session's behaviour changes | `fccf1dd` |
| [CA-0025](shared/CA-0025-expiry-on-every-plan.md) | 2026-09-25 | shared | Product decision | Fixed | API-key expiry allowed on every plan | `4a3131f` |
| [CA-0026](shared/CA-0026-middleware-port-detection.md) | 2026-09-25 | shared | Bug fix (DX) | Fixed | @vhyxvoid/middleware assumed port 3000 (audit part2 G8) | `4a3131f` |
| [CA-0027](api/CA-0027-personal-workspaces.md) | 2026-09-25 | api | Product decision | Fixed | Personal workspaces: Billing shown, members refused | `4a3131f` |
| [CA-0028](shared/CA-0028-remove-sqlite-queue.md) | 2026-09-25 | shared | Removal | Fixed | Agent SQLite queue and better-sqlite3 removed | `4a3131f` |
