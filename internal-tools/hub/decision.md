# Decision Log — apps/hub

**Append-only. Never edit or delete an existing entry.** If a decision is later
reversed, add a new entry that says so and references the original — don't
rewrite history.

This file is for judgment calls that aren't obvious from code and that a
future session (human or Claude) would otherwise have to rediscover or
re-argue. Not every decision needs an entry — routine implementation choices
belong in `session_update.md`. This file is for things where reasonable
people (or reasonable Claudes) could have gone the other way.

**Scope: apps/hub (tunnel router/WS server) — registries, message routing, auth, subdomain/pubsub.**

Migrated 2026-09-17 from the monorepo's single `.claude/decision.md` (see
`internal-tools/shared/decision.md`'s migration-note entry for the full
reorg rationale). Entries below moved here verbatim, in original
chronological order, because they concern this component. For the complete
cross-component chronological history, `grep` all four `decision.md` files
by date — every entry is still dated and self-contained.

## Entry format

```
### YYYY-MM-DD — Short title
**Decided by:** Tanveer / Claude (chat) / Claude Code / joint
**Context:** why this came up
**Options considered:** brief list
**Decision:** what was chosen
**Rationale:** why
**Status:** active / superseded by [link to later entry]
```

---

### 2026-09-12 — Full Hub audit: housekeeping (vhyxconfig.md deleted)

**Decided by:** Claude Code (Hub audit session)
**Context:** User confirmed credentials in root `vhyxconfig.md` were rotated manually outside any session. The file itself was flagged in context.md risk #11 as stale and needing removal regardless of gitignore status.
**Decision:** Deleted `vhyxconfig.md` from the repo root. Confirmed via `git status`/`git log --all -- vhyxconfig.md` it was never tracked (gitignored since first commit) — a clean local delete, no commit involved.
**Status:** resolved

---

---

### 2026-09-12 — internal/proxy authentication: fail-closed shared secret, not a feature-flag gate

**Decided by:** Claude Code (Hub audit session)
**Context:** `HubServer.ts`'s raw `POST /internal/proxy` handler forwarded to any connected agent by `agentId` with zero authentication (context.md risk #7). Confirmed first, per the brief's explicit instruction, whether anything calls it: grepped the entire repo (hub, api, sdk, agent, web) for `HUB_INTERNAL_URL`, `/internal/proxy`, and `gateway.routes` callers — no caller exists anywhere. The endpoint is genuinely dead today.
**Options considered:** (1) leave unauthenticated but gate behind a feature flag that defaults the route to 404/disabled; (2) add real shared-secret authentication now, even with no live caller; (3) delete the endpoint entirely since nothing uses it.
**Decision:** Option 2. Added `HUB_INTERNAL_SECRET` (checked via `crypto.timingSafeEqual` against the `x-hub-internal-secret` header, in a new pure/testable `apps/hub/src/utils/internalAuth.ts`). **Fails closed**: if `HUB_INTERNAL_SECRET` is unset, every `/internal/proxy` request is rejected with 503 — there is no way to accidentally ship this open. `main.ts` logs a warning at boot if the var is unset, pointing back to this entry.
**Rationale:** Option 1 (flag) still leaves a live foot-gun: someone flips the flag on for a real caller later without also adding auth, and it's open again with no visible signal. Option 3 (delete) was rejected because the endpoint models a real, plausible future feature (server-initiated agent-control, per `HUB_INTERNAL_URL`'s original intent in context.md) — deleting it destroys that shape for no safety benefit once real auth exists. Option 2 costs almost nothing (one env var, one header check) and makes the endpoint safe to leave in place indefinitely, including in its current always-503 state, until a real caller and matching `HUB_INTERNAL_SECRET` are provisioned together.
**Tested:** `tests/e2e/internalProxyAuth.test.ts` — fails closed with no secret configured, rejects missing/wrong/wrong-length header, accepts the correct secret, handles a duplicated header correctly.
**Status:** active

---

---

