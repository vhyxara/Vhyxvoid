# Session Update Log — apps/hub

**Append-only. Never edit or delete an existing entry — if something an entry
says turns out wrong, add a new entry that corrects it and references the
original by `session_id`.**

Each entry is a fenced ```json block. One block per completed (or blocked)
task, appended at the bottom, most recent last.

**Scope: apps/hub (tunnel router/WS server) — registries, message routing, auth, subdomain/pubsub.**

Migrated 2026-09-17 from the monorepo's single `.claude/session_update.md` (see
`internal-tools/shared/decision.md`'s migration-note entry for the full
reorg rationale). Entries below moved here verbatim, in original
chronological order, because they concern this component. For the complete
cross-component chronological history, `grep` all four `session_update.md`
files by `"date"` — every entry carries its own date and session_id.

## Schema

```
{
  "session_id":              string, "YYYY-MM-DD-short-slug", unique
  "date":                    ISO date
  "agent":                   which Claude/tool ran this ("claude-code", "claude-chat", etc.)
  "repo":                    which repo this session worked in
  "brief_summary":           one line describing the task given
  "status":                  "completed" | "partial" | "blocked"
  "summary":                 2-5 sentence plain-language account of what happened
  "decisions_made":          array of strings — judgment calls made during execution;
                              anything non-trivial here should ALSO get a decision.md entry
  "bugs_found_fixed":        array of strings
  "bugs_found_unfixed":      array of strings — flagged, not silently worked around
  "files_changed":           array of paths or globs, high-level not exhaustive
  "gate_results":            object — build/typecheck/test command results, pass/fail
  "open_items_for_next_session": array of strings — anything incomplete or needing follow-up
  "context_md_updates_needed": array of strings — things this session learned that
                              context.md doesn't yet reflect; someone should fold
                              these in periodically (not automatic)
}
```

---

```json
{
  "session_id": "2026-09-12-hub-audit",
  "date": "2026-09-12",
  "agent": "claude-code",
  "repo": "VhyxVoid",
  "brief_summary": "Full Hub audit (security + reliability + the HubPubSub/inbound-replay questions), matching the depth apps/api got during the recent bugfix sessions — apps/hub had zero direct attention all project. Housekeeping: delete vhyxconfig.md (credentials rotated manually, confirmed by user). Security items authorized to fix, not just flag: unauthenticated /internal/proxy (risk #7), debug logging leaking key material (#8), RedisApiKeyCacheService.get()/markRequestId() fail-soft treatment (#32), nginx TLS cert live check (#2). Reliability items to investigate/decide/implement-if-scoped: HubPubSub stub safety + trigger condition (#9), inbound replay decision (#3), PendingRegistry crash-gap severity (#23), tunnel:ws:error routing reachability (Open Questions). Smaller fixes: onAgentClose await (#19), AgentRegistry.findByAgentId O(n)->O(1) (#20), tunnel:forward bodyEncoding (#21), protocol version check (#22), apps/hub dependency cleanup (#25). Tests required for fixes, especially security ones.",
  "status": "completed",
  "summary": "Read context.md's Hub-related risk items (2,7,8,9,19,20,21,22,23,25,28) and decision.md in full before starting, per the brief. Deleted vhyxconfig.md (confirmed untracked/gitignored via git status+log, clean local delete). SECURITY: (1) /internal/proxy — confirmed via repo-wide grep that HUB_INTERNAL_URL has no wired caller anywhere; added real auth (HUB_INTERNAL_SECRET header, timing-safe compare, apps/hub/src/utils/internalAuth.ts) that fails CLOSED (503) when the secret is unset, rather than a feature flag that could be flipped on without auth later. (2) Debug logging — grepped beyond the two named spots per the brief's explicit instruction and found worse: HubAuth.service.ts was logging the agent's PLAINTEXT raw secret via JSON.stringify(msg), not just hashes. Deleted all secret-adjacent lines outright (pepper length/expectedHash/storedHash/rawSecret); gated non-secret flow-debug lines (Message.router.ts's subdomain flow, AgentRegistry.register's per-registration log, three previously-unflagged HttpTunnelHandler.ts lines that fire on every request) behind a new HUB_DEBUG_LOGGING env var (default off). (3) RedisApiKeyCacheService.get()/markRequestId() — investigating the stated premise ('sits on the Hub's own request-validation path') found it FALSE: the Hub uses a completely separate, independently-duplicated ValidateApiKeyUseCase in packages/shared, which was already fail-soft/fail-open. The named apps/api file is real but backs a currently-dormant route (POST /gateway/v1/validate, confirmed zero callers repo-wide). Fixed it anyway: get() now fails soft (null, falls through to existing DB fallback); markRequestId() now fails OPEN (deliberately, matching packages/shared's already-established choice) — full tradeoff reasoning in decision.md. Surfaced a new, deeper risk: two independent implementations of identical validation logic with no shared source of truth (risk #37). (4) nginx cert — this sandbox turned out to have live network egress; ran the actual openssl SAN check against hub.vhyxvoid.com and api.vhyxvoid.com. Found the SAN theory was wrong to worry about (served cert is a *.vhyxvoid.com wildcard) but found something more urgent: the certificate expired 2026-08-03, over 5 weeks before today (2026-09-12) — confirmed via both openssl's own verify error and comparing NotAfter against the live system clock. This is a live production issue outside this session's reach (needs server-side certbot access) — documented precisely and flagged as the one item needing direct user action. RELIABILITY: (5) HubPubSub — traced every call site; findAgentHub/publishForward (the methods that would matter for cross-hub routing) are never called anywhere, confirming no multi-hub assumption exists to silently break. Recorded an explicit trigger condition (build Phase 2 before running more than one Hub instance for any reason) rather than leaving it open-ended. (6) Inbound replay — settled the multi-session 'no consensus reached' question: accepted as-is for pre-launch/casual usage, with an explicit trigger condition (before team reliability guarantees or related product messaging) recorded so it's a decision, not a perpetual open item. (7) PendingRegistry crash gap — assessed severity as acceptable for current single-instance/pre-launch/low-traffic deployment; tied its eventual fix to the same trigger as HubPubSub Phase 2, since both need the same underlying work. (8) tunnel:ws:error — traced the full path (Message.router -> httpTunnelHandler.handleAgentWsError -> activeBrowserWs map) and confirmed it's one shared singleton instance with no staleness; settled as reachable, not dead code. SMALLER ITEMS: (9) onAgentClose — made the WS close handler async and added await + try/catch (was a bare .catch); explicitly documented that this improves correctness/observability but does NOT eliminate the underlying cross-connection race, which needed a manual trace to correctly scope rather than being implicitly 'fixed'. (10) AgentRegistry.findByAgentId — was doing a full array scan despite an already-maintained O(1) byAgentId map sitting unused two lines above it; now uses the map directly. (11) bodyEncoding — investigating this found a real, confirmed data-corruption bug beyond the original 'fragile inference' description: BackendProxy.forward() always did bodyBuffer.toString('utf8') regardless of content type, silently corrupting binary responses (images/PDFs) before the hub's content-type sniffing on the way out ever saw valid bytes. Fixed the response path fully (protocol field + BackendProxy encode/decode + ResponseCache + HttpTunnelHandler honoring the explicit field) with a byte-for-byte round-trip test. Explicitly flagged, not fixed: the SDK/WS response path doesn't yet consume the new field, and the request direction (HttpTunnelHandler.readBody(), also unconditional utf8) has the mirrored bug — both would need auditing packages/sdk's own body-encoding assumptions, which is wider ripple than this session's contained fix. (12) Protocol versioning — checked packages/protocol/src/serializer.ts directly and found parseMessage() already throws on any v mismatch, and has since the file's very first commit; context.md's risk #22 was already wrong before this session, not a regression. No fix needed; added a regression test since nothing had verified it before. (13) apps/hub dependency cleanup — verified fastify/uWebSockets.js/pg are unused as named, then found (while doing the same verification) that bcryptjs/jsonwebtoken/pino/ioredis/zod and all six @fastify/* plugins are ALSO unused; removed all nine plus orphaned devDependencies and the now-dead uWebSockets.d.ts type file; pnpm install + hub typecheck/build both pass clean. TESTING: discovered before writing any new tests that the existing 4 e2e tests are ALL currently broken at the import stage (reference apps/hub/src/auth, apps/hub/src/store, apps/hub/src/ws_heartbeat, apps/agent/src/utils/queue — none exist in the current codebase) — real test coverage was zero, not 'thin,' and no prior session (including this project's own 2026-09-12 reconciliation pass) had actually run the suite to notice. Added vite-tsconfig-paths to tests/vitest.config.ts (new devDependency) so tests can resolve apps/hub's and apps/api's respective bare '@/' aliases correctly (a single hardcoded alias can't disambiguate two packages using the same alias name). Wrote 5 new test files (21 tests total, all passing): internalProxyAuth.test.ts, agentRegistry.test.ts, redisApiKeyCacheFailSoft.test.ts, protocolVersionCheck.test.ts, backendProxyBodyEncoding.test.ts (uses a real local HTTP server on an ephemeral port rather than mocking axios, since a root-level vi.mock('axios') didn't reliably intercept the copy packages/agent resolves under pnpm's per-package node_modules layout). Did not fix the 4 broken legacy tests (out of explicit scope). Ran full typecheck across all 8 touched packages (hub/api/agent/protocol/sdk/shared, both typecheck and build where applicable) — all clean. Updated context.md's Known Risks/Gaps section directly (items 2,3,7,8,9,19,20,21,22,23,25 updated; new items 37-38 added) and Open Questions/Configuration sections. Appended 15 decision.md entries — one per real judgment call, per the brief's explicit instruction, including full tradeoff writeups for markRequestId's fail-open choice, HubPubSub's trigger condition, the inbound-replay acceptance, and PendingRegistry's accepted risk.",
  "decisions_made": [
    "internal/proxy: real auth (shared secret, fail-closed) rather than a feature-flag gate — see decision.md",
    "Debug logging: delete secret-adjacent lines outright, gate only non-secret flow-noise behind HUB_DEBUG_LOGGING — see decision.md",
    "RedisApiKeyCacheService.markRequestId(): fail OPEN on Redis error (matches packages/shared's already-live choice), NOT fail closed — full security tradeoff reasoning in decision.md; also corrected the premise that this was the Hub's live path",
    "nginx cert: SAN question resolved as fine (wildcard cert); cert-expiry finding flagged as the one item requiring direct user action on the live server — not attempted from this session",
    "HubPubSub: confirmed safe for single-instance, decided NOT to build Phase 2 this session, recorded an explicit trigger condition instead of leaving it open-ended",
    "Inbound replay: decided ACCEPTED as-is for pre-launch usage, with an explicit revisit trigger — settles the multi-session 'no consensus reached' status",
    "PendingRegistry crash gap: decided ACCEPTED as pre-launch risk, tied to the same trigger as HubPubSub Phase 2",
    "onAgentClose: added await for correctness/observability, explicitly did NOT claim this fixes the underlying cross-connection race (which is a separate, harder problem correctly re-scoped, not solved)",
    "bodyEncoding: fixed the response path only (contained, confirmed corruption bug); explicitly flagged the SDK/WS path and the request direction as wider-ripple follow-up rather than expanding scope mid-session",
    "apps/hub dependency cleanup: expanded from the 3 named packages to 9 total once the same verification process found 6 more unused ones — documented as 'more of the same fix,' not scope creep",
    "Did not fix the 4 pre-existing broken e2e tests — flagged clearly as a new, real, high-severity finding (risk #38) instead of silently working around it or letting it stay mis-described as 'thin coverage'",
    "Added vite-tsconfig-paths as a new devDependency to make apps/hub/apps/api source testable at all under the shared vitest config — judged as the correct fix (not a hardcoded single alias) given two packages share the bare '@/' alias name"
  ],
  "bugs_found_fixed": [
    "Unauthenticated POST /internal/proxy on the Hub — now requires a timing-safe-compared shared secret, fails closed when unconfigured",
    "HubAuth.service.ts logging the agent's plaintext raw secret via JSON.stringify(msg), plus pepper/hash values — all deleted; other non-secret debug noise gated behind HUB_DEBUG_LOGGING",
    "RedisApiKeyCacheService.get()/markRequestId() (apps/api) — unguarded Redis calls now fail soft/open respectively, matching the already-fixed set()/invalidate() siblings",
    "AgentRegistry.findByAgentId() — was O(n) scanning despite an already-maintained O(1) map sitting unused",
    "onAgentClose — WS close handler now properly async/awaited with real error visibility instead of a bare fire-and-forget .catch",
    "BackendProxy.forward() — was silently corrupting every binary HTTP response (images, PDFs, etc.) via a lossy, unconditional UTF-8 decode; now correctly base64-encodes based on content-type and threads bodyEncoding through the protocol/cache/hub-response-write layers",
    "apps/hub/package.json — removed 9 confirmed-unused dependencies (fastify + all 6 @fastify/* plugins, uWebSockets.js, pg, bcryptjs, jsonwebtoken, pino, ioredis, zod) plus 3 orphaned devDependencies and a dead uWebSockets.d.ts type file"
  ],
  "bugs_found_unfixed": [
    "Live production TLS certificate for hub.vhyxvoid.com/api.vhyxvoid.com expired 2026-08-03 (5+ weeks ago as of this session) — requires direct server access (certbot renewal check) this session doesn't have; the single highest-priority action item for the user from this whole session",
    "Two independent ValidateApiKeyUseCase implementations (apps/api and packages/shared) with duplicated logic and no shared source of truth — already silently diverged once before this session found and fixed it; a real fix needs a dedicated refactor session, not a drive-by",
    "SDK/WS response path (packages/sdk) does not yet decode bodyEncoding:'base64' — binary responses via that path (as opposed to the raw HTTP tunnel path) are still corrupted; the field now propagates correctly but nothing consumes it client-side yet",
    "Request-direction body corruption: HttpTunnelHandler.readBody() also unconditionally does .toString('utf8'), so a binary upload through a tunneled subdomain would be corrupted before reaching TunnelForwardMsg.body — mirrors the now-fixed response-side bug, not yet investigated for SDK-side ripple",
    "The documented onAgentClose race (a stale subdomain key briefly surviving into a new registration for the same label) is a cross-connection race that awaiting inside one handler cannot eliminate — still open, would need a per-(accountId,label) mutex or register-time check",
    "The pre-existing 4 e2e tests (heartbeat/queueReplay/signature-success/verifySignature) remain completely broken (import paths to modules that no longer exist) — real test coverage of the pre-2026-09-12 codebase was zero, not 'thin'; not fixed this session"
  ],
  "files_changed": [
    "vhyxconfig.md — deleted (housekeeping, credentials already rotated by user)",
    "apps/hub/src/HubServer.ts — /internal/proxy auth check (fails closed), onAgentClose now async/awaited, HubServerConfig gained internalSecret",
    "apps/hub/src/utils/internalAuth.ts — new, pure/tested internal-proxy auth check",
    "apps/hub/src/utils/debug.ts — new, HUB_DEBUG_LOGGING-gated debugLog() helper",
    "apps/hub/src/services/HubAuth.service.ts — deleted secret-leaking debug logs (including the plaintext-rawSecret one)",
    "apps/hub/src/router/Message.router.ts — gated flow-debug logs behind debugLog; bodyEncoding threaded into SdkResponseMsg",
    "apps/hub/src/handlers/HttpTunnel.handler.ts — gated 3 previously-unflagged per-request debug logs; writeResponse() prefers explicit bodyEncoding over content-type sniffing",
    "apps/hub/src/registry/Agent.registry.ts — findByAgentId() now O(1); register()'s debug log no longer dumps the raw session/ws object",
    "apps/hub/src/main.ts — wires HUB_INTERNAL_SECRET from env, warns at boot if unset",
    "apps/hub/src/types/uWebSockets.d.ts — deleted (dead, matches the removed uWebSockets.js dependency)",
    "apps/hub/package.json — removed 9 unused dependencies + 3 orphaned devDependencies (risk #25, scope expanded — see decisions_made)",
    "apps/api/src/modules/key-management/domain/services/RedisApiKeyCache.service.ts — get() fails soft, markRequestId() fails open, removed stray debug console.logs in get()",
    "packages/protocol/src/messages.ts — added optional bodyEncoding to TunnelResponseMsg/SdkResponseMsg",
    "packages/agent/src/proxy/BackendProxy.ts — forward() now correctly detects binary content-type and base64-encodes instead of always UTF-8-decoding",
    "packages/agent/src/cache/ResponseCache.ts — CachedResponse carries bodyEncoding so a cache HIT doesn't lose it",
    "tests/vitest.config.ts — added vite-tsconfig-paths plugin (new devDependency)",
    "tests/e2e/internalProxyAuth.test.ts, agentRegistry.test.ts, redisApiKeyCacheFailSoft.test.ts, protocolVersionCheck.test.ts, backendProxyBodyEncoding.test.ts — new, 21 tests total, all passing",
    "pnpm-lock.yaml — updated for dependency removal/addition",
    ".claude/context.md — Known Risks/Gaps items 2,3,7,8,9,19,20,21,22,23,25 updated; new items 37,38 added; Open Questions and Configuration sections updated",
    ".claude/decision.md — 15 new entries, one per real judgment call this session made"
  ],
  "gate_results": {
    "pnpm --filter @vhyxvoid/hub typecheck": "pass",
    "pnpm --filter @vhyxvoid/hub build": "pass",
    "pnpm --filter @vhyxvoid/api typecheck": "pass",
    "pnpm --filter @vhyxvoid/agent typecheck": "pass",
    "pnpm --filter @vhyxvoid/protocol build": "pass",
    "pnpm --filter @vhyxvoid/sdk typecheck": "pass",
    "pnpm --filter @vhyxvoid/shared typecheck": "pass",
    "combined turbo typecheck across hub/api/agent/protocol/sdk/shared": "8/8 tasks pass",
    "new test suite (5 files, 21 tests)": "all pass",
    "pre-existing test suite (4 files)": "all 4 still fail at import stage — confirmed pre-existing, unrelated to this session's changes, not fixed (see bugs_found_unfixed)",
    "live TLS check against hub.vhyxvoid.com and api.vhyxvoid.com": "SAN confirmed correct (wildcard); certificate confirmed EXPIRED since 2026-08-03"
  },
  "open_items_for_next_session": [
    "URGENT, user action required: renew the expired TLS certificate on the live server (certbot renewal appears broken) — this session cannot reach the server to fix it",
    "Two independent ValidateApiKeyUseCase implementations (apps/api, packages/shared) should get a dedicated refactor session to pick one canonical source of truth",
    "SDK-side bodyEncoding consumption (packages/sdk's TunnelClient/client.ts) needed to fully close the binary-response-corruption fix for the WS/sdk:request path",
    "Request-direction body corruption (HttpTunnelHandler.readBody()) needs its own investigation, including whether packages/sdk already assumes/handles binary request bodies anywhere",
    "The 4 pre-existing broken e2e tests need a dedicated session to figure out what they were meant to test against the current architecture and either fix or replace them",
    "onAgentClose's underlying cross-connection race (stale subdomain key) still needs a real fix (mutex or register-time check), not just the await/observability improvement made this session",
    "Billing model decision (risk #6/#36) still fully open, unrelated to this session",
    "GenericServerTable's query-key design gap (risk #34) and the zombie ts-node-dev process issue (risk #35) remain open, unrelated to this session",
    "This was flagged as a potentially multi-session-sized task; it fit in one session because several items resolved faster than expected (protocol versioning was already fixed, HubPubSub/PendingRegistry needed a decision not code, tunnel:ws:error needed only a trace) — but the follow-ups above are real and sizeable enough to warrant their own dedicated sessions rather than being treated as fully closed"
  ],
  "context_md_updates_needed": [
    "Done in this session — see files_changed"
  ]
}
```

```json
{
  "session_id": "2026-09-24-audit-h3",
  "date": "2026-09-24",
  "agent": "claude-code",
  "repo": "Black-Server",
  "brief_summary": "Fix audit H3: revoking, rotating or expiring an API key didn't disconnect agents already connected with it; add expiry and rotation-grace checks to agent registration; extend the S4 sweep or build an eviction event; verify live.",
  "status": "completed",
  "summary": "Confirmed all four scope points in code. The agent handshake now refuses expired keys and accepts the previous secret during the rotation grace window. The key loader reads expiresAt and the rotation fields from both cache and DB. AccountStatusSweep now also re-checks each connection's key every ~60 s and evicts with a specific reason, using S4's AUTH_FAILED/fatal path. Rotation is tracked by a fingerprint of the matched stored hash, after the first design (a role flag set at registration) turned out to miss agents connected before a rotation. Chose the sweep over a pub/sub event: expiry and grace end are time-based and need it anyway. Verified live with a real hub, api and agent: revoke evicted in 7 s; mid-session expiry evicted on the next tick, then refused at registration while still ACTIVE in the DB; rotation kept and allowed reconnect during grace, then evicted and refused after. The new secret stayed connected.",
  "decisions_made": [
    "Extend AccountStatusSweep, not a HubPubSub event (hub/decision.md, 2026-09-24, H3)",
    "Per-session fingerprint of the matched secret hash instead of a current/previous flag",
    "Key state read from Postgres per tick (not the 5-min key cache); a failed key read skips only key checks",
    "Reuse S4's eviction (hub:error AUTH_FAILED fatal) with key-specific messages"
  ],
  "bugs_found_fixed": [
    "H3: revoked/expired/rotated-out keys' connected agents kept serving (621ee3f)",
    "H3: expired-but-not-yet-marked keys could register (621ee3f)",
    "H3: rotation grace window didn't exist for agents (621ee3f)",
    "Docs claimed revocation stops everything immediately (6b65972)"
  ],
  "bugs_found_unfixed": [
    "Sweep eviction leaves the agent's tunnel:sub entry until the next request (hub/backlog.md)",
    "apps/api predev kill script also kills a concurrently starting hub ts-node-dev (local-dev nuisance; start them one at a time)"
  ],
  "files_changed": [
    "apps/hub/src/{services/AccountStatusSweep.service.ts,services/HubAuth.service.ts,repositories/TunnelSession.repository.ts,registry/Agent.registry.ts,router/Message.router.ts,main.ts}",
    "tests/e2e/agentKeyLifecycle.test.ts (11, new); accountStatusSweep.test.ts fake extended",
    "apps/docs/content/docs/{dashboard/api-keys.mdx,troubleshooting/index.mdx} content; 8 more pages re-verified"
  ],
  "gate_results": {
    "typecheck": "pnpm turbo run typecheck --continue: 10/12; web + admin fail for the known ../VhyxUI reason (untouched)",
    "build": "pnpm turbo run build --continue: 9/11, same two",
    "tests": "pnpm test: 61 files, 433 tests passing",
    "fail_first": "agentKeyLifecycle 8/11 fail on the old code (3 controls pass either way)",
    "live": "real api + hub (local Postgres, shared Upstash) + real agent: revoke evicted after 7 s and the agent exited; expiry evicted on the next tick with DB status still ACTIVE, re-register refused 'API key has expired'; rotation: old secret survived a tick and reconnected during grace, evicted with the grace-ended reason after the window closed (simulated via SQL in UTC + cache drop), old secret then INVALID_SIGNATURE, new secret registered and survived a tick",
    "docs": "check:fresh ok, docs build ok",
    "cleanup": "disposable account and its 5 keys, 69 tunnel_sessions, PRO subscription row deleted (0 remaining); 2 leftover tunnel:sub keys deleted; scratch files removed",
    "apps_web_admin_untouched": "no files under apps/web or apps/admin changed"
  },
  "open_items_for_next_session": [
    "Push: origin/main is 13 commits behind",
    "Deploy the hub per shared/backlog.md's H3 note",
    "Optional: sub-minute revocation via a targeted check on a published keyId (hub/decision.md, H3)"
  ],
  "context_md_updates_needed": []
}
```
