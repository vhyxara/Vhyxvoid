# VhyxVoid (Black-Server): Full Read-Only Audit

**Date:** 2026-09-24
**Commit audited:** `99ca4e4` (main, clean tree)
**Mode:** Read-only. No source file was modified. Only two throwaway probe scripts were run, from the session scratchpad (outside the repo): one on axios URL handling and one on gzip handling. The existing test suite was also run once.
**Scope:** `apps/hub`, `apps/api`, `packages/{shared,protocol,agent,sdk,middleware,next}`, `apps/web`/`apps/admin` (security-relevant parts only), `nginx.conf`, Dockerfiles, `docker-compose.yml`, CI, tests.

Before auditing I read the project's own notes (`internal-tools/*/context.md`, `decision.md`, `backlog.md`). This report focuses on **new** findings. Items already tracked there appear only in the last section, and only when I confirmed they are still open.

---

## 0. Executive summary

| # | Severity | Finding | Where |
|---|---|---|---|
| C1 | **Critical** | Plaintext passwords, refresh tokens, access tokens and full user objects (incl. password hash) are written to stdout on every login | `Login.usecase.ts:96-171` |
| C2 | **Critical** | Password-reset tokens are logged unconditionally in production, so anyone who can read the logs can take over any account | `RequestPasswordReset.usecase.ts:103` |
| C3 | **Critical** | Tunnel responses rewrite every `Set-Cookie` to `Domain=.vhyxvoid.com; SameSite=None`, so one tenant's session cookies are sent to **every other tenant's tunnel** | `HttpTunnel.handler.ts:478-495` |
| C4 | **Critical** | Tunnel CORS reflects any `Origin` with `Allow-Credentials: true` and strips the backend's own CORS headers, so any website can read authenticated responses from a developer's local backend | `HttpTunnel.handler.ts:82-97, 505-520` |
| H1 | High | The API's global rate limit is one shared bucket for all users: Fastify has no `trustProxy`, so every request comes from nginx's IP (100 req/min for the entire API) | `server.ts:18`, `register.plugin.ts:45` |
| H2 | High | Access tokens (user **and** admin) last 100 hours and are never revocation-checked. Logout, password reset, admin disable and super-admin demotion take up to 100 h to take effect | `ttl.constant.ts:2,7`, `userAuthGuard.ts`, `requireAbility.plugin.ts` |
| H3 | High | Revoking, rotating or expiring an API key never disconnects agents already connected with it. The status sweep only checks *account* status | `AccountStatusSweep.service.ts`, `HubAuth.service.ts` |
| H4 | High | Usage pipeline, second data-loss bug beyond the known backlog item: per-key counters are written with the **public** keyId into a FK that references `ApiKey.id`. Every flush throws after the Redis keys were already deleted | `FlushUsageWorker.usecase.ts:37`, `RedisApiKeyCache.service.ts:256` |
| H5 | High | gzip/br-compressed backend responses reach the caller **truncated**: axios decompresses but the stale `content-length` is forwarded (verified) | `BackendProxy.ts:44,98` |
| H6 | High | nginx has no `client_max_body_size`, so tunnel uploads over 1 MB get nginx 413 even though the hub allows 10 MB | `nginx.conf` wildcard block |
| H7 | High | Hub crash/restart cleanup never runs: the instance id is random per boot, so stale `CONNECTED` sessions and subdomain keys are never evicted, and graceful shutdown also never marks sessions disconnected | `HubServer.ts:86,186-193,406`, `main.ts:117` |
| H8 | High | Replay protection is shorter than the timestamp window (60 s TTL vs ±60 s skew), so a captured signed request can be replayed between 60 and 120 s later | `validateApiKey.ts:47-48,88` |
| H9 | High | Agent SSRF: an absolute URL in `path` makes axios ignore `baseURL`, so the agent fetches arbitrary hosts from the developer's machine (verified with the installed axios 1.13.2) | `BackendProxy.ts:74` |
| H10 | High | Multi-tab refresh race triggers "refresh token reuse detected" and revokes **all** sessions for the user | `RefreshSession.usecase.ts`, `apps/web/src/api/wrapper/http.ts` |
| H11 | High | Tunnel URLs are guessable (`firstname--default.vhyxvoid.com`), so exposed dev backends can be enumerated | `slug.util.ts`, `VerifyEmail.usecase.ts:52-60` |

About 45 more Medium/Low findings follow, plus stress-test scenarios, architecture recommendations and feature proposals.

**Test suite state (run during this audit):** 50 files / 356 tests, **1 failing**: `publicPathUsageLimiter.test.ts` "PRO allows 3,000…". It is a real-clock minute-boundary flake (see M30). It is not a regression, but CI can go red at random.

---

## 1. Critical

### C1. Credentials logged on every login
`apps/api/src/modules/identity/application/use-cases/user/Login.usecase.ts`
- Line ~96: `console.log("now", now, this.jwtService, …, email, password, ipAddress, userAgent)`: the **plaintext password**.
- `console.log("USER FOUND:", user)`: the full entity, including `passwordHash`, lockout state and tokenVersion.
- `console.log("RAW REFRESH TOKEN:", rawRefreshToken, "HASHED:", tokenHash)`: a 30-day credential.
- `console.log("ACCESS TOKEN:", accessToken)` and `console.log("DECODED:", …)`: a 100-hour bearer token.
- Also `Logout.usecase.ts:10` (`console.log("4", tokenHash)`) and `identity.routes.ts:340` (`console.log("passwordHasher", …)`).

**Impact:** anything with log access can impersonate any user who has logged in: `docker compose logs`, the host, a log shipper, or anyone who screenshots output while debugging. Container logs are kept by default (json-file driver, no rotation configured in compose).
**Fix:** delete these lines. Treat existing production logs as compromised: rotate or clear the log files and force a global logout (bump `tokenVersion` / revoke all `Session` rows). Add an ESLint `no-console` rule for `apps/api/src/modules/**` so this can't come back. The API has 127 live `console.log` calls.