### 2026-09-12 — Hub debug logging: secret-adjacent lines deleted outright, flow-debug lines gated behind HUB_DEBUG_LOGGING

**Decided by:** Claude Code (Hub audit session)
**Context:** context.md risk #8 named two spots (`HubAuth.service.ts:219-221`, `Message.router.ts` ~241-323). Grepped the surrounding files per the brief's explicit instruction not to assume those were the only two spots, and found two more categories: (a) `HubAuth.service.ts`'s `console.log('[hub-auth] received agent register:', JSON.stringify(msg))` — this is worse than the two named lines, since `msg` includes `rawSecret`, the agent's actual plaintext shared secret, not just a hash; (b) `AgentRegistry.register()`'s `console.debug({ session }, ...)`, which dumps the full session object (including the raw `ws` connection object) on every agent registration; (c) `HttpTunnelHandler.ts` has three more unconditional `console.log`s that fire on every request/connection (`isTunnelRequest` — called on literally every incoming HTTP request — plus a send-forward log and a browser-WS-connected log). None of (b)/(c) leak secrets, but they're unconditional per-request/per-connection noise that would flood logs at real traffic volume.
**Options considered:** (1) gate everything (including the pepper/hash/rawSecret lines) behind a debug flag; (2) delete secret-adjacent lines outright, gate only the non-secret flow/noise lines behind a flag.
**Decision:** Option 2. Deleted outright: the `pepper length`/`expectedHash`/`storedHash` prints, and the `JSON.stringify(msg)` line (replaced with a version logging only `keyId`/`label`). Gated behind a new `HUB_DEBUG_LOGGING=true` env var (default off), via `apps/hub/src/utils/debug.ts`'s `debugLog()`: the subdomain-registration flow lines in `Message.router.ts`, `AgentRegistry.register()`'s log (now logging `agentId`/`accountId`/`label` only, not the raw session/`ws` object), and the three `HttpTunnelHandler.ts` lines.
**Rationale:** A debug flag can be flipped on in production by a config mistake; secret material should never be printable at all, flag or no flag. Non-secret operational noise is a legitimate debugging aid and is fine to gate rather than delete.
**Status:** active

---

---

### 2026-09-12 — HubPubSub stub: confirmed safe for single-instance, explicit trigger condition recorded

**Decided by:** Claude Code (Hub audit session)
**Context:** context.md risk #9 flagged `HubPubSub` as a confirmed no-op stub, "acceptable for V1/current scale." Brief asked to confirm nothing currently assumes multi-hub behavior that would silently break, rather than leaving this open-ended.
**Investigation:** Grepped every call site of `HubPubSub`'s methods. `start()`/`stop()` are called (lifecycle only, both no-ops). `findAgentHub()` and `publishForward()` — the two methods that would actually matter for cross-hub routing — are **never called anywhere** in `Message.router.ts` or `HubServer.ts`. `handleSdkRequest`'s agent lookup (`this.agentRegistry.find(auth.accountId, msg.label)`) resolves purely against the local in-memory `AgentRegistry`, with no fallback to `HubPubSub.findAgentHub()` if the agent isn't found locally.
**Confirmed:** nothing today assumes multi-hub behavior exists, so the stub cannot silently corrupt data or misroute a request. But the practical consequence of deploying a second Hub instance (e.g. behind a load balancer) today, without building Phase 2, is concrete and would look like a real bug: an SDK request landing on Hub B for an agent connected to Hub A gets `AGENT_NOT_FOUND` — not because the agent is offline, but because Hub B never asks Hub A (or Redis, via `findAgentHub`) whether the agent is connected elsewhere. This would present as intermittent, load-balancer-routing-dependent tunnel failures, which would be a confusing incident to debug without knowing this is the cause.
**Decision:** Confirmed safe to leave as-is; not built this session (agreed pre-launch scope). **Recorded trigger condition, so this isn't an open-ended "someday": build HubPubSub Phase 2 before running more than one Hub process in production, whether for horizontal scaling or even a zero-downtime blue/green deploy that briefly runs two instances.** Until then, Hub deployment must stay strictly single-instance.
**Status:** active — safe as designed for current single-instance deployment; trigger condition recorded for when to act

