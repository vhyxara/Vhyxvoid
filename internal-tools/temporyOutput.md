# Temporary output: every doc change made in the E1-E7 investigation (2026-09-22)

Read-only digest, copied verbatim from the real files. Delete this file after reading.
No source code was changed. Everything below lives under `internal-tools/` (gitignored).

Files touched: 9 (shared x4, admin-frontend x3, api x2 contexts/decisions, docs x1). Sections are in order of importance.

---

## 1. NEW decision entry (main write-up: contradiction resolved, plan, sequencing, questions)

**File:** `shared/decision.md (appended at the end)`

### 2026-09-22 — E1-E7 plan-limit enforcement: verified state and fix plan (investigation only); GracePeriodWorker contradiction resolved

**Decided by:** Claude Code (investigation session; nothing implemented; the sequencing and the "decisions needed" below are recommendations for Tanveer to confirm)
**Context:** `admin-frontend/backlog.md` (from the 2026-09-22 Admin Panel v2 investigation) listed E1-E7 and said `GracePeriodWorker` "is never instantiated or scheduled (re-grepped 2026-09-22)". The api log's 2026-09-14 entry "Schedule GracePeriodWorker" says the opposite. Brief: resolve that first, re-verify E1-E6 from the code, then plan.

**Part 1 — the contradiction. The 2026-09-22 claim was wrong; there was no regression.**
- `billing.plugin.ts` (lines ~160-170) does `new GracePeriodWorker(fastify.prisma)`, `.start()`, and `.stop()` in an `onClose` hook. `register.plugin.ts:39` registers `billingPlugin`; `server.ts:47` calls `registerPlugins`; the compiled `apps/api/dist/.../billing.plugin.js` contains it.
- History: `31df389` (2026-09-14 04:14) added the registration; `git diff 31df389 HEAD` on both `billing.plugin.ts` and `GracePeriod.worker.ts` is empty, so no revert, no merge-conflict drop. `31df389` is an ancestor of the server's checkout `e1f6f4d`. The migration-skip override was unrelated (it only changed the container CMD; it is also gone now, `8d40484`, and `docker-compose.override.yml` no longer exists in the repo).
- Why the earlier session concluded otherwise cannot be recovered (its search command is not recorded; its own doc cites "api decision 2026-09-13", the entry *before* the fix, not 2026-09-14). Two things that I observed and that would produce that result, stated as hypotheses only: (1) in this repo's zsh, an unquoted `grep --include=*.ts ...` aborts with `no matches found` and prints nothing, which reads as "zero references" (it happened to me this session before I quoted the glob); (2) the instantiation is in `presentation/plugins/billing.plugin.ts`, not next to the worker in `infrastructure/workers/`, and ~100 lines of commented-out earlier versions precede it. Lesson kept: search by class name across the whole tree, quoted, and confirm the result by reading the plugin registration chain, not just a grep count.
- Not verifiable from here: that the running production container logged `[billing] GracePeriodWorker started` (no server access). Check with `docker compose logs api | grep GracePeriodWorker`.
- **What PAST_DUE really does today (ran, not just read):** the hub refuses it at the handshake (`AUTH_FAILED "Account is not active"`, fatal, agent stops), exactly as claimed. **And the worker is registered but cannot fire**, for a different reason than the one claimed: the webhook clears `graceEndsAt` (Known Risks #57, E7). So the true state is worse than either side of the contradiction: refused at the hub from the first failed payment, never suspended, plan limits kept at the API, indefinitely.

**Part 2 — E1-E6:** all six re-verified as described, with corrections and additions recorded in Known Risks #57 (line drift `:221` to `:229`; E2 "rotate-seeded" wrong; new E2b ENTERPRISE `null` rate limit, ran; E4 value is read by nothing; E5 checked per limit, the four are in four different states; E6's cache-staleness and no-live-eviction).

**Part 3 — fix plan.** Inline fixes: none made. The two candidates were one-liners on paper and neither qualified: E1 needs the hub to learn an account's plan (not a constant swap), and E4's value is dead, so changing it fixes nothing. The one genuinely trivial fix found (E2b, map non-finite to `-1` in `buildCachePayload`) is held back per the brief's "report, don't fix" default and is the first item of Session 3.

Dependencies that decide the order:
1. **E7's webhook fix must precede E6's opening of PAST_DUE.** If the hub is made to accept PAST_DUE first, a PAST_DUE account (grace never set) gets service forever for free. Worker-fix-first is safe: PAST_DUE is still refused, and it then becomes SUSPENDED after 7 days.
2. **Suspension is only real if it can cut live tunnels.** No status check exists on live traffic and nothing evicts connected agents, so E6's opening should also wait for the eviction sweep, otherwise grace expiry does nothing to a connected agent. The same mechanism serves the planned admin "suspend account" action (`admin-frontend/decision.md` 2026-09-22, Admin Panel v2 #6).
3. **E1, E2, E3/E4 and E5's request cap all need the hub to know an account's plan.** `PLAN_LIMITS` lives in `apps/api`, so it must first move to a package both can import (`packages/protocol` already holds a duplicate of the agent numbers). Build that once.
4. **E1's fix must exclude the same-label session from the count** (see #57) or FREE users get refused on reconnect.
5. **E5's monthly cap needs counting first** (HTTP path counts nothing; the SDK path double counts) before any cap can be honest.

Sessions (S1 and S2 are API-only and independent of each other; S3-S5 touch the hub and have the ordering constraints above; S4 needs S1, S5 needs S3):
- **S1 (API only, low risk): make grace expiry real (E7).** In `handleSubscriptionUpsert` stop writing `graceEndsAt: null` when the mapped status is PAST_DUE (set it only if absent: `now + GRACE_PERIOD_MS`; clear on ACTIVE/CANCELED); in `handleInvoicePaymentFailed` drop the `!sub.isPastDue()` guard for the account effect (set-if-absent, so Stripe's retries neither slide the deadline nor resend the email); one-off SQL for existing `PAST_DUE` rows with null `graceEndsAt` (`updatedAt + 7d`; none exist in production today). Tests drive the real use case with both event orders (the scratch script is the template) plus a worker test on the resulting state. Review the `default -> PAST_DUE` mapping (`incomplete`, `paused`): a failed first checkout should not earn a grace period. Verify once with `stripe trigger` in test mode (not done here).
- **S2 (independent, API only, low-medium): `maxMembers` (E5).** Call `canAddMember` from `InviteMember` (members + pending invitations) and re-check in `AcceptInvitation`; guard existing over-limit accounts by refusing only new invites. Needs the product answer to "is a FREE org meant to be unable to invite anyone".
- **S3 (hub + shared + api, medium, behavior change): plan-aware hub (E1, E2, E2b, E4).** Move `Plan`/`PLAN_LIMITS` to a shared package (docs `check:fresh` will flag it; re-verify pages); add one plan resolver reusing `SubscriptionPlanLimitService`'s rule; hub applies `maxAgents` from it (with the same-label exclusion); `rowToCache`/`buildDbApiKeyLoader` read the plan so a cache reload equals the create-time value (rotate/update then stop resetting to unlimited); map non-finite limits to `-1`; drop or comment the dead `-1` in `authenticateAgent`. Effect: FREE drops from 5 to 1 agent. Do it before the first customer (production tables are empty).
- **S4 (hub + API, medium-high): account-status lifecycle (E6).** In this order: (a) invalidate the account's `apikey:data:*` entries whenever the webhook or worker changes status; (b) a hub sweep (~60 s, like `HeartbeatService`) that reads `account.status` for connected accounts and evicts any not connectable, with a `HubError` so the agent shows why; (c) only then a shared `CONNECTABLE_ACCOUNT_STATUSES = [ACTIVE, PAST_DUE]` replacing the two duplicated `!== 'ACTIVE'` tests. Needs S1 first. Tests: hub status matrix, eviction, and one end-to-end run against the local dev backend.
- **S5 (hub, needs product decisions, medium-high): public-path limits (E3, E5 requests).** Per-account (not per-key) limiter in the hub process (single hub, no Redis command per request; Upstash bills per command), counting via `HubUsageService` on the HTTP path, dedupe of the SDK double count, a 429 behavior, and the reset window (billing period vs calendar month). FREE's 1,000 requests/month is very low for webhook testing, so a hard cap would make the free tier nearly unusable: count and show first, enforce later.
- **S6 (copy, low): `customDomains` and retention.** Nothing to enforce (no feature; no cleanup job, and the missing job errs on the safe side). Either mark them "planned" in the plan copy or build them; a retention job deletes data, so it needs a dry-run and its own decision.

Decisions needed from Tanveer before S1/S3/S4: (1) is `PAST_DUE` meant to stay connectable during the 7 days (recommended yes; the docs already say the grace keeps service running); (2) what `incomplete`/`paused`/`unpaid` should map to; (3) accept FREE dropping to 1 agent (recommended now, while there are no customers); (4) per-account per-minute limit numbers and 429 semantics for the public path; (5) FREE `maxMembers: 1` = no invites?; (6) hard or soft monthly request cap; (7) whether a retention job is wanted.

**Docs to keep honest until S1 ships:** `internal-tools/docs/context.md` says "`GracePeriodWorker` suspends hourly" and the docs describe a 7-day grace; both are true of the code's intent and false of its behavior. Nothing in `apps/docs` changed (no code changed this session).
**Status:** active. Supersedes, for E7 only, the "GracePeriodWorker is still unscheduled" wording in `admin-frontend/decision.md` (2026-09-22, "Admin Panel v2") and `admin-frontend/context.md`/`backlog.md`; those files carry a correction.

---

## 2. NEW Known Risk #57 (verified state of E1-E7)

**File:** `shared/context.md (before 'Open Questions')`

57. **OPEN, verified 2026-09-22 against current code (investigation only, nothing fixed) — plan-limit enforcement gaps E1-E7, and the account-status lifecycle behind E6/E7 is broken end to end.** Each line below was re-read in the code and, where marked "ran", executed with scratch scripts (kept outside the repo). Full evidence, fix plan and sequencing: `decision.md`, 2026-09-22, "E1-E7 plan-limit enforcement: verified state and fix plan". Production has no customer rows (all tables empty as of 2026-09-22), so behavior changes cost nothing yet; that is the reason to fix before the first customer, not after.
    - **E7 — CORRECTED.** `GracePeriodWorker` **is** instantiated, `.start()`ed and stopped on `onClose` in `billing.plugin.ts` (commit `31df389`, 2026-09-14, never touched since; `register.plugin.ts:39` registers the plugin and `server.ts:47` calls it; compiled into `dist`; `31df389` is an ancestor of the server checkout `e1f6f4d`). The 2026-09-22 "never instantiated (re-grepped)" claim was wrong; there was no regression. **But the worker cannot fire in practice:** it selects `status = PAST_DUE AND graceEndsAt <= now`, and the Stripe webhook leaves `graceEndsAt` null in both realistic event orders (ran: `invoice.payment_failed` then `customer.subscription.updated(past_due)` gives `graceEndsAt = null`, because the upsert writes `graceEndsAt: null` at `HandleStripeWebhook.usecase.ts:335-336`; the reverse order gives null too, because `handleInvoicePaymentFailed` skips when the subscription is already PAST_DUE, `:473`). Only a lone `payment_failed` sets it (7 days). A `PAST_DUE` account therefore stays `PAST_DUE` indefinitely.
    - **E6.** `PAST_DUE` (and SUSPENDED/CANCELED) is refused at the agent handshake: `HubAuthService.authenticateAgent` line 211, `AUTH_FAILED "Account is not active"` (ran, all four statuses); the agent treats `AUTH_FAILED` as fatal and stops (`AgentClient.ts:340`). The same status test is duplicated in `packages/shared/src/validateApiKey.ts:103` (SDK path). Status comes from the `apikey:data:*` Redis entry (5 min TTL, `main.ts:71` reads cache first); **nothing invalidates it when an account's status changes** (webhook, worker), so changes reach the hub up to 5 min late. **No status check exists on live traffic:** `HttpTunnelHandler` never looks at account status and nothing evicts a connected agent, so a suspended account with a connected agent keeps serving until it reconnects.
    - **E1.** `Message.router.ts:229` `const limit = PLAN_AGENT_LIMITS.PRO;` (was cited as :221) applies 5 to every plan (FREE promises 1, ENTERPRISE unlimited). Two sources of truth for the same numbers: protocol `PLAN_AGENT_LIMITS` and api `PLAN_LIMITS.maxAgents`; `CheckPlanLimitsService.canAddAgent` has no callers. The count (`countByAccount`, `:228`) includes the same-label session that the new connection would replace, so once the limit is really 1, a reconnect before the old socket is evicted (up to 90 s) is refused with `AGENT_LIMIT_REACHED`, which the agent retries every second.
    - **E2.** `rowToCache()` (`packages/shared/src/validateApiKey.ts:219`) returns `rateLimitPerMinute: -1` on every DB reload. Only `CreateApiKey` seeds the plan value; rotate, update, revoke and expiry **invalidate** the entry, so after a rotation the key is unlimited from its first request (the earlier "create/rotate-seeded" wording was wrong for rotate). **New bug E2b (ran):** for an ENTERPRISE account `CreateApiKey` caches `rateLimitPerMinute: Infinity`, which `JSON.stringify` turns into `null`; `validateApiKey` then treats it as a limit of 0 and rejects every request `RATE_LIMITED "Rate limit exceeded: null req/min"` until the entry expires (<= 5 min). One-line fix: map non-finite to `-1` in `buildCachePayload`.
    - **E3.** `HttpTunnelHandler.handle()` (`apps/hub/src/handlers/HttpTunnel.handler.ts:73-258`; also `handleWebSocket` :260) resolves subdomain to agent to forward with no key, status or rate check (`agent.keyId` is only stored on the pending entry). This is by design (public URLs for webhooks and teammates, callers hold no key), so "validate a key here" is the wrong frame: any limit there must be per account/tunnel, not per key.
    - **E4.** `HubAuthService.authenticateAgent` returns `rateLimitPerMinute: -1` (`HubAuth.service.ts:244`); **nothing reads it** (no consumer of `auth.rateLimitPerMinute` in the hub). Changing it changes nothing; it is dead output of a handshake that never rate-limits.
    - **E5, checked independently.** `maxMembers`: `CheckPlanLimitsService.canAddMember` and the `"maxMembers"` guard key exist but have **zero callers** (`buildPlanLimitGuard` is built once, for `maxApiKeys`; `InviteMember`/`AcceptInvitation` have no plan check). `maxRequestsPerMonth`: field only; the HTTP tunnel path never counts a request, only the SDK path does, and the SDK path is **counted twice** (same Redis key `usage:{account}:{key}:requests:{5-min bucket}` incremented by `ValidateApiKeyUseCase` and again by `Message.router.ts:565`; derived from code, not run). `customDomains`: field only, the feature does not exist (no schema, route or code). `analyticsRetentionDays`: field only, no cleanup job exists (data is kept forever, the safe direction).
    - **Not a bug, but it constrains the fix:** the API resolves a plan two different ways (`CheckPlanLimitsService.getLimits` = FREE unless subscription active/trialing; `SubscriptionPlanLimitService` = latest subscription's plan unless account SUSPENDED/RESTRICTED/CANCELED/DELETED, decided 2026-09-13). The hub must reuse the second one.

---

## 3. Small edit: pointer added to the old 'rate limiting is a stub' note

**File:** `shared/context.md (Rate limiting paragraph)`

Added this sentence at the end of the paragraph:

> (Re-verified 2026-09-22, see Known Risks #57: `rowToCache` still returns `-1`, agents' `-1` is read by nothing, and the public HTTP tunnel path does no check at all.)

---

## 4. REWRITTEN + 4 NEW backlog items (E1-E5 re-verified; E2b one-liner; double count; webhook status mapping; docs wording)

**File:** `shared/backlog.md`

- [ ] Found 2026-09-19 while scoping apps/docs, **RE-VERIFIED 2026-09-22
  (all still true; corrections in brackets; full evidence and fix sessions
  S1-S6 in `context.md` Known Risks #57 and `decision.md`, 2026-09-22, "E1-E7
  plan-limit enforcement")**: (a) hub applies `PLAN_AGENT_LIMITS.PRO` (5) to
  every account (`Message.router.ts:229` [was :221]), not the account's real
  plan; (b) `packages/shared/src/validateApiKey.ts` `rowToCache()` hardcodes
  `rateLimitPerMinute: -1` on a cache-miss DB load [only `CreateApiKey`
  seeds the plan value; rotate/update/revoke *invalidate*, so a rotated key is
  unlimited at once, not just after the TTL]; (c) public subdomain HTTP
  traffic (`HttpTunnelHandler.handle`) never validates a key, by design;
  (d) `maxMembers` [has an uncalled `canAddMember` and a `"maxMembers"` guard
  key, wire it into `InviteMember`/`AcceptInvitation`], `maxRequestsPerMonth`
  [uncounted on the HTTP path], `customDomains` [feature does not exist],
  retention [no cleanup job] have no enforcement site.
  `internal-tools/api/context.md` Known Risk #4 ("enforced end-to-end") is
  over-broad accordingly.
- [ ] **Trivially safe one-liner, found 2026-09-22 (held back: investigation-only session).** ENTERPRISE keys
  are cached with `rateLimitPerMinute: Infinity`, which `JSON.stringify` turns
  into `null`; `validateApiKey` then rejects every request `RATE_LIMITED
  "Rate limit exceeded: null req/min"` until the entry expires (<= 5 min).
  Reproduced with the real use case. Fix: map non-finite to `-1` (the
  documented "unlimited") in `buildCachePayload`
  (`key-management/application/helpers/keymanagement.utils.ts:70`) and add a
  test. First item of session S3.
- [ ] Found 2026-09-22 (derived from code, not run): SDK-path requests are
  counted twice into the same Redis key
  (`usage:{account}:{key}:requests:{5-min bucket}`): once by
  `ValidateApiKeyUseCase.incrementUsage` and again by `Message.router.ts:565`
  (`usageService.increment`). The public HTTP path counts nothing. Any
  requests/month cap or usage display built on these counters is wrong until
  this is deduplicated and the HTTP path counts (session S5).
- [ ] Found 2026-09-22: `HandleStripeWebhook.subscriptionStatusToAccountStatus`
  maps `incomplete`, `paused` and any unknown Stripe status to `PAST_DUE` (the
  `default` branch). A failed first checkout would therefore start a grace
  period (once the hub accepts PAST_DUE) and, at the API, keep the
  subscription's plan limits. Review with session S1.
- [ ] Found 2026-09-22: `internal-tools/docs/context.md` says
  "`GracePeriodWorker` suspends hourly" and the docs describe a 7-day grace;
  both describe intent, not behavior, until S1 ships (the worker is registered
  but the webhook never leaves `graceEndsAt` set). Re-verify the affected docs
  pages when S1/S4 land.

---

## 5. Three small appends in existing backlog items

**File:** `shared/backlog.md`

**Rate-limit item (was line 64):** appended:

> (2026-09-22: re-verified; the agent's `-1` is additionally read by nothing, so it is dead output rather than a missing check; public-path limits must be per account, not per key; see `context.md` #57, sessions S3 and S5.)

**PAST_DUE item (was line 65):** appended:

> **2026-09-22: confirmed by running `authenticateAgent` for all four statuses (PAST_DUE, SUSPENDED and CANCELED all `AUTH_FAILED "Account is not active"`). Do NOT open PAST_DUE at the hub before the webhook fix (S1) and the live-eviction sweep (S4a/b): the grace deadline is never set today (`graceEndsAt` null), so opening it first would grant free service forever. Also: status reaches the hub through the 5-min `apikey:data:*` cache that nothing invalidates. Plan: `decision.md`, 2026-09-22, sessions S1 then S4.**

**AGENT_LIMIT_REACHED item (was line 67):** changed the reference to:

> (already noted above; `Message.router.ts:229` as of 2026-09-22; the count also includes the same-label session about to be replaced, so fix both together in S3);

---

## 6. NEW session entry (report per the session_update schema)

**File:** `shared/session_update.md (appended at the end)`

```json
{
  "session_id": "2026-09-22-e1-e7-enforcement-investigation",
  "date": "2026-09-22",
  "agent": "claude-code",
  "repo": "Black-Server (apps/api, apps/hub, packages/shared, packages/protocol)",
  "brief_summary": "Investigate plan-limit enforcement gaps E1-E7: resolve the GracePeriodWorker contradiction, re-verify E1-E6 from the code, produce a fix plan and sequencing. Investigation only.",
  "status": "completed",
  "summary": "The 2026-09-22 claim that GracePeriodWorker is never instantiated was wrong: it is registered in billing.plugin.ts (31df389, unchanged since, loaded via register.plugin.ts, in dist, ancestor of the server checkout), so there was no regression. But the worker cannot fire: the Stripe webhook leaves Account.graceEndsAt null in both realistic event orders (ran against the real use case), so PAST_DUE never expires; and the hub refuses PAST_DUE at the handshake (ran), keeps status via a 5-min cache nothing invalidates, and never evicts connected agents. E1-E6 were all re-verified with corrections (E1 line 229; E2 rotate invalidates rather than seeds; E4 value read by nothing; E5 four different states), and one new bug found and reproduced (E2b: ENTERPRISE keys cache null and every request is rejected RATE_LIMITED). A six-session fix plan with hard ordering constraints (S1 webhook before S4 opening PAST_DUE) is in shared/decision.md. No code changed.",
  "decisions_made": [
    "shared/decision.md 2026-09-22 'E1-E7 plan-limit enforcement: verified state and fix plan': contradiction resolution, sequencing S1-S6, decisions needed from Tanveer",
    "Did not fix anything inline: E1 needs plan lookup in the hub (not a constant swap), E4's value is read by nothing; the one trivially safe fix found (E2b one-liner) was held back per the brief's default and queued as the first item of S3",
    "admin-frontend/decision.md and api/decision.md carry short correction/addendum entries pointing at the shared entry (append-only files, so the wrong 2026-09-22 wording is superseded, not edited)"
  ],
  "bugs_found_fixed": [],
  "bugs_found_unfixed": [
    "Stripe webhook clears/never sets Account.graceEndsAt for PAST_DUE, so GracePeriodWorker never suspends anyone (HandleStripeWebhook.usecase.ts:335-336 and :473)",
    "ENTERPRISE keys cache rateLimitPerMinute null (Infinity through JSON) and are rejected RATE_LIMITED until the entry expires (keymanagement.utils.ts buildCachePayload)",
    "Rotate/update/revoke invalidate the key cache, so rotated keys reload with rateLimitPerMinute -1 immediately (E2, broader than documented)",
    "No account-status check on live traffic and no eviction of connected agents; account status changes do not invalidate apikey:data:* (up to 5 min lag)",
    "Hub agent-limit count includes the same-label session being replaced (reconnect refused once the limit is really 1)",
    "SDK-path usage counted twice into the same Redis key; HTTP path counts nothing",
    "subscriptionStatusToAccountStatus maps incomplete/paused/unknown to PAST_DUE"
  ],
  "files_changed": [
    "internal-tools/shared/{context,decision,backlog,session_update}.md",
    "internal-tools/admin-frontend/{context,decision,backlog}.md",
    "internal-tools/api/{context,decision}.md",
    "internal-tools/docs/backlog.md"
  ],
  "gate_results": {
    "typecheck": "not applicable, no source changed (git status clean)",
    "build": "not applicable",
    "test": "not run; three scratch scripts (kept in the session scratchpad, not the repo) executed real code: HubAuthService.authenticateAgent across 4 account statuses; HandleStripeWebhookUseCase across 3 event orders; ValidateApiKeyUseCase with an ENTERPRISE cache entry",
    "production": "not accessed; could not confirm the running api container logged 'GracePeriodWorker started' (check: docker compose logs api | grep GracePeriodWorker)",
    "stripe": "no real or test-mode Stripe event was sent; webhook behavior is from the code with faked repositories and hand-built events, and assumes Stripe sends both invoice.payment_failed and customer.subscription.updated(past_due) on a failed renewal"
  },
  "open_items_for_next_session": [
    "Tanveer to answer decisions 1-7 in shared/decision.md (PAST_DUE connectable; incomplete/paused mapping; FREE dropping to 1 agent; public-path limit numbers; FREE maxMembers; hard vs soft monthly cap; retention job)",
    "S1 first: webhook grace correctness + tests + one stripe trigger check; it gates S4",
    "Observed, not part of this brief: shared/backlog.md item (c) about docker-compose.override.yml is stale in the repo (removed in 8d40484; the server pull is unverified)"
  ],
  "context_md_updates_needed": [
    "api/context.md Known Risk #4 ('enforced end-to-end') is still over-broad; left as is, superseded by shared/context.md #57",
    "internal-tools/docs/context.md line 73 ('GracePeriodWorker suspends hourly') describes intent; tracked in docs/backlog.md"
  ]
}
```

---

---

## 7. CORRECTED: the E1-E7 line in the admin backlog (this is where the wrong 'never instantiated' claim was)

**File:** `admin-frontend/backlog.md (last line)`

- [ ] Enforcement gaps the panel must not paper over (separate backend work; most are already in `internal-tools/shared/backlog.md`): **Re-verified against the code 2026-09-22 (later the same day), with corrections; authoritative detail and fix plan in `internal-tools/shared/context.md` Known Risks #57 and `shared/decision.md`, 2026-09-22, "E1-E7 plan-limit enforcement".** E1 hub applies `PLAN_AGENT_LIMITS.PRO` (5) to every account (`Message.router.ts:229`, was cited as :221); E2 `rowToCache()` reloads `rateLimitPerMinute: -1` (only `CreateApiKey` seeds the plan value; rotate/update/revoke invalidate, so a rotated key is unlimited at once) and ENTERPRISE keys cache `null` and are rejected `RATE_LIMITED` until the entry expires (E2b, ran); E3 public HTTP tunnel (`HttpTunnelHandler.handle`) checks no key, account status or rate, by design (per-key limits cannot apply there); E4 `authenticateAgent` returns `-1` (`HubAuth.service.ts:244`) and nothing reads it; E5 four different states: `maxMembers` has an unused `canAddMember` (no callers), `maxRequestsPerMonth` is uncounted on the HTTP path and double-counted on the SDK path, `customDomains` has no feature, retention has no cleanup job; E6 `PAST_DUE`/SUSPENDED/CANCELED refused at the agent handshake (ran) and status lags up to 5 min (no cache invalidation), and connected agents are never evicted; **E7 CORRECTED: `GracePeriodWorker` IS registered and running (`billing.plugin.ts`, `31df389`), the "never instantiated (re-grepped 2026-09-22)" claim was wrong, but it cannot fire because the webhook leaves `graceEndsAt` null (ran), so `PAST_DUE` still never auto-suspends.** For the admin UI's enforcement matrix: `maxAgents` partial (wrong number), `rateLimitPerMinute` partial (SDK path only, warm cache only), `maxMembers`/`maxRequestsPerMonth`/`customDomains`/retention none, PAST_DUE grace none.

---

## 8. CORRECTED: two lines in the admin context (plan-limits table row, enforcement-gaps bullet)

**File:** `admin-frontend/context.md`

**Table row (was line 48):**

| **Plan limits** | `PLAN_LIMITS` is a code constant (`billing/domain/enums/index.ts`), not DB rows. Flat-rate FREE/PRO/ENTERPRISE (decided 2026-09-13). Enforcement as of 2026-09-21: max API keys / scopes / PROD keys / rotation **enforced** at the API; concurrent agents **hub applies the PRO limit (5) to everyone** (`Message.router.ts:229`); per-minute rate limit **effectively unenforced** (agents' `-1` is read by nothing, public HTTP tunnel checks no key, cache reload resets to `-1`); max members, requests/month, custom domains, retention **no enforcement site**; `PAST_DUE` accounts are refused by the hub though the docs promise a 7-day grace period; `GracePeriodWorker` **is registered and running** (CORRECTED 2026-09-22: the earlier "still never instantiated (re-grepped today)" was wrong, see `internal-tools/shared/decision.md`, "E1-E7 plan-limit enforcement") **but cannot fire**, because the Stripe webhook leaves `graceEndsAt` null, so `PAST_DUE` still never auto-suspends. | **Read-only reference: yes** (an "enforced / partly / not enforced" matrix). **Editing limits: no** — constants, Stripe is the plan source of truth, and the hub ignores the real plan anyway. The enforcement gaps are backend work of their own (E1-E7 in `backlog.md`). |

**Bullet (was line 74):**

- **Backend enforcement gaps this exposes (separate work; UI must not imply enforcement that isn't there):** E1 hub applies PRO's agent limit to everyone; E2 `rowToCache` reload = unlimited; E3 public HTTP tunnel does no key check (per-key rate limit never applies; the WS design doc §5 already recommends tunnel access tokens as their own project); E4 `authenticateAgent` hardcodes `-1`; E5 members / requests-per-month / custom domains / retention have no enforcement site; E6 `PAST_DUE` accounts refused at the hub despite the grace promise; E7 `GracePeriodWorker` is registered and running (this line previously said "never scheduled", which was wrong) but the webhook leaves `graceEndsAt` null so it never suspends anyone. Verified state, corrections and the fix plan for all seven: `internal-tools/shared/context.md` Known Risks #57 and `shared/decision.md`, 2026-09-22, "E1-E7 plan-limit enforcement" (supersedes api decision 2026-09-13 as the reference for E7).

---

## 9. NEW correction entry (the 2026-09-22 'Admin Panel v2' entry is append-only, so it is superseded here)

**File:** `admin-frontend/decision.md (appended)`

### 2026-09-22 — Correction: GracePeriodWorker IS scheduled; E1-E7 verified state lives in shared/

**Decided by:** Claude Code (E1-E7 investigation session; supersedes one finding, not a decision)
**Context:** The 2026-09-22 "Admin Panel v2" entry above (Findings, and the E-list in `backlog.md`/`context.md`) states `GracePeriodWorker` is "still unscheduled" / "never instantiated (re-grepped)". Re-checked against the code: it is instantiated, started and stopped in `billing.plugin.ts` (commit `31df389`, 2026-09-14; unchanged since; loaded via `register.plugin.ts:39`). The earlier claim was wrong; there was no regression.
**What still holds:** `PAST_DUE` never auto-suspends, but for a different reason: the Stripe webhook leaves `Account.graceEndsAt` null (in both event orders, run against the real use case), and the worker only selects rows with `graceEndsAt <= now`. The plan-limits matrix (A6) should treat the PAST_DUE grace as "none", not "worker missing".
**Where the detail is:** `internal-tools/shared/decision.md`, 2026-09-22, "E1-E7 plan-limit enforcement: verified state and fix plan", and `shared/context.md` Known Risks #57 (all seven items re-verified, line numbers corrected, fix sessions S1-S6, decisions needed). Recommendation 6 above (admin account suspend must also evict live agents) is confirmed: nothing evicts a connected agent today.
**Status:** active

---

## 10. ADDENDUM on item 41 (scheduling fixed, but the worker cannot fire)

**File:** `api/context.md (end of item 41)`

**Addendum 2026-09-22 (re-verified; a same-day admin-frontend note claiming it was "never instantiated" was wrong and is corrected):** scheduling is intact and unchanged since `31df389`, **but the worker cannot fire**: the Stripe webhook writes `graceEndsAt: null` on `customer.subscription.updated` (`HandleStripeWebhook.usecase.ts:335`) and skips `handleInvoicePaymentFailed`'s grace when the subscription is already PAST_DUE (`:473`), so `PAST_DUE` accounts have no deadline and are never suspended (ran against the real use case, both event orders). The test above mocks Prisma rows that already carry `graceEndsAt`, so it could not see this. Fix plan (session S1) in `internal-tools/shared/decision.md`, 2026-09-22; also see `shared/context.md` Known Risks #57.

---

## 11. NEW addendum entry to the 2026-09-14 'Schedule GracePeriodWorker' decision

**File:** `api/decision.md (appended)`

### 2026-09-22 — Addendum to the 2026-09-14 "Schedule GracePeriodWorker" entry: registration confirmed, but the worker cannot fire

**Decided by:** Claude Code (E1-E7 investigation session; no code changed)
**Context:** The 2026-09-14 entry stands: the worker is registered in `billing.plugin.ts` and is still registered as of 2026-09-22 (a competing 2026-09-22 note in `admin-frontend/` claiming otherwise was wrong and is corrected there). What that entry did not cover, and its test could not catch because it mocks Prisma with rows that already have `graceEndsAt` set: **the webhook never leaves `graceEndsAt` set in the real event sequence.** `handleSubscriptionUpsert` (`HandleStripeWebhook.usecase.ts:335-336`) writes `graceEndsAt: null` on every `customer.subscription.updated`, including when the mapped status is PAST_DUE, and `handleInvoicePaymentFailed` (`:473`) skips when the subscription is already PAST_DUE. Run through the real use case with fakes: `payment_failed` then `subscription.updated(past_due)` gives `PAST_DUE / graceEndsAt null`; the reverse order gives the same; only a lone `payment_failed` sets it. So a `PAST_DUE` account stays `PAST_DUE` forever.
**Consequence for the design above:** the "stale accounts on first deploy" reasoning is still right about `start()` sweeping immediately, but there is nothing for it to sweep. The fix belongs in the webhook (set-if-absent on PAST_DUE, clear only on ACTIVE/CANCELED), not in the worker or its registration. Plan and ordering (it must land before the hub is allowed to accept PAST_DUE): `internal-tools/shared/decision.md`, 2026-09-22, session S1.
**Status:** active. Context item 41 stays FIXED for what it claimed (scheduling); see its addendum.

---

## 12. NEW docs backlog line

**File:** `docs/backlog.md (last line)`

- [ ] Found 2026-09-22 (E1-E7 investigation, `internal-tools/shared/decision.md`): the docs' 7-day grace-period wording, `context.md`'s "`GracePeriodWorker` suspends hourly", and the plans/limits pages describe the code's intent, not its behavior, until sessions S1 (webhook sets `graceEndsAt`), S3 (hub applies the real plan's agent limit) and S4 (PAST_DUE connectable, live eviction) ship. Re-verify (`check:fresh`) after each; nothing changed in `apps/docs` this session.

---