### C2. Password-reset token logged in production
`RequestPasswordReset.usecase.ts:101-103`: the `[DEV] PASSWORD RESET TOKEN` log has a duplicate **outside** the `else`, so it runs on every reset even when email is configured. `Register.usecase.ts:108` has the same pattern for email-verify tokens, but only in the no-notification-service branch.
**Impact:** with log access, anyone can call "forgot password" for any email and read the token from the logs, which is a full account takeover.
**Fix:** delete line 103. Gate the dev fallback on `NODE_ENV !== 'production'`.

### C3. Cross-tenant cookie exposure via `Domain=.vhyxvoid.com` rewrite
`apps/hub/src/handlers/HttpTunnel.handler.ts:478-495` strips the backend's `Domain`/`SameSite` and appends `Domain=.vhyxvoid.com; SameSite=None; Secure` to every cookie.
- `vhyxvoid.com` is **not** on the Public Suffix List, so browsers treat every `*.vhyxvoid.com` host as one site.
- A session cookie set by tenant A's tunnel (`acme--app.vhyxvoid.com`) is therefore sent by the browser to `evil--x.vhyxvoid.com`. The attacker's agent receives it in the `Cookie` header, which gives cross-tenant session theft of whatever the developer's app issues.
- The reverse also works (cookie tossing): any tunnel can **set** cookies for `.vhyxvoid.com`. That lets it shadow or fixate cookies on `api.vhyxvoid.com` (e.g. a planted `refresh_token` on path `/api/v1/auth`) and on other tenants' tunnels.
- Downgrading `SameSite=Strict/Lax` to `None` removes the developer's own CSRF protection.
- A `__Host-` prefixed cookie becomes invalid (`__Host-` forbids `Domain`), so browsers drop it silently and apps that use it break.

The product vision in `shared/context.md` ("cookie-domain sharing … auth/cookies/CORS just work") is exactly what makes this dangerous. The sharing has to be scoped to **one account**, not the whole domain.
**Fix (architectural, see A1):** serve tunnels from a dedicated registrable domain (e.g. `vhyxvoid.app`) and register it on the PSL, the way ngrok uses `ngrok-free.app`. Per-account cookie sharing can then use `Domain=<slug>.vhyxvoid.app` with the host format `<label>.<slug>.vhyxvoid.app`. Short term: stop rewriting `Domain` and `SameSite` by default and make it opt-in per tunnel.

### C4. Credentialed CORS reflection on every tunnel
`HttpTunnel.handler.ts:82-97` (preflight) and `505-520` (response) reflect any `Origin` with `Access-Control-Allow-Credentials: true`. Line 475 also **drops** every `access-control-*` header the backend sent.
**Impact:** any website the developer (or a teammate) visits can `fetch('https://acme--app.vhyxvoid.com/api/me', {credentials:'include'})` and **read** the response, and can make state-changing requests. Combined with C3 the cookies are always attached. This overrides whatever CORS policy the developer's backend enforces.
**Fix:** by default, pass the backend's CORS headers through untouched. If the hub must own CORS, allow only same-account tunnel origins plus an allowlist configured per tunnel. Never pair reflected origins with credentials.

---

## 2. High

### H1. API rate limiter is one global bucket (and IPs in audit logs are spoofable)
- `apps/api/src/server.ts:18` calls `Fastify()` with no `trustProxy`. nginx proxies to `api:9000`, so `request.ip` is always nginx's container IP. `@fastify/rate-limit` (`register.plugin.ts:45`, `max: 100 / 1 minute`) keys on `request.ip`, so **the entire API shares 100 requests/minute**. A few active dashboard users, or one script, will 429 everyone, login included.
- Conversely, `UserRoute.middleware.ts:getClientIp` trusts the **first** `X-Forwarded-For` entry, which is client-controlled (nginx appends to it). Audit-log IPs can therefore be forged.