---

---

### 2026-09-12 — Inbound replay gap: accepted as-is for pre-launch, explicit trigger condition recorded (settles the "no consensus reached" item)

**Decided by:** Claude Code (Hub audit session), acting on explicit authorization from the brief to make this decision now rather than leave it open again
**Context:** context.md Core Flows §1 and Open Questions have carried "does the inbound-replay gap need a real fix before any production/team use, or is 'requests during a >30s reconnect window fail with an error' acceptable long-term? No consensus reached" since the original audit, through every subsequent session, without anyone actually deciding.
**The gap, restated precisely:** outbound replay (agent → hub, while WS is down) works correctly via the agent's durable queue. Inbound replay (hub → agent, a `tunnel:forward` sent while the agent is mid-reconnect) does not: `PendingRegistry` times out the request after 30s; if the agent reconnects after that window, the original caller has already received `AGENT_TIMEOUT`/504, but the local backend may still process the (possibly mutating) request when the stale message eventually arrives — or the agent silently drops the late response since the pending entry is gone.
**Decision:** Accept as-is for now. This is not fixed this session, and does not need to be. **Trigger condition for revisiting, recorded explicitly so this stops being an open question:** before either (a) onboarding any team/organization that relies on POST/DELETE reliability across agent reconnects — i.e. more than a single solo developer's own dev-loop usage, or (b) any product messaging that claims or implies "requests survive disconnects." Until either trigger fires, GET-heavy casual dev-tool usage (where a failed request is simply retried by the caller) is not meaningfully harmed by this gap, and building a real fix (which requires either idempotency keys, a durable hub-side pending queue, or agent-side dedup on replay) is nontrivial scope not justified by current usage.
**Rationale for deciding now rather than deferring again:** the brief explicitly authorized settling this, and "no consensus reached" repeated across N sessions with zero new information each time is worse than a recorded, revisitable decision — the trigger condition above is the actual answer to "when do we revisit," which the project lacked until now.
**Status:** active — decided; revisit only when a trigger condition above is met, not on a schedule

---

---

### 2026-09-12 — PendingRegistry crash gap: accepted as pre-launch risk, tied to the same trigger as HubPubSub Phase 2

**Decided by:** Claude Code (Hub audit session)
**Context:** context.md risk #23 — a hub crash drops all in-flight requests, since `PendingRegistry`'s Redis mirror (confirmed, during the 2026-09-12 reconciliation pass, to have existed since the file's original commit) stores only `{accountId, agentLabel, ts}` metadata, not the `resolve`/`reject` closures, which are inherently tied to a live WS connection and can't be serialized/recovered by a different process.
**Assessed severity given current deployment reality:** single Hub instance, pre-launch, presumably low/no real production traffic yet. A crash-drops-in-flight-requests gap is a real availability defect, but its blast radius today is "a rare process crash briefly fails whatever handful of requests were in-flight at that exact moment" — recoverable by client retry, not silent data loss (the mutation either didn't reach the agent yet, or it did and the response is lost but the caller sees a clear failure, not a false success).
**Decision:** Accept as pre-launch risk, not fixed this session. **Tied explicitly to the same trigger as HubPubSub's Phase 2 (see that entry above)**: a real fix here (durable hub-side pending-request state, or accepting that a crash means a bounded number of client-visible failures) becomes necessary at the same point horizontal scaling does — a multi-hub deployment needs pending-request state to survive an individual hub's crash or restart for correct behavior anyway, so this and HubPubSub Phase 2 should be scoped and built together, not separately.
**Status:** active — accepted risk for current single-instance/pre-launch deployment; revisit together with HubPubSub Phase 2

---

---

### 2026-09-12 — tunnel:ws:error routing: confirmed reachable, not dead code (settles the Open Question)

**Decided by:** Claude Code (Hub audit session)
**Context:** context.md's Open Questions carried: "`Message.router.ts`'s `tunnel:ws:error` routing path (agent → hub → `HttpTunnelHandler`) was flagged by one builder as 'wired but I'm not confident it's actually reachable given how the router holds its `httpTunnelHandler` reference' — needs a manual trace, not yet verified either way."
**Traced directly:** `HubServer`'s constructor creates exactly one `HttpTunnelHandler` instance and passes the *same* instance both to `MessageRouter`'s constructor and uses it directly in the HTTP request handler. `Message.router.ts`'s `routeAgentMessage` dispatches `case 'tunnel:ws:error'` to `handleAgentWsError(msg)`, which calls `this.httpTunnelHandler.handleAgentWsError(msg)` — the same shared instance, whose `activeBrowserWs` map is populated by that same instance's own `handleWebSocket()` when a browser WS tunnel connection is first established. There is no staleness or reference mismatch: it's one singleton, constructor-injected once, used consistently everywhere.
**Decision:** Settled — the path is real and reachable, not dead code. The prior uncertainty was unfounded; no fix needed.
**Status:** resolved — Open Question closed in context.md

---

---

### 2026-09-12 — onAgentClose: caller now awaits, but the documented race isn't (and can't be) eliminated by that alone

**Decided by:** Claude Code (Hub audit session)
**Context:** context.md risk #19 — `HubServer.ts`'s `ws.on('close', ...)` handler called `this.router.onAgentClose(ws)` without `await`, only `.catch()`.
**Decision:** Made the close handler `async` and added `await` around the call, with a `try/catch` for error visibility (previously a bare `.catch`).
**Important scoping note, recorded so a future session doesn't assume this "fixed" the race:** the concern in context.md ("if Redis is slow, a stale subdomain key could briefly survive into the next agent's registration") is a race between two *independent* WebSocket connections/event-loop turns — the old connection's close handler doing an async subdomain-unregister, and a new connection's register handler doing a synchronous subdomain-register for the same label. Awaiting inside one handler cannot serialize it against a message handler firing on a completely different WS connection; Node's event loop interleaves them regardless. The `await` fix is genuinely correct and worth having (deterministic completion, real error visibility instead of a swallowed rejection), but it is a code-quality/observability fix, not a race-condition fix. The actual race remains open and would need either a per-(accountId,label) mutex/versioning scheme or a register-time check-and-wait, which is out of this session's scope for a "smaller item."
**Status:** active — await added; underlying race still open, now correctly described as such rather than implied-fixed

---

---

### 2026-09-12 — apps/hub dependency cleanup: scope expanded beyond the three named packages once the same problem was found to be broader

**Decided by:** Claude Code (Hub audit session)
**Context:** context.md risk #25 named `fastify`, `uWebSockets.js`, `pg` as confirmed-unused leftovers in `apps/hub/package.json`. Grepped `apps/hub/src` for all three before removing (per the item's own instruction) and confirmed zero real imports (only stale comments and one now-deleted dead `.d.ts` type-declaration file for `uWebSockets.js`).
**Decision to expand scope:** While verifying those three, ran the identical check against every other dependency in `apps/hub/package.json` and found `bcryptjs`, `jsonwebtoken`, `pino`, `ioredis`, `zod`, and all six `@fastify/*` plugin packages (`compress`, `cookie`, `cors`, `helmet`, `jwt`, `rate-limit`) are **also** completely unused in `apps/hub/src` — the same class of leftover-dependency cruft as the three named packages, just not individually named in the original audit. Removed all of them (plus their now-orphaned devDependencies: `@types/pg`, `@types/jsonwebtoken`, `pino-pretty`) rather than leaving known-identical cruft in place because it wasn't in the original list.
**Rationale for expanding rather than sticking strictly to the three named packages:** the brief's own framing for this item was "confirmed unused leftovers, safe to remove" — a verification-then-delete pattern, not a fixed enumeration. Finding six more instances of the exact same problem while already doing that verification is "more of what was already being fixed," not new unrelated scope.
**Verified:** `pnpm install` (updates `pnpm-lock.yaml`), then `pnpm --filter @vhyxvoid/hub typecheck` and `pnpm --filter @vhyxvoid/hub build` both pass clean after removal.
**Status:** resolved

---

---

### 2026-09-14 — onAgentClose cross-connection race, real fix: per-key mutex + compare-and-delete, not a bigger synchronization primitive

**Decided by:** Claude Code (reliability-gaps session)
**Context:** context.md risk #19 (remaining half) / decision.md's 2026-09-12 "onAgentClose" entry: awaiting `router.onAgentClose(ws)` inside the WS close handler was a real correctness/observability improvement but explicitly did not eliminate the actual race — `onAgentClose`'s async `SubdomainRegistry.unregister()` and a reconnecting agent's async `SubdomainRegistry.register()` for the same label run on two independent WS connections with no ordering guarantee between their Redis round-trips.
**Investigation before designing anything:** Read the full call path on both sides. `AgentRegistry.register()`/`.evict()` are pure synchronous in-memory `Map` operations with no `await` inside them — two synchronous calls can never interleave with each other at the JS level, so the in-memory registry was never actually at risk; the entire race lives in `SubdomainRegistry`'s two async Redis calls. Also found `SubdomainRegistry.unregister()` was a **blind delete** — `redis.del(key)` with no check that the current value at that key still belonged to the agent that's disconnecting. That, not just missing synchronization, is the root cause: whichever of `register()`'s `SET` or `unregister()`'s `DEL` happens to land *last* at the Redis level wins, regardless of which was logically supposed to happen "first." A second, independent instance of the identical blind-delete pattern was found in `HttpTunnelHandler`'s stale-Redis-entry cleanup path (`if (!agent) { await this.subdomainRegistry.unregister(label, accountSlug); ... }`) — same bug, same fix applies.
**Decision — combine a per-key mutex with a compare-and-delete, not a Lua/Redis-level atomic script:** Considered an atomic Redis-side fix (a Lua `EVAL` script doing GET+compare+DEL in one round-trip, which `@upstash/redis`'s client does support via `.eval()`) versus an in-process per-(label,accountSlug) async mutex. Chose the in-process mutex because the actual deployed concurrency model is single-instance — `HubPubSub`/multi-hub is a confirmed no-op stub (decision.md, 2026-09-12, "HubPubSub stub") — so there is no cross-process concurrency to guard against, only cross-connection concurrency *within* one Hub process, which a simple in-memory lock fully and correctly serializes without introducing Lua scripting (a new, more exotic primitive this codebase doesn't otherwise use) for a problem that doesn't require distributed atomicity. The mutex alone was verified insufficient on its own, though: a naive "whichever call enters the queue first wins" lock does not by itself guarantee the *newer* registration survives — if the old connection's slow unregister happens to be queued first, it would still correctly delete-then-let-the-new-SET-through, but if timing meant the check inside unregister happened without an identity check, an old unregister queued *after* a fresh register could still wipe it. The **compare-and-delete** (`unregister()` now takes `expectedAgentId` and only deletes if the current Redis value's `agentId` still matches) is what actually makes the outcome correct *regardless of ordering* — the mutex's job is only to prevent the compare-and-delete's own GET-then-DEL from being interleaved by another operation on the same key, not to decide who "wins."
**Both real callers updated**, not just the one named in the bug report: `Message.router.ts`'s `onAgentClose` (passes `session.agentId`) and `HttpTunnelHandler`'s stale-entry cleanup (passes the resolved entry's own `agentId`) — found while reading `unregister()`'s call sites before changing its signature, not assumed to be the only caller.
**Verified the tests actually discriminate old vs. new**, not just pass against the new code: temporarily restored the pre-fix `SubdomainRegistry` (blind delete, no lock) and re-ran the new test file against it — 3 of 5 tests failed as expected (the stale-agentId no-op test, the slow-unregister-vs-fast-register ordering test, and the mutex-concurrency test); the other 2 (plain disconnect, different-labels-not-serialized) correctly still passed since they don't exercise the race. Restored the fix afterward and confirmed all 5 pass.
**Tested:** `tests/e2e/subdomainRegistryRace.test.ts` — plain disconnect; a stale unregister (wrong agentId) never deletes a newer registration, with zero timing involved; a slow unregister called first doesn't delete a faster new registration that lands while it's in flight; the mutex provably prevents two operations on the same key from ever running concurrently; different labels are confirmed *not* serialized against each other (no unnecessary global lock).
**Status:** active — context.md risk #19 marked fully FIXED

---

---

### 2026-09-24 — H3: the account-status sweep also re-validates each connection's API key; rotation tracked by a secret fingerprint; no pub/sub event

**Decided by:** Claude Code (commits `621ee3f` code, `6b65972` docs; not deployed, not pushed)
**Context:** Audit H3. Confirmed first: `AccountStatusSweepService` read only `Account.status`; `authenticateAgent` ran once, at registration; `main.ts`'s `loadKeyHash` selected neither `expiresAt` nor the rotation fields, from the DB or the `apikey:data` cache (which does hold them); `authenticateAgent` compared only `secretHash`, so the documented one-hour rotation grace didn't exist for agents (the SDK path already honoured it).
**Options considered (Part 3):** (a) extend the sweep; (b) a Redis pub/sub eviction event from `RevokeApiKey`/`RotateApiKey` into `HubPubSub`.
**Decision: (a), for these reasons.** `@upstash/redis` 1.36.1 does have a streaming `Subscriber`, so (b) is technically possible, but it can't replace the sweep: key **expiry** and the **end of a grace window** are time-based (no API action happens then), so something must re-check periodically anyway, and the sweep also covers dropped streams, hub restarts and missed events. `HubPubSub` is an empty stub (no lifecycle), so (b) means building and operating a long-lived stream for a latency gain on revoke only. The sweep reads Postgres directly (not the 5-minute key cache), so a revoke is seen on the next tick: ≤60 s, measured 7 s live. Recorded as a possible later add-on (below).
**How:** a second batched query per tick (`TunnelSessionRepository.findKeyStatesByIds`, by `ApiKey.id`), next to S4's account query; a failure skips only the key checks that tick. Same eviction as S4 (`hub:error AUTH_FAILED`, `fatal: true`, so the agent prints why and stops), with a specific message: `API key has been revoked` / `has expired` (also when `expiresAt` has passed before `ExpireApiKeysWorker` marks it) / `no longer exists` / `was rotated and the old secret's grace period has ended`. `evict()` generalised to take the message; the account path's text is unchanged.
**Rotation, a design correction made during the work:** the first version recorded "current/previous" at registration. Planning the live run showed that misses the main case: an agent connected *before* a rotation authenticated as "current", yet its secret becomes the previous one. Each session now stores a 16-hex SHA-256 fingerprint of the stored hash it matched (not the hash itself); the sweep keeps it while that fingerprint is the key's current hash, or its previous hash with the grace window open, and evicts otherwise (which also covers a second rotation).
**Live verification notes:** rotation is PRO-only, so the disposable account got a PRO `Subscription` row (deleted with the rest). Ending the 1-hour grace was simulated by moving `rotationGraceEndsAt` into the past in SQL plus dropping the key's cache entry, as the api does after its writes; the first attempt wrote local time into the UTC-naive column (IST, 5.5 h ahead), leaving the window open, which the code correctly honoured; redone with `now() at time zone 'utc'`.
**Possible later add-on (not built):** for sub-minute revocation, `RevokeApiKey` could publish `keyId` and the hub run one targeted key check on receipt; the sweep stays as the backstop.
**Status:** active.