**Fix:** `Fastify({ trustProxy: <docker subnet> })` and use `request.ip` everywhere (with Cloudflare's `CF-Connecting-IP` handled at nginx via `real_ip`, which is already configured). Add stricter per-route limits on `/auth/login`, `/auth/forgot-password`, `/auth/register` and `/auth/resend-verification`.

### H2. 100-hour, non-revocable access tokens (user + admin)
- `core/constant/ttl.constant.ts:2,7`: `ACCESS_TOKEN_SEC` and `ADMIN_TOKEN_TTL_SECONDS` are `6000*60` (100 h), commented "for testing". `RefreshSession` hard-codes 15 min, so login and refresh disagree.
- `userAuthGuard` explicitly does no DB/tokenVersion check. `ResetPassword` revokes refresh sessions but outstanding access tokens stay valid for up to 100 h.
- `requireAbility.plugin.ts`: `if (request.admin.isSuperAdmin) return;` trusts the **JWT claim**. `VerifyAdminAbilityUseCase` checks that the admin exists but not whether they're disabled. A disabled or demoted super-admin keeps full admin power for up to 100 h.
- `userAuthGuard` doesn't reject `type: "admin"` tokens (the admin guard does check `type`), so an admin token passes the user guard as `sub=<adminId>`. Low impact today, but the token audiences should be separate.

**Fix:** 10–15 min access TTL for both. Check `tokenVersion` and admin `status`/`isSuperAdmin` against a Redis-cached record, which is cheap. Add an `aud`/`type` claim and enforce it in both guards.

### H3. Key revoke / rotate / expiry doesn't affect connected agents
- `AccountStatusSweep.service.ts` re-checks `Account.status` only.
- `HubAuth.service.ts` authenticates once at `agent:register`. It also **ignores `expiresAt`** (the `loadKeyHash` select in `apps/hub/src/main.ts:69-86` doesn't fetch it), so an expired-but-not-yet-marked key can register for up to 5 min until `ExpireApiKeysWorker` runs. It also doesn't honour `previousSecretHash`/`rotationGraceEndsAt`, so the advertised rotation grace window doesn't exist for agents: a restart with the old secret fails immediately.

**Impact:** "Revoke key" in the dashboard is the incident-response button for a leaked secret, and it does nothing to the attacker's live tunnel, possibly for weeks.
**Fix:** extend the sweep to re-validate each session's key (status, expiry, still present). Better, have `RevokeApiKey`/`RotateApiKey` publish an eviction via Redis that the hub consumes (`HubPubSub` already exists as a stub). Add the expiry and grace-window checks to `authenticateAgent`.

### H4. Usage flush: FK mismatch loses every per-key counter (beyond the known backlog bug)
The api backlog already records the Upstash tuple-shape bug in `drainUsageCounters`. Fixing that alone is **not enough**:
1. Redis keys are `usage:{accountId}:{keyId}:…`, where `keyId` is the **public** id (`vhyxvoid_live_…`), set in `validateApiKey.ts:incrementUsage`.
2. `FlushUsageWorker.usecase.ts:37` writes it straight into `UsageAggregate.apiKeyId`, a FK to **`ApiKey.id` (UUID)**. Every per-key upsert fails with P2003.
3. `drainUsageCounters` has **already deleted** the Redis keys (`RedisApiKeyCache.service.ts:256`) before the DB write, so the data is gone. The exception also aborts the loop for the remaining accounts in that run.
4. The GET-then-DEL is not atomic, so any `INCR` between the pipeline GET and the DEL is lost. The current (still-open) 5-minute bucket is drained too.
5. Readers disagree with writers. `findByAccountAndPeriod` reads only `apiKeyId: null` rows, which is where the public-path counter lands, so the dashboard "account" usage never includes SDK usage. `GetApiKeyUsage` with `keyId` looks up the **internal** id, which never matches what the writer stores.
6. `periodEnd` is set to the flush time rather than the bucket end, so the `periodEnd <= window.end` filter can drop the newest buckets.
7. The flush visits only accounts with an ACTIVE key and runs one full-keyspace `SCAN` per account, which is O(accounts × keyspace) Upstash commands every 5 minutes (cost, see P3).

**Fix:** resolve public→internal id at flush time (or store the internal id in the Redis key; the hub already has `agent.keyId`). Drain only **closed** buckets, with `GETDEL` (or `RENAME` then read). Write to Postgres **before** deleting. Do one `SCAN usage:*` per run (or maintain a Redis set of dirty accounts). Fix the reader/writer id contract and add an integration test against a real Upstash-shaped mock.

### H5. Compressed backend responses are truncated (verified)
`BackendProxy.ts:44` sets `decompress: true`. axios removes `content-encoding` but **keeps the original `content-length`**. Probe result: `content-length: 52`, actual body 2400 bytes. `sanitizeOutboundHeaders` forwards it, and `HttpTunnel.handler.ts:writeResponse` sets it on the real response. Node doesn't enforce the length by default, so nginx/the browser read 52 bytes and cut the rest.
**Impact:** any backend using `compression()`, Next.js `next start` (compress is on by default), Fastify compress, Django GZip, etc. returns broken pages and JSON through the tunnel.
**Fix:** drop `content-length` (and `content-encoding` if it's still present) in `sanitizeOutboundHeaders`, and let the hub compute the length. Or use `decompress: false` and pass the bytes through untouched, which is also cheaper (see P1).

### H6. nginx 1 MB body cap on tunnels
`nginx.conf` sets no `client_max_body_size` in any server block. nginx's default is 1 MB, so the hub's 10 MB `MAX_BODY_BYTES` and the protocol's 10 MB limit are unreachable. File uploads through a tunnel fail with an nginx 413 HTML page, not the hub's JSON error.
**Fix:** `client_max_body_size 10m;` in the wildcard block (and the api block if uploads are ever added).

### H7. Hub restart leaves ghost sessions and stale routes
- `HubServer.ts:86` generates a random `hubInstanceId` on every boot unless `config.hubInstanceId` is passed, and `main.ts:117` never passes it. `start()` then runs `evictStaleForInstance(newId)` and `unregisterAllForHub(newId)`, which match **nothing** from the previous process.
- `stop()` calls `agentRegistry.evictAll()`, which clears the maps **before** the WS close events fire, so `onAgentClose` finds no session and never writes `DISCONNECTED` or unregisters the subdomain.
- The same pattern is in `HeartbeatService.evict` and `AccountStatusSweep.evict`: they evict first and then `ws.close()`, so `onAgentClose` no-ops. The subdomain Redis key (no TTL) and, for heartbeat eviction, the browser tunnel WebSockets are left behind.

**Impact:** after every deploy, the dashboard shows every previously-connected agent as `CONNECTED` indefinitely (`tunnel_sessions` rows), and "active tunnels" counts in `usage/summary` are wrong. Tunnel URLs of dead agents answer 503 ("registered but not connected") instead of 404 until someone hits them.
**Fix:** use a stable `HUB_INSTANCE_ID` env (e.g. the container hostname). On `stop()`, mark all sessions disconnected in one `updateMany` and delete the subdomain keys. Route all three eviction paths through one `teardownAgent(session)` that does the full cleanup: registry, pending, tunnel WS, DB, subdomain. Give subdomain keys a TTL that heartbeat refreshes.

### H8. Replay window shorter than the signature window
`packages/shared/src/validateApiKey.ts:47-48`: `SIGNATURE_WINDOW_MS = 60 s` accepts `|now - ts| ≤ 60 s`, so a request stamped `now+60s` stays valid for ~120 s. `REPLAY_WINDOW_MS = 60 s` forgets the requestId after 60 s, so the same signed message can be replayed once the replay key expires.
Also:
- The replay key is written **before** key lookup and signature check (line 88). Unauthenticated garbage `sdk:request`s therefore each cost an Upstash write (billing amplification) and can pre-burn a legitimate client's requestIds if they're predictable.
- The replay namespace is global (`apikey:replay:{requestId}`), not per key.
- The canonical string hard-codes `query = ""` (line 157), so the query string is **unsigned** even though `protocol/canonical.ts` says it's included "to prevent query-parameter injection". The `|` separator also isn't escaped: a path containing `|` can collide with the query field if the query is ever signed.

**Fix:** set the replay TTL to at least 2 × the skew window (and cut skew to ~30 s). Mark the replay key **after** the signature verifies, namespaced by keyId. Sign the query (and ideally a canonical header subset). Length-prefix or escape the fields.

### H9. Agent follows absolute URLs (SSRF from the developer's machine)
`BackendProxy.ts:74` builds `url = msg.path + query` against `baseURL: http://127.0.0.1:<port>`. With axios ≥1.x, an absolute `path` such as `http://169.254.169.254/latest/meta-data/` or `http://192.168.1.1/admin` **bypasses `baseURL`**. I verified this with the repo's axios 1.13.2: a request for `http://127.0.0.1:<otherPort>/meta` reached the other server.
- Reachable via `sdk:request` (`msg.path` is sender-controlled; any holder of an account key, including teammates, once TunnelClient auth is fixed) and via `/internal/proxy`.
- The public HTTP path goes through nginx, which normalises absolute-form request lines to origin-form, so it's probably not reachable directly. That should still be verified rather than relied on.

**Fix:** `allowAbsoluteUrls: false` (axios ≥1.8), plus rejecting any `path` that doesn't start with a single `/`, both at the hub (`handleSdkRequest`) and at the agent (defense in depth).

### H10. Multi-tab refresh race logs the user out everywhere
`RefreshSession.usecase.ts` revokes the old session on rotation, and a second use of a revoked token runs `revokeAllByUserId` ("reuse detected"). `apps/web/src/api/wrapper/http.ts` single-flights refresh **per tab only**. Two tabs bootstrapping or refreshing at the same moment send the same cookie: the loser triggers reuse detection and every session for the user is revoked. There's also no row lock (`SELECT … FOR UPDATE`) in the transaction, so two truly concurrent refreshes can **both** succeed and mint two live sessions from one token, which defeats the reuse detection it's meant to provide.
**Fix:** allow a short grace (e.g. 30 s) in which a just-rotated token returns the same successor instead of triggering revoke-all. Lock the session row. Coordinate refresh across tabs (BroadcastChannel or `navigator.locks`).

### H11. Guessable public tunnel URLs
Personal slugs come from the user's **first name** (`VerifyEmail.usecase.ts:52-60`: `john`, then `john-a3f9`), and the default label is `default` (CLI/middleware) or `app` (next). `https://john--default.vhyxvoid.com` is trivially enumerable, and it exposes developers' local backends, which in dev commonly have no auth, debug routes and seeded admin users. With C3/C4 this becomes worse.
**Fix:** add a random component to generated slugs (or per-tunnel random hostnames with an opt-in "reserved" name on paid plans). Consider optional tunnel auth (basic auth / an SSO gate on the hub; see F2).

---

## 3. Medium

### Hub
- **M1. `/health` and `/metrics` shadow tenants' own routes.** `HubServer.ts:202,217` match `req.url` before checking the Host, so `GET https://acme--app.vhyxvoid.com/health` returns **the hub's** health JSON (instance id, agent count, heap) instead of the developer's `/health`. The same applies to `POST /internal/proxy` on tunnel hosts. Route by Host first.
- **M2. Any socket on `/agent` can resolve or reject any pending request.** `Message.router.ts:93-96, 391-396`: `tunnel:response`/`tunnel:agent-error` are accepted from **unregistered** sockets and from agents that don't own the request. `agent:pong {agentId}` from any socket resets another agent's missed-ping counter, and agentIds are visible to teammates in the dashboard. The WS relay got an ownership check (D10); the HTTP path didn't. **Fix:** store the owning `agentId` on each `PendingRequest` and drop responses or pongs from any other socket. Require `agent:register` before handling any other message type.
- **M3. SDK-chosen requestIds collide in the PendingRegistry.** `Pending.registry.ts:26` does `pending.set(requestId, …)` with no collision check, and SDK requestIds are client-supplied. A duplicate overwrites the earlier entry without clearing its timer; the orphaned timer later rejects the **new** request early, and the first caller never gets an answer. Across tenants, a known requestId could route one account's response to another. **Fix:** key pending entries on a hub-generated id and map the SDK id only for the response.
- **M4. Subdomain registration depends on the DB upsert.** `Message.router.ts:315-359`: the Redis subdomain `register()` runs inside `.then()` of `sessionRepo.upsert()`. If Postgres fails or is slow, the agent prints "Tunnel active / Public: https://…" but the URL returns 404 **forever** (until reconnect). The `hub:registered` message is also sent before the route exists, so first requests right after "live" 404. **Fix:** register the subdomain synchronously before `hub:registered`. Make the DB write independent.
- **M5. Re-registering on the same socket leaks sessions.** A second `agent:register` on one WS with a different label leaves the first session in `accounts`/`byAgentId` while `byWs` points to the second. On close only one is evicted, so the ghost counts toward the plan limit (FREE users locked out until hub restart). The same label on the same socket makes `register()` close its own new socket. **Fix:** reject `agent:register` on an already-registered socket.
- **M6. No label validation.** `agent:register.label` is never validated (length, charset, case). Uppercase labels are unreachable (browsers lowercase hosts, and `isTunnelRequest`/`parseSubdomain` don't normalise). Labels over 63 chars or with dots/spaces produce invalid hostnames. An empty label makes `find(account, "")` fall through to "first agent". **Fix:** enforce `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$` (no `--`) at the hub and in the CLI. Lowercase the Host before parsing.
- **M7. No pre-auth limits on WebSockets.** `maxPayload: 100 MiB` for `/agent` and `/sdk` (`HubServer.ts:318`) applies **before** authentication. The tunnel `WebSocketServer` has the same default. There's no auth deadline, and no per-IP connection or attempt cap on `agent:register` (each unknown keyId is a Postgres hit: no negative cache). **Fix:** a ~64 KB `maxPayload` until registered, a 10 s auth deadline, per-IP connection caps, and negative caching of unknown keyIds.
- **M8. WS upgrades bypass the public-path limiter and usage counting** (`handleWebSocket` never calls `usageLimiter`). There's also no per-agent cap on concurrent tunnel WS (D8 in the design doc).
- **M9. HTTP-path tunnel requests are never audited, but still cost a DB write.** `HttpTunnelHandler` has no `requestRepo.create`, so the dashboard's request log and `/tunnels/usage` hourly stats only include SDK traffic (the minority). Meanwhile `handleTunnelResponse` runs `tunnelRequest.updateMany({where:{requestId}})` for **every** response, a wasted write per public request. **Fix:** record HTTP-path requests (batched), or skip `recordResponse` for ids that were never created.
- **M10. Error details leak to the public.** Agent errors travel verbatim to the caller: `"Local backend on port 3000 is not responding: connect ECONNREFUSED 127.0.0.1:3000"` (`AgentClient.onForward` → hub `reject` → `sendError(502, message)`). The WS path was sanitised (D3) but the HTTP path wasn't. The 404 page also prints a CLI command that includes `--secret`.
- **M11. `X-Forwarded-Host` is overwritten to `127.0.0.1:<port>`** (`BackendProxy.ts:172`), and `Host` is too. Backends can't learn their public URL, so OAuth redirect URIs, absolute links, Next.js `redirect()` and CSRF origin checks break. **Fix:** send the real tunnel host in `X-Forwarded-Host` (keep `Host` rewritten if you want).
- **M12. `/internal/proxy` is dead end-to-end.** It sends `type: 'http_request'` (`HubServer.ts:285`), which the agent doesn't handle (it logs "unknown message type"). Nothing ever calls `resolveRequest`, so every call times out after 15 s. It also has no body-size cap on `rawBody` and doesn't check that `agentId` belongs to the caller's account. Delete it or rebuild it on `tunnel:forward` + `PendingRegistry`.
- **M13. `uncaughtException → continue`** (`main.ts:148`). After an uncaught exception, Node's state is undefined (half-written responses, leaked listeners). Log, then exit and let Docker restart the process.
- **M14. `readBody` failure returns 500 instead of 413** for chunked bodies over 10 MB (the rejection surfaces as an "unhandled error in HTTP tunnel handler"). Client disconnects aren't propagated either: the pending entry and the agent's backend request keep running until timeout.

### API
- **M15. Login lockout: DoS and a parallel-guess bypass.** 5 failures lock the account for 15 min (`User.entities.ts:141-148`), so anyone can lock out any user by email with no captcha. The counter is a read-modify-write on the entity, so N parallel guesses all read `failedLoginAttempts = 0` and the lockout never triggers. The lockout message and bcrypt-only-if-user-exists timing also enumerate registered emails. **Fix:** an atomic `UPDATE … SET failed = failed + 1`, IP+account rate limits, a dummy bcrypt compare for unknown users, and a generic message.
- **M16. Stripe checkout abuse.** `billing.routes.ts:21`: `trialDays` (0–90) is **client-controlled**, so any owner can give themselves a 90-day free trial on each checkout. `priceId` is arbitrary (only mapped to a plan later). `successUrl`/`cancelUrl` accept any URL, which is an open redirect via a Stripe-branded page. `CreateCheckoutSession` does refuse when a *persisted* subscription is active or trialing. But several checkout sessions opened before the first webhook lands can all be completed, which means double billing (`resolvePlanForAccount` then picks whichever was created last). A `PAST_DUE` subscription doesn't block a new checkout. After cancelling, an owner can start over with another 90-day trial. The Stripe-customer creation is also check-then-create, so two concurrent checkouts can create two customers. **Fix:** a server-side plan→price map and trial policy (trial once per account), a same-origin allowlist for URLs, an idempotency key per account on checkout creation, and blocking `PAST_DUE` too.
- **M17. Stripe webhooks: no idempotency or ordering.** The `StripeEvent` model exists but isn't used. Out-of-order `customer.subscription.updated` deliveries (common) overwrite newer state with older state, e.g. a downgrade followed by an older "PRO" event. **Fix:** persist `event.id` (dedupe) and compare `event.created` (or re-fetch the subscription from Stripe) before applying.
- **M18. Slug edge cases.** `slugify()` returns `""` for names with no ASCII letters (Hindi, Chinese, emoji, "!!!"). The first such account gets `slug = ""`: the hub treats that as falsy and **silently never registers a public URL**. The second gets `"-abcd"`, an invalid DNS label. The check-then-insert on slug uniqueness races and throws a raw P2002 500. `Math.random` suffixes aren't retried on collision. **Fix:** fall back to a random slug when empty, validate with the existing (unused) `isValidSlug`, and retry on a unique violation.
- **M19. Admin refresh token in `sessionStorage`** (`apps/admin/src/api/domain/auth/auth.store.ts`). Any XSS in the admin app steals a 30-day admin refresh token. The user app already uses an httpOnly cookie; admin should do the same.
- **M20. Email verification is still not enforced at login** (`ensureCanLogin` has no `isEmailVerified` check; this is a known gap). New consequence found: anyone can register **someone else's** email and squat it, so the real owner can't sign up without the reset flow, and they can create orgs and keys under that identity.
- **M21. `usage` and `tunnels/usage` accept unbounded ranges** (`from`/`to` with no max window), which makes an expensive `date_trunc` aggregate per request. `totals.avgDurationMs` is an unweighted mean of hourly means (wrong when hours have different volumes).
- **M22. `tunnels/history` runs an unused query** (`findByAccount(accountId, 50)`, result discarded) on every call.
- **M23. Sessions only slide.** Each refresh issues a fresh 30-day session (`Session.rotate(ttl)`), so there's no absolute lifetime. Revoked session rows are never pruned (unbounded table growth). Add `absoluteExpiresAt` and a cleanup job.

### Agent / SDK / integrations
- **M24. Default labels disagree.** CLI and middleware use `default`, `@vhyxvoid/next` uses `app`, and `createClient()` targets `default`. A Next.js app plus `createClient()` with no config therefore gets a 404. Pick one default.
- **M25. `createClient` body handling.** It always `JSON.stringify`s the body and forces `Content-Type: application/json`, so string/Buffer/FormData/URLSearchParams bodies are corrupted (a string becomes `"\"…\""`). `res.json()` throws on empty 204/HEAD bodies and on invalid JSON. The `onRequest` hook gets a copy, so changing `req.url`/`req.body` has no effect (only in-place header mutation works).
- **M26. `LocalAgentClient` has no request timeout** (`http.request` with no `timeout`), so a hung local backend hangs the SDK call forever. The discovery timeout `setTimeout` is never cleared. Local discovery routes to **any** process on :4242 regardless of account or label (known gap), and it also ignores the **label** the caller asked for.
- **M27. The agent reads `--secret` from argv and writes `.env.vhyxvoid` with the default 0644 mode.** The secret shows up in `ps`/shell history, and the file is world-readable on shared machines. Use mode `0600` and prefer env or a prompt. `writeEnvVar` builds a `RegExp` from an unescaped env key.
- **M28. No backend concurrency cap in the agent.** Every `tunnel:forward` immediately opens a backend request. A burst (within the plan's 3,000/min PRO limit) can overwhelm a developer's local server. Add a small per-agent concurrency limit and queue.

### Infra / CI
- **M29. Docker builds aren't reproducible and run an EOL runtime.** `pnpm install --no-frozen-lockfile` in both Dockerfiles means the image can resolve different versions than CI tested. The images are `node:20-slim` (Node 20 went EOL in April 2026), while CI tests on Node 24. Both containers run as **root**. The hub image copies the full `node_modules` including dev deps. **Fix:** `--frozen-lockfile`, `node:24-slim`, `USER node`, `pnpm deploy --prod` for the runtime stage.
- **M30. Flaky tests depend on the wall clock.** `publicPathUsageLimiter.test.ts` failed in this audit's run (it crossed a UTC minute boundary mid-loop), and `subdomainRegistryRace.test.ts` is already in the hub backlog. Use `vi.useFakeTimers()`/`vi.setSystemTime()`. More importantly, this test **is** evidence of the fixed-window limiter's burst behaviour (see M31).
- **M31. The public-path limiter is a fixed window** (allows 2× the limit at minute boundaries). It has no single-flight on plan lookups (a flood against a cold account means one DB query per concurrent request until the first resolves), and failed lookups are never cached, so during a DB outage every public request hits the DB. Consider a sliding window or token bucket, plus in-flight de-duplication.
- **M32. `certbot` service has no renew loop.** The compose `certbot` service has no `entrypoint`/`command`, so it runs `certbot` once and exits, and renewals depend entirely on a host crontab. That is consistent with the cert that expired in August. Add `entrypoint: sh -c 'trap exit TERM; while :; do certbot renew --dns-cloudflare …; sleep 12h; done'` plus an nginx reload hook, and alert on expiry.

---

## 4. Low / hygiene

- **L1.** `StripeServiceImpl.priceToPlан` contains **Cyrillic** letters (`ан`) in the identifier. It works because it's consistent, but it defeats grep and search-and-replace and looks like a homoglyph attack in review. Rename it.
- **L2.** Redundant indexes: `@unique` plus an identical `@@index` on `User.email`, `Account.slug`, `ApiKey.keyId`, `Session.tokenHash`, `AdminSession.tokenHash`, `AdminUser.email`, `AdminRole.name`, `TunnelRequest.requestId`. Each doubles write cost for no read benefit.
- **L3.** `seed-super-admin.ts` hard-codes `admin@company.local` / `Admin@12345678` and prints the password. Read these from env and fail if they aren't set in production.
- **L4.** `auth.util.ts` still contains the dead `signatureVerification` middleware with a hard-coded `client_123` / `CLIENT_123_SECRET` map. It's dead but confusing; delete it (and the env var).
- **L5.** `@fastify/jwt` is registered with `secret: process.env.JWT_SECRET!`, which is functionally dead (see shared context). If `JWT_SECRET` is ever removed from prod, boot crashes. Remove the plugin.
- **L6.** `HubServer` comments still describe uWebSockets.js ("~1.2M msg/sec per core"), and the log line says `[hub] HTTP listening` in the **API** server (`server.ts`). Misleading during incident response.
- **L7.** `sanitizeOutboundHeaders` keeps only the **first** value of multi-value headers other than `set-cookie` (`link`, `www-authenticate`, `vary`, `cache-control` in some stacks). The hub also drops the backend's `Vary` (`writeResponse` skips `vary`), which breaks downstream caches.
- **L8.** `isTunnelRequest` is case-sensitive and doesn't handle a trailing-dot FQDN (`acme--app.vhyxvoid.com.`).
- **L9.** The Redis rate-limit `INCR` and `EXPIRE` are non-atomic (`validateApiKey.ts incrementRateLimit`, `HubUsage.increment`). If `EXPIRE` fails, the key never expires and that key is permanently rate-limited. Use a single `SET … EX NX` + `INCR` in a pipeline, or a Lua script.
- **L10.** The Agent's `onMessage` parse-error branch logs "Local backend on port X is not responding" for a **hub** protocol error (copy-paste). This misleads users.
- **L11.** `TunnelRequest.repository.ts:getHourlyStats` comment says the table is `"TunnelRequest"` but the query (correctly) uses `"tunnel_requests"`. Stale comment.
- **L12.** `apps/hub/src/HubServer.ts` exposes `public pendingRequests` and `resolveRequest`, which are only for the dead `/internal/proxy` (M12).
- **L13.** `Account.updatedAt` has both `@default(now())` and `@updatedAt`. Harmless, but redundant.
- **L14.** `hub` nginx block sets `Connection "Upgrade"` unconditionally for plain HTTP too (`/health`). Use the `$connection_upgrade` map as the wildcard block does.

---

## 5. Edge cases and stress-test scenarios to add

These are concrete tests that would have caught the issues above. Each has a clear expected result.

| Scenario | Expected today | Should be |
|---|---|---|
| Backend responds `Content-Encoding: gzip`, 50 KB body | Truncated to compressed length (H5) | Full body |
| Upload a 5 MB file through a tunnel | nginx 413 (H6) | Passes |
| 2 browser tabs load the dashboard at the same instant | Possible global logout (H10) | Both stay logged in |
| Revoke the key a running agent uses | Agent keeps serving (H3) | Evicted within ~60 s |
| `docker compose restart hub` with 3 agents connected | 3 ghost `CONNECTED` rows forever (H7) | All marked `DISCONNECTED`, agents reconnect |
| Replay a captured `sdk:request` 61–119 s later with `ts = now+59s` | Accepted (H8) | `REPLAY_ATTACK` |
| `sdk:request` with `path: "http://169.254.169.254/"` | Agent fetches the metadata IP (H9) | Rejected at hub |
| Send 200 `/auth/login` from 200 different client IPs | Everyone 429'd after 100 (H1) | Per-IP limit |
| Org named "株式会社" | Tunnel never gets a URL (M18) | Random fallback slug |
| Two `agent:register` on one socket | Ghost session, FREE locked out (M5) | Second rejected |
| Unregistered WS sends `tunnel:response` with a live requestId | Resolves someone else's request (M2) | Ignored |
| Agent label `MyApp` | Registered, unreachable (M6) | Rejected or lowercased |
| `GET https://acme--app.vhyxvoid.com/health` | Hub's JSON (M1) | Developer's `/health` |
| 10,000 req/s from 1 IP to a FREE tunnel | 100/min limit holds, but a DB lookup per request on a cold account (M31) | Single-flight lookup |
| 1,000 idle WS connections to `/agent` that never register | Kept forever, 100 MiB frames allowed (M7) | Closed after 10 s |
| Kill Postgres for 30 s during agent registration | "Tunnel active" printed, URL 404 until reconnect (M4) | URL routable, or clear error |
| Stripe delivers `subscription.updated` events out of order | Older state wins (M17) | Newest state wins |

**Load/soak suggestions:**
- **k6 or autocannon against a tunnel** with a local echo backend. Measure p50/p99 through the full chain nginx→hub→agent→backend with 1 KB, 100 KB and 5 MB bodies. Watch hub heap: base64 of a 10 MB body is ~13.3 MB plus the JSON copy plus the string, so roughly 40 MB transient per in-flight request. 20 concurrent 10 MB uploads can push the hub past 1 GB (see P1).
- **WS fan-out soak:** 500 browser WS × 10 msg/s through one agent for 30 min. Check for leaks in `TunnelWsRegistry` and the agent's `wsConnections`.
- **Chaos:** kill the agent mid-response, kill the hub mid-response, drop Redis (Upstash 5xx) for 60 s. Verify the fail-open/fail-closed behaviour matches what's documented.
- **Upstash cost test:** count Redis commands per public request and per SDK request (replay SET, key GET, rate INCR+EXPIRE, usage INCR+EXPIRE, pending SET+DEL). The SDK path is about 7 commands per request, which is the dominant cost at scale (see P3).

---

## 6. Architecture and performance recommendations

**A1. Move tunnels to their own registrable domain.** This is the single biggest security improvement: `*.vhyxvoid.app` on the Public Suffix List, with the host format `<label>.<slug>.vhyxvoid.app`. It fixes C3, reduces C4/H11 blast radius, lets per-account cookie sharing (the product's core insight) be scoped to `.<slug>.vhyxvoid.app`, and removes the need for `--` parsing (and its edge cases). A wildcard cert per account (or an on-demand TLS layer such as Caddy/cert-manager) makes this workable.

**A2. One agent-teardown path.** There are currently four eviction paths: close handler, heartbeat, sweep and replace-on-register. Each does a different subset of registry, pending, tunnel-WS, DB and Redis cleanup (H7, M4, M5). Consolidate them into `AgentLifecycle.teardown(session, reason)` and call it from all four.

**A3. Make the hub the owner of key liveness.** Emit `key.revoked`/`key.rotated`/`account.status_changed` events from the API into Redis pub/sub (`HubPubSub` already exists as a stub). The hub evicts in real time instead of within 60 s via polling, and multi-hub later reuses the same channel.

**A4. Stop using JSON + base64 for the data plane.**
- **P1.** Every body is base64'd (+33%) inside JSON, parsed in full on both ends, and held in memory. The agent also decompresses and re-serialises (H5). Switch `tunnel:forward/response` to binary WS frames: a small header (msgpack is already anticipated in `serializer.ts`) followed by raw bytes, streamed in chunks. This removes the 10 MB ceiling and lets large downloads stream instead of buffering, and it cuts hub CPU/heap by roughly 3×.
- **P2.** `perMessageDeflate: true` on the agent socket compresses already-compressed payloads (images, and gzip if P1 passes bytes through). Disable it for binary frames, or set a threshold.

**A5. Reduce Upstash command volume (P3).** Currently the SDK path costs about 7 commands per request, the flush costs one SCAN over the whole keyspace per account, and the pending registry mirror costs 2 commands per request that nothing reads (`hub:pending:*` is only for a hypothetical multi-hub).
- Drop the pending mirror until multi-hub exists.
- Batch usage in-process, as `PublicPathUsageLimiter` already does, instead of `INCR`+`EXPIRE` per request.
- Use one pipelined call for replay, key and rate.
- If costs grow, consider a self-hosted Redis (TCP) for the hot path. It's roughly 10× cheaper at volume and removes the HTTP round-trip per command.

**A6. Separate the control-plane auth concerns.** Different audiences per token type (user, admin), short TTLs, a Redis-backed `tokenVersion`/admin-status cache, refresh tokens only in httpOnly cookies (admin too), and cross-tab refresh coordination.

**A7. Observability.** Replace `console.*` with a structured logger (pino) that redacts `password`, `token`, `secret`, `authorization`, `cookie`. Add Prometheus metrics beyond `hub_agents_connected`: pending size, request latency histogram, 4xx/5xx by code, WS count, and Redis/DB error counts. Move `/metrics` and `/health` behind an internal port or an auth check (M1, and shared backlog item (a)).

**A8. Remove dead or duplicate surfaces.** Candidates: `/internal/proxy` (M12), `signatureVerification` (L4), `@fastify/jwt` (L5), `blackserver-client.ts`/`demo.js`, `registerBillingUseCases.ts`, commented-out code blocks, `packages/next` vs `middleware/next.ts`. Each is a place where a fix can land in the wrong copy.

**A9. Test strategy.** The suite is solid on units (356 tests), but three of the High bugs above slipped through because every Redis and Prisma interaction is mocked with **assumed** shapes (H4 was hidden by an ioredis-shaped mock). Add:
- an integration job with real Postgres (docker service in CI) and a real Redis (Upstash's REST API has a local emulator, or run `redis` plus a thin adapter);
- one true end-to-end test (nginx + hub + agent + echo backend in docker-compose) that checks gzip, a 5 MB upload, cookies/CORS behaviour and restart cleanup;
- lint in CI (currently only typecheck, build and test run).

---

## 7. Feature proposals

- **F1. Request inspector and replay (the "visibility layer" in the product vision).** Capture request/response metadata (and optionally bodies, size-capped and redacted) for the HTTP path, which isn't audited today (M9). Show a live feed in the dashboard with a "replay this request" button. This is ngrok's most-used feature and the natural wedge for webhook testing.
- **F2. Tunnel access control.** Per-tunnel options: public, basic auth, "members of this account only" (hub-side SSO gate using the dashboard session), IP allowlist. This addresses H11 and makes sharing dev backends safe.
- **F3. Webhook mode.** A per-tunnel "webhook inbox" that stores inbound requests while the agent is offline and replays them on reconnect. This is the real fix for the accepted inbound-replay gap (hub Known Risk #3), scoped to where it matters.
- **F4. Reserved/custom subdomains and custom domains.** `customDomains` is already in `PLAN_LIMITS` but doesn't exist yet. Pairs naturally with A1.
- **F5. Agent health in the dashboard.** Agent version (flag outdated agents, especially ones with the fixed cache-leak bug), last pong, in-flight count, local backend reachability, and a "disconnect this agent" button. That button is also the manual counterpart to H3.
- **F6. Usage alerts.** Email at 80%/100% of `maxRequestsPerMonth` (it's counted but soft today), once H4 makes the numbers real.
- **F7. CLI UX.** `vhyxvoid status` (reads the local discovery endpoint), `vhyxvoid logs` (tails the request feed from F1), exit codes and hard backoff on non-retriable auth errors (a known backlog item), and label validation up front (M6).
- **F8. Security events in the dashboard.** `SecurityEvent` rows (invalid signatures, replays, rate limits) are written but never surfaced. Show them per key so users notice a leaked key.
- **F9. Audit export and admin actions log.** Account-level `AuditLog` is written but not exposed. Owners of team plans will ask for it.

---

## 8. Already-known items re-confirmed still open (for completeness)

These are already tracked in `internal-tools/`; I confirmed they are still present in the code:
- `TunnelClient` cannot authenticate (signs with the raw secret; the verifier uses the peppered hash). Shared backlog.
- `drainUsageCounters` reads ioredis tuple shapes from Upstash. Api backlog; H4 adds a second, independent blocker.
- `accountIdHash` is never set or checked in local discovery. Shared context.
- Inbound replay is incomplete, `PendingRegistry` is in-memory only, and `HubPubSub` is a stub (single-hub only). Hub context #3/#9/#23.
- `withVhyxvoid` may start a tunnel during `next build`. Shared #16.
- Duplicate Next integration (`packages/next` vs `middleware/next.ts`). Shared #14.
- Agent retries forever on `INVALID_SIGNATURE`/`SCOPE_MISSING`/`AGENT_LIMIT_REACHED`. Shared backlog.
- Subdomain Redis keys have no TTL. Shared backlog (d); H7 shows the "cleaned on restart" assumption doesn't hold either.
- Hub `/health` and `/metrics` publicly readable. Shared backlog (a); M1 adds that they also shadow tenant routes.
- Two lockfiles, `demo.js`, and `blackserver-client.ts` still present.

---

## 9. Suggested order of work

1. **Today:** remove C1/C2 logging, rotate/clear production logs, force a global logout. Add `trustProxy` (H1). Add `client_max_body_size` (H6). Fix the content-length header (H5, a one-line change in the agent plus a publish).
2. **This week:** C3/C4 short-term mitigation (stop the Domain/SameSite rewrite and reflected credentialed CORS by default). Token TTLs and revocation (H2). Key-revocation eviction (H3). Replay window (H8). `allowAbsoluteUrls: false` (H9). Refresh grace (H10).
3. **Next:** usage pipeline end-to-end (H4 plus the known backlog bug, one PR with a real-shape integration test). Hub teardown consolidation (H7, A2, M2, M4, M5). Label/slug validation (M6, M18).
4. **Then:** A1 (separate tunnel domain), P1 (binary framing), F1/F2.
