# Project Context — apps/admin

**Scope:** the admin dashboard for VhyxVoid's Admin RBAC system
(`@vhyxvoid/admin`, Next.js 16 / React 19, port 4001). See
`internal-tools/shared/context.md` for the monorepo-wide Architecture
diagram and the VhyxUI/`@vhyx/api-kit` linking conventions this app
shares with `apps/web`, and `internal-tools/api/context.md` for the Admin
RBAC backend this app is a frontend for.

Created 2026-09-17 (investigation-and-plan session, no code written — see
Part 1/2/3 below, preserved as the original scoping record). **Scaffolded
and Screen 1 (login) + Screen 2 (dashboard shell) built the same day**, in
a second session — see "Current State" immediately below, then
`decision.md`'s two 2026-09-17 entries for the full build/verification
trail. **Screen 3 (Admin Users, list + detail + role assignment) built in
a third session, same day** — see "Current State — Screen 3" below and
`decision.md`'s third 2026-09-17 entry. **Screen 4 (Roles, list + detail/
edit + ability assignment + create) built in a fourth session, same day**
— see "Current State — Screen 4" below and `decision.md`'s fourth
2026-09-17 entry. Parts 1-3 below are the original plan; corrections later
sessions made to that plan are noted inline where they occurred. **First
real interactive browser verification pass over all 7 screens done
2026-09-18** — see "Current State — chrome-visual verification pass"
below. **Both bugs that pass found were fixed the same day, in a
dedicated fix session** — see "Current State — chrome-visual bug fixes"
immediately below.

## Plan — Admin Panel v2 (operational/infrastructure control) — 2026-09-22, investigation only, nothing built

Scope: what today needs SSH/manual server access but belongs in the admin panel. Every claim below was re-read from code/config this session unless marked *(unverified)*. Decisions are in `decision.md` (2026-09-22, "Admin Panel v2"); the API gap list is in `backlog.md`.

### Corrections to the brief's premises (read first)
- **No "Redis/Neon setup" happened this week in the docs or git.** Prod already ran on Neon Postgres + Upstash Redis (`LOCAL_DEV_BACKEND.md`); `docker-compose.yml` has neither. What this week did do: the P3009 failed-migration incident (migration `20260426101925_serverboot`, marked rolled back 2026-09-20; `docker-compose.override.yml`, `a61d26d`, makes the api skip `prisma migrate deploy`), cert automation (`f64f699`, `certbot/dns-cloudflare` DNS-01), the 120 s tunnel timeout (`473b4ff`), WS relay Phase 1 (`8c74574`), Cloudflare-only nginx for api/hub (`7816fdb`, `e1f6f4d`).
- **"Frame-loss metrics" do not exist.** WS Phase 1 *fixed* the loss (D1/D2) but added no counters. The hub exposes one gauge (`/metrics` = `hub_agents_connected`) and a `/health` JSON. Anything more is new hub instrumentation.
- **`apps/admin` is not deployed anywhere.** Not in `docker-compose.yml`, not in `nginx.conf`, and the API's CORS `allowedOrigins` only lists `http://localhost:4001` for it. A System Health screen only helps during an incident if admins can reach it in production — this is a prerequisite decision (see Phase 0).
- **The failed migration is not on disk.** `apps/api/prisma/migrations/` has no `20260426101925_serverboot` and `git log --all` finds none, yet prod's `_prisma_migrations` recorded it. "Recorded in the DB but not on disk" is a real state the migrations card must show.
- **Because of the override, a new migration is silently NOT applied on deploy.** "Pending migrations" (on disk, not in DB) is the only place that would show it.

### Part 1 — Inventory

| Area | What exists today (verified) | Manageable from the panel? |
|---|---|---|
| **Redis (Upstash)** | One REST client (`packages/shared/src/clients.ts`, `@upstash/redis`). Key families: `apikey:data:{id}` (5 min TTL), `apikey:rate:{keyId}:{minute}` (65 s), usage counters (25 h), `apikey:replay:{requestId}` (60 s), `hub:agent:{accountId}:{label}` presence (TTL 25 s, refreshed every pong = 15 s, so one missed pong is tolerated), `hub:pending:{requestId}` (TTL just above the request timeout), subdomain registry keys (set with **no TTL**; cleaned by `unregisterAllForHub` at hub start), nonce keys (`auth.util.ts`). | **Health: yes.** PING and a set/get/del round-trip prove connectivity and the write path. **Stats: partly.** Upstash's REST docs list PING and INFO as supported; they do *not* say what INFO returns, and do not document DBSIZE/MEMORY USAGE (SCAN already works — the code uses it). Real usage/limits (`db_memory_threshold`, `db_max_clients`, `db_max_commands_per_second`, `state`) and a `GET /redis/database/{id}/stats` endpoint exist only in Upstash's **Developer API**, which needs *separate* credentials (email + API key, Basic auth) that are not in any env file today. **Cost note:** Upstash bills per command *(pricing tier unverified)* — refresh on demand with a short server-side cache, never a polling loop. Prefix key counts via SCAN cost commands; cap them. Rate-limit "state" is per-key-per-minute buckets, so only a per-key lookup is meaningful, not a global list. Needs a **spike with real credentials** before promising INFO/DBSIZE numbers. |
| **Database (Neon)** | Prisma, 25+ models. Migrations table is Prisma's `_prisma_migrations`; the image builds from `apps/api/prisma/` *(that the runtime stage ships `prisma/migrations` is unverified — confirm)*. | **Yes, almost entirely from Postgres itself** (no Neon credentials needed): `SELECT 1` latency, `version()`, `pg_database_size`, `pg_stat_activity` count, `pg_stat_user_tables` row estimates for the append-only tables (`tunnel_requests`, `tunnel_sessions`, `AdminAuditLog`; **no retention job was found among the workers — unverified**). **Migration status** = reconcile `_prisma_migrations` (applied / failed = `finished_at` null and not rolled back / rolled back) against the directory listing: pending (disk, not DB) and orphaned (DB, not disk — exactly `serverboot`). Neon's own API (`https://console.neon.tech/api/v2`, Bearer `NEON_API_KEY`) adds endpoint compute state, consumption history and failed operations, but needs a new key + project id; optional. **Neon autosuspend:** a health poll keeps compute awake and billable, and the first check after idle shows a cold-start latency spike — on-demand only, and label slow-first-call as expected. |
| **Hub / tunnels** | Single hub process, in-memory registries (no horizontal scaling; `HubPubSub` is a stub). `GET /health` → `{status, instanceId, uptime, agents, sdks, memoryMb}`; `GET /metrics` → one gauge. Registries expose `totalCount()`, `PendingRegistry.size()`, `TunnelWsRegistry.size()`. nginx `location /` proxies **everything** (including `/health`, `/metrics`) to the hub on `hub.vhyxvoid.com` (Cloudflare-only), so both are publicly readable *(confirm live)*. Hub port 9001 is published on `127.0.0.1` only, but the api container can reach `http://hub:9001` over the `platform` network. `/internal/proxy` already has a shared-secret, fail-closed, `timingSafeEqual` auth pattern to reuse. Postgres already has `TunnelSession` (status, hubInstanceId, metadata `{agentVersion, ip}`) and `TunnelRequest` (status, durationMs, errorCode). | **Live counts: yes, with new hub work** (an authenticated `/internal/stats`; agents, sdks, pending, tunnel-WS connections, uptime, heap, instanceId). The hub's memory is the truth; `TunnelSession` rows lag on a crash (the hub only evicts its own stale rows at start). **Request error rate / latency: yes from Postgres today** (`TunnelRequest`), though those writes are fire-and-forget so it undercounts under DB trouble. **Frame-loss / drop counters: no** — new instrumentation. Needs `HUB_INTERNAL_URL` and `HUB_INTERNAL_SECRET` in the *production* api env (documented as "dev only" / "no caller yet" today). |
| **Certificates** | Two lineages behind nginx: `api.vhyxvoid.com` (api+hub SAN, valid to 2026-11-27 as of 2026-09-20) and the `*.vhyxvoid.com` wildcard (expired 2026-08-03, was manual DNS-01 with no hook; `f64f699` switched the certbot service to `certbot/dns-cloudflare`). **Whether the wildcard has actually renewed on the live server is not established in the repo** — the docs' Known Risk #2 is stale either way. | **Yes, by probing, not by reading files:** `./certbot/conf` is mounted only into nginx and certbot, not the api container. Probe with a TLS handshake from the api container to `nginx:443` with each SNI (api., hub., a random tunnel host) and read `notAfter`/SAN/issuer. Probing the *public* `api.`/`hub.` names would show Cloudflare's edge cert, not the origin's — the wrong signal. The handshake completes before nginx's HTTP-level Cloudflare allow-list applies *(unverified — spike)*. |
| **Storage** | **Does not exist.** No S3/blob/multer dependency in api/hub/web; no upload route. The only hits: `usage.entities.ts` "cold storage" (a Postgres table), and `Feedback.attachments String[]` whose route comment says "frontend uploads to storage first, sends URLs here" — there is no such upload endpoint or store, so it is aspirational. The agent's SQLite queue lives on developer machines, not the server. | **No screen.** What "storage" plausibly means operationally (DB size, table growth) is covered by the DB card. Do not design a storage dashboard. |
| **Plan limits** | `PLAN_LIMITS` is a code constant, moved 2026-09-22 from `apps/api`'s `billing/domain/enums/index.ts` (which now just re-exports it) to `packages/shared/src/planLimits.ts` so `apps/hub` can import it too — not DB rows either way. Flat-rate FREE/PRO/ENTERPRISE (decided 2026-09-13). Enforcement as of 2026-09-22 (sessions S1-S4, commits `c8b98e6`/`069f3d9`/`a967c03`/`9f246be`/`2465450`, **none deployed yet**): max API keys / scopes / PROD keys / rotation **enforced** at the API; concurrent agents **enforced against the account's real plan**, with a same-label-reconnect exclusion — was "hub applies the PRO limit (5) to everyone"; account members **enforced** (counted at invite and accept time; an account already over its limit from before enforcement keeps its existing members); per-minute rate limit **partial** — a cache reload now carries the real plan limit instead of resetting to `-1`, but agents and public tunnel-URL traffic (most of it) are still never checked, only `TunnelClient` SDK requests are; requests/month, custom domains, retention **no enforcement site**; `PAST_DUE` accounts now connect (the grace period keeps tunnels running), status changes reach the hub within seconds (a new per-account cache invalidator, not the old up-to-5-min cache lag), and a hub sweep evicts a live connection within ~60s of its account becoming non-connectable (SUSPENDED, etc.) — once S1 is also deployed, a `PAST_DUE` account genuinely gets suspended after 7 days and its live connection is evicted the same way. Full detail: `internal-tools/shared/context.md` Known Risk #57, `shared/decision.md` (sessions S1-S4). | **Read-only reference: yes** (an "enforced / partly / not enforced" matrix — `maxAgents`/`maxMembers` should move from their old states to "enforced" once S3/S2 are confirmed deployed). **Editing limits: no** — constants, Stripe is the plan source of truth. The remaining enforcement gaps are backend work of their own (E1-E7 in `backlog.md`). |
| **CMS** | `apps/docs`: 29 MDX pages in git with generated blocks and a `check:fresh` pipeline that verifies pages against code (`verified.commit`/`verified.packages`). `apps/web` public pages are stubs: home 40 lines, docs 12, support 15, pricing 12 ("Coming soon"). Notification/email template content was **not inspected**. | **No CMS.** A DB-backed editor would break the docs' freshness verification (content must stay in git next to the code it describes), and the marketing pages have no content to manage yet. Revisit when the public site is real. |

### Part 2 — Prioritized screens

Every item is read-only unless it says otherwise. "New API" = needs new `apps/api` surface (or hub surface).

| # | Screen / feature | Value | New API? | Size |
|---|---|---|---|---|
| **P0** | **System Health** — cards for API (uptime, memory, node, build SHA), Postgres, Redis, Hub, Certificates, Migrations. Each card has its own status (`ok` / `degraded` / `down` / `unknown`), `checkedAt`, latency, and a message; a failing dependency turns its card red and never fails the whole page. On-demand refresh, no auto-poll. | Highest. Each of this week's incidents would have been visible: expired wildcard cert (red for 6+ weeks), P3009 / orphaned / pending migrations, Redis outage. | Yes (H1-H5, H8) | 2 sessions |
| **P1** | **Live tunnels** — agents currently connected (account, label, agent version, connected since, hub instance) from the hub's memory, plus recent `TunnelSession` history and 24 h error rate/latency from `TunnelRequest`. Force-disconnect is a *later* write action needing its own decision. | High for support ("is their agent connected?"). | Yes (H4 + list endpoint) | 1 session |
| **P1** | **Accounts (support view)** — search accounts; detail with plan/subscription state, members, API-key counts/status, recent tunnel sessions, this period's usage next to the plan limits (each row tagged enforced or not), invoices, a Stripe-customer link-out. **Support actions:** suspend/reactivate an account, revoke an API key. **No plan/limit editing.** | High, but larger. | Yes (A1-A4) | 2 sessions |
| **P2** | **Plan limits reference** — the enforcement matrix above, from a typed map kept next to `PLAN_LIMITS`. Could live inside Accounts. | Medium; keeps the panel honest about what is enforced. | Yes, small (A6) | 0.5 session |
| **P2** | **Runtime config (read-only)** — effective non-secret config: `TIMING` constants (heartbeat 15 s, max missed 6, presence TTL 25 s, request timeout 120/122 s), which required env vars are *set* (booleans, never values), build SHA, node version. | Medium. | Yes, small (H8 + a config route) | 0.5 session |
| **Not proposed** | Storage dashboard (nothing to show). CMS (nothing to manage). Editing limits/plans (Stripe + flat-rate decision). Editing env/config, restarting containers, triggering cert renewal (needs SSH/Docker-socket power inside the api container: a privilege escalation, no). Flushing Redis (dangerous: replay + key cache). *A per-key "invalidate cache" support action is safe* (`RedisApiKeyCache.del`) and can ride along with Accounts. | | | |

**Admin RBAC:** new abilities `system.read`, `tunnel.read`, `account.read`, `account.update` (suspend/reactivate, key revoke) added to `SYSTEM_ABILITIES` (`AdminAbility.entities.ts`); reuse existing `user.read` for end-user lookup. `seed-abilities.ts` is idempotent but must be **run in production**; super admin bypasses `requireAbility`. Every write route must write an `AdminAuditLog` row (Feedback triage still doesn't — don't copy it).

### Part 3 — API gap analysis

Sizes: **S** = one small route, no design; **M** = new use case/queries, tests, some design; **L** = needs its own decision. Full list with ids is in `backlog.md`.

- **Small/contained (build without further decisions):** H1 overview aggregator (fail-soft per subsystem), H2 Postgres probe + migration reconcile, H3 Redis probe, H5 cert probe, H8 build info, A6 plan-limits matrix, the four new abilities.
- **Needs hub + deploy-config work (M):** H4 hub `/internal/stats` (+ agent list) with the existing shared-secret pattern, and `HUB_INTERNAL_URL`/`HUB_INTERNAL_SECRET` set in production; H6 hub counters (dropped/unroutable WS frames, pending timeouts, 502/504 counts) — new instrumentation, no such data today.
- **Accounts (M):** the admin module has **no** account/user/subscription queries at all (`admin.routes.ts` has none). A1 list/search, A2 detail aggregate, A4 revoke-key-as-admin (the existing use cases take a *user* context). **A3 suspend/reactivate needs a decision (M-L):** `Account.status` is honored only at connect time; a connected agent stays connected until it reconnects, so suspend must also evict live sessions on the hub (`closeAllForAgent` exists for WS only), and `PAST_DUE`/grace semantics (E6/E7) interact with it.
- **Needs its own decision (L):** A5 admin plan/limit override — touches the flat-rate billing model and Stripe-as-source-of-truth; **recommendation: do not build; link to the Stripe dashboard via `stripeCustomerId`.** H7 Upstash Developer API / Neon API integration — new secrets and a new outbound dependency; optional, after the free probes prove insufficient.
- **Backend enforcement gaps this exposes (separate work; UI must not imply enforcement that isn't there):** E1 **FIXED IN SOURCE by S3** — hub now applies the real plan's agent limit, was PRO's limit for everyone; E2 **FIXED IN SOURCE by S3** — a cache reload now carries the real plan limit, was unlimited; E3 public HTTP tunnel does no key check (per-key rate limit never applies; the WS design doc §5 already recommends tunnel access tokens as their own project) — unchanged, S5; E4 **FIXED IN SOURCE by S3** — the dead `rateLimitPerMinute` field on the agent handshake is removed, not just unread; E5 **`maxMembers` FIXED IN SOURCE by S2** — counted at invite and accept time; requests-per-month / custom domains / retention have no enforcement site — unchanged, S5/S6; E6 **FIXED IN SOURCE by S4** — `PAST_DUE` now connects, status changes reach the hub within seconds (not up to 5 min late), and a live connection is evicted within ~60s of its account becoming non-connectable; E7 `GracePeriodWorker` is registered and running, and **FIXED IN SOURCE by S1** — the webhook now sets a real deadline instead of leaving `graceEndsAt` null, so it does suspend accounts once deployed. Verified state, corrections and the fix plan for all seven: `internal-tools/shared/context.md` Known Risks #57 and `shared/decision.md` (sessions S1-S4; supersedes api decision 2026-09-13 as the reference for E7). None of S1-S4 is deployed.
- **Deploy prerequisite (not an API):** production hosting for `apps/admin` (Phase 0).

### Part 4 — Phased build plan

- **Phase 0 — prerequisites (decisions + spikes, ~half a session, before any code):** (a) **Where does `apps/admin` run in production and how is it protected** (own container + nginx `admin.` block + Cloudflare Access or IP allow-list? or Vercel?), then the CORS origin, `docker-compose.yml`/nginx changes, and the CI/build; without this, Phase 1 only works from a developer laptop. (b) Spike with real Upstash credentials: does `INFO`/`DBSIZE` work through `@upstash/redis`, and what do they return. (c) Confirm the runtime api image contains `prisma/migrations`, and that a TLS handshake from the api container to `nginx:443` with each SNI returns the origin cert. (d) Set `HUB_INTERNAL_URL`/`HUB_INTERNAL_SECRET` in production env. (e) Add `system.read` etc. and re-run `seed-abilities` in prod.
- **Phase 1 — System Health (highest value, most contained):** 1a backend H1-H5, H8 with tests (local sandbox has no hub/nginx/certs and no Upstash reachability, so probes are tested against fakes and the fail-soft path; real values need a deploy); 1b `apps/admin` screen + Chrome pass. Deploy order: api first, then admin. Then (optional, same phase) **H6 hub counters**, since the card is thinnest for tunnel health without them.
- **Phase 2 — Live tunnels + Accounts (support):** hub agent-list endpoint; A1, A2, A6, A4, then A3 after its decision; the E6/E7 decisions should land first or the Accounts screen will show `PAST_DUE` accounts that never suspend. Expect this phase to surface E1-E5 in the UI as "not enforced" tags; fix the backend gaps on their own schedule.
- **Phase 3 — Infra configuration visibility:** runtime config view; optionally H7 (Upstash Developer API stats, Neon API endpoint/consumption) if Phase 1's free probes proved insufficient; force-disconnect of a live agent if support wants it (its own decision).
- **Phase 4 — CMS: not scheduled.** No content justifies it today. Revisit only if `apps/web`'s marketing pages become real and non-engineers need to edit them; docs stay in git.

**Testing note for every phase:** each new route must be exercised against the running local backend with curl before the UI is written (this app's established discipline), and the Redis-unreachable sandbox is a feature here: it proves the card degrades instead of erroring.

## Hosting and access control for production — investigation and recommendation (2026-09-22, awaiting approval, nothing implemented)

Resolves Phase 0(a) of the plan above. Recommendation and rationale in `decision.md` (2026-09-22, "apps/admin production hosting"). Everything here was checked against the repo, the live server (read-only ssh) or live DNS/HTTP unless marked *(unverified)*.

### Production database (the migration part of the same brief)
- **No reset was needed and none was done.** Production's `DATABASE_URL` (`.env.production` locally and on the server, both `ep-curly-mud-b5ykhbsz-pooler…us-east-2` Neon; the `ep-super-art…` line is commented out) already has `_prisma_migrations` = exactly the 12 migrations in `apps/api/prisma/migrations`, all `finished_at` set, none rolled back, no `serverboot` row, and `prisma migrate status` says "Database schema is up to date". All started 2026-09-20, i.e. the database was already re-migrated cleanly the day of the incident. Earlier docs ("`serverboot` orphaned in production") were true before that and are stale now.
- **Every table in production is empty** (exact `count(*)` on all 32 tables, read-only connection): no users, accounts, keys, tunnel rows, **and no `AdminUser`/`AdminRole`/`AdminAbility`**. Consequence: **nobody can log in to the admin panel in production today**, and the seed script creates `admin@company.local` / `Admin@12345678`; there is no admin password change/reset endpoint, so a prod super admin must be created with a chosen password (backlog).
- **`docker-compose.override.yml` is still active on the server** (`platform-api` runs `["node","bootstrap.js"]`), and I did **not** remove it: I tried to prove the normal start command (`npx prisma migrate deploy && node bootstrap.js`, `Dockerfile.api:59`) against production by running `prisma migrate deploy` from this machine (expected no-op, and it exercises the advisory lock through Neon's `-pooler` endpoint, which is the one thing that could hang a container start); the auto-mode classifier denied that command and I did not retry or work around it. The first attempt failed harmlessly (`timeout` does not exist on macOS), so `migrate deploy` has **never run** in this session; `_prisma_migrations` still has 12 rows.
- The server checkout is at `e1f6f4d`, i.e. **before `8c74574`**: the hub half of WS relay Phase 1 is not deployed (the 120 s timeout, `473b4ff`, is). This answers the standing open question "confirm the production hub has 8c74574".
- The runtime image does ship `apps/api/prisma` (`Dockerfile.api:47`), answering Phase 0(c)'s first half.

### What is actually true of the environment (drives the recommendation)
| Fact | Evidence |
|---|---|
| The VPS is small: 911 MB RAM (123 MB available), 2 GB swap with 684 MB used, 2 vCPU, 4.8 GB disk free (74% used); `dockerd` alone is 406 MB RSS; api 40 MB, hub 17 MB. | read-only ssh |
| A Next.js build cannot happen on that box. A running Next server would need on the order of 100 MB *(estimate, not measured)* out of 123 MB available. | as above |
| `apps/admin` depends on **two sibling repos via `link:`** (`../../../VhyxUI/packages/{react,tokens}`, `../../../vhyx-api-kit`) that live outside this repo. `@vhyx/api-kit` is `private` and **not on npm** (404); `@vhyxui/react` on npm is `0.1.0-alpha.1` while the code uses `0.3.1-alpha` (private GitHub fork `tanveeeer-in/VhyxUI`). So neither a Docker build inside this repo nor Vercel can build the admin app today. CI already excludes `apps/web` for this exact reason and lists it as an undecided item. | package.json files, `npm view`, `ci.yml` comments |
| `apps/admin`'s API URL is a build-time constant (`NEXT_PUBLIC_ADMIN_API_URL`, default `http://localhost:9000/api/v1`) and its detail pages are three dynamic `[id]` routes (`roles`, `feedback`, `admin-users`), all client-side. | `http.ts:83`, `src/app` |
| **The admin API is already public.** `GET https://api.vhyxvoid.com/api/v1/admin/identity/me` answers 403 from the internet; nginx's `api.` block proxies every path. Protecting only an admin *UI* hostname would leave the sensitive surface untouched. | live curl, `nginx.conf` |
| `admin.` and `ops.` already resolve to the **origin IP** (`44.200.78.108`) through the DNS-only `*` wildcard and reach the hub's tunnel block (HTTP 400 today). A Cloudflare-protected admin host needs its own explicit **proxied** record, or it is a direct-to-origin bypass. | `dig @1.1.1.1`, live curl |
| The API's only limiter is a global `@fastify/rate-limit` `max 100 / 1 min` with **no `trustProxy` set anywhere in `apps/api`** (grep). Fastify then keys on the socket peer, i.e. the nginx container, so all clients likely share one bucket *(inferred from the config, not tested live)*: one client can lock everyone out of login, and it is no protection per attacker. **FIXED IN SOURCE 2026-09-24 (`5e255b0`, not deployed):** confirmed live first (real server, in-process requests: 100 from one client, then every user and admin login 429'd); now `trustProxy` for private-network peers, limiter registered first, admin login 5/min and user login 10/min per real client IP. See `api/decision.md`, 2026-09-24, "H1". | `register.plugin.ts:45`, grep |
| The nginx origin lock for Cloudflare (`$from_cloudflare` `geo` + `return 403`) already exists and is proven on `api.`/`hub.`. | `nginx.conf`, `cloudflare-allow.conf` |
| Cloudflare Zero Trust free plan: Access for self-hosted apps, up to 50 users, one-time-PIN login without an identity provider (Cloudflare's plans page and blog; whether a payment method is required at sign-up is *unverified*). Access needs the hostname proxied through Cloudflare, supports path policies, and origins can validate the `Cf-Access-Jwt-Assertion` token. | Cloudflare docs |
| Vercel: Trusted IPs is Enterprise-only; Password Protection is Pro/Enterprise ($20/month per protected project on Pro); Vercel Authentication admits Vercel team members only, and whether it covers a *custom production domain* is *unverified*. | Vercel docs |
| No Tailscale on the VPS. Tanveer's public IP stability cannot be determined from here. | ssh, n/a |

### Options compared
**Hosting**
1. **Co-locate on the VPS (Docker + nginx).** Effort: image built *off-box* and loaded (the box cannot build Next; and the sibling repos must be available at build time via compose `additional_contexts` or a CI job that checks out all three repos), a compose service with a memory cap and healthcheck and no published port, one nginx server block, one DNS record, no CORS if the API is proxied same-origin. Reuses the wildcard cert (valid to 2026-12-19, now auto-renewed by DNS-01 *(renewal on the live server not observed)*), the origin lock, and the deploy path. Risks: memory (may need an instance resize), fate-sharing with the box it monitors.
2. **Vercel.** Simpler runtime (no RAM on the VPS, off-box so it stays up when the VPS is down), but: the same sibling-package blocker (still needs publishing or vendoring); a second deployment paradigm beside compose; every protection feature that matters (Trusted IPs, password) is a paid tier; the `*.vercel.app` deployment URL is a second entrance that Cloudflare Access does not cover unless Vercel's own protection is also configured; the admin API is still on `api.vhyxvoid.com`, so the browser calls it cross-origin (CORS) or through server-side rewrites that hide the caller from the API. It trades one kind of complexity for a different one and does not remove the blocker. *(Vercel Hobby's terms restrict use to non-commercial projects — recalled, unverified.)*

**Access control**
- **Cloudflare Access:** the only option that removes unauthenticated discovery of both the UI and the admin API, works from any network, needs no stable IP, free at this scale, and pairs with the existing origin lock so it cannot be bypassed. Needs: Zero Trust organization, an Access app for `admin.vhyxvoid.com`, an allow policy (email one-time PIN for Tanveer's address(es)), and the admin host proxied.
- **nginx IP allow-list:** trivial to build and independent of any third party, but only as good as a stable IP (unknown; a dynamic home/mobile address locks Tanveer out, and there is no other way in without SSH). Best as an *additional* Access rule (`Include IP ranges`) if a static IP exists, not as the only gate.
- **Admin login only (`AdminUser`/`AdminSession`):** already strong for who can act (bcrypt, sessions, reuse detection, audit log), but it leaves the login endpoint and the whole admin API publicly reachable and probeable, behind a rate limiter that is probably one shared bucket. Keep it as the second gate, not the only one.

### Recommendation (details and next steps in `decision.md`)
**Co-locate on the VPS at `admin.vhyxvoid.com`, gated by Cloudflare Access, with the admin API served same-origin through that host and blocked on `api.vhyxvoid.com`; keep admin login as the second gate; if the memory spike says no, resize the instance rather than move to Vercel.**

## Current State — Create Admin and Edit Profile (2026-09-22)

**All 7 screens plus both forms are built.** The two forms Screen 3 deferred (see "Screen 3" below, which still says "deliberately NOT built" — kept per the append-only convention, corrected here) are now real and were click-through verified in Chrome on 2026-09-22 (`chrome-visual.md`, last section). Screens 1-7 were click-through verified 2026-09-18; the two forms 2026-09-22.

**Real backend contract, re-read from the code and re-proven with curl before any UI was written** (`useCreateAdmin()` from Screen 3 was still correct and unchanged):
- `POST /admin/identity/users` (`admin.create`): `{email, password (min 8, no other rule), firstName, lastName}` → 201 `{id, email, fullName}`; duplicate email → 409 "Admin with this email already exists"; bad email/short password → 400 with per-field `errors`. **No role at creation** (`CreateAdminUseCase`/`AdminUser.create` take none; never a super admin), so a new admin can log in but every ability-gated route answers 403 until a role is assigned separately.
- **"Edit profile" = `PUT /admin/identity/users/:id` (`admin.update`), first/last name only, on ANY admin by id, the signed-in admin included.** There is no `PUT /me` and no email or password change anywhere in `apps/api` (full route list checked; `GET /me` and `GET /me/abilities` are the only `/me` routes). **The route silently ignores** `email`, `password`, and blank/whitespace names and still answers **200** (`AdminUser.updateProfile` keeps the old value when a name is blank) — proven live 2026-09-22. So the UI offers only the two names and rejects blanks itself.

**What was built** (`apps/admin/src/views/admin-users/`): `CreateAdminDialog.tsx` (Dialog + RHF + yup; a client-only confirm-password field because an admin sets another person's password and there is no reset endpoint; success toast then `router.push('/admin-users/<newId>')` so a role can be assigned; a 409 is shown on the email field via `setError`, anything else as a toast), `EditAdminProfileCard.tsx` (on `AdminUserDetailView`; Save disabled until dirty), `adminUserForms.schema.ts` (both yup schemas and the payload builders, pure and tested), a "Create admin" toolbar button in `AdminUsersTable`, `useUpdateAdmin(id)` in `useAdminUsers.ts` (invalidates `adminUserKeys.all` + `detail(id)`, and syncs the session store's `fullName` when `id` is the signed-in admin), `adminUserService.update`. 25 new tests (`apps/admin` 14 files/86 tests → 18 files/111 tests); mutation-checked (removing the store sync, leaking `confirmPassword`, and dropping the 409 branch each fail the intended tests).

**Two things found in the browser pass that differ from what the code comments/design assumed:**
1. **The header never shows the signed-in admin's name** — `DashboardShell.tsx:64` renders `admin.email` only, and no component renders `admin.fullName`. `useUpdateAdmin`'s store sync works (store `fullName` went "Super Admin" → "Root Admin" immediately) but nothing visible changes. Kept anyway: it is one line, keeps the persisted session consistent, and is tested. Not a bug, but the "header updates" expectation can't be observed.
2. **A hard load of a deep link (`/admin-users`) lands on `/dashboard`** while signed in (in-app navigation is fine). Consistent with the existing backlog item "no session-bootstrap-on-reload flow"; not investigated further and not caused by this change.

**Real backend gaps, not faked in the UI:** no admin password reset/change (already in backlog), and `PUT /users/:id` answering 200 for ignored/blank input (filed in `internal-tools/api/backlog.md`).

## Current State — chrome-visual bug fixes (2026-09-18, fix session)

Fixed both findings from the chrome-visual verification pass below,
directly from `backlog.md`/`chrome-visual.md`'s own detail — see
`decision.md`, 2026-09-18, "Fixing the two chrome-visual bugs" for the
full investigation and fix trail. Summary:

- **Invisible icon-only buttons (app-wide, high severity)**: copied
  `apps/web/src/assets/iconify-icons/generated-icons.css` into
  `apps/admin/src/assets/iconify-icons/`, added the `@assets/*` tsconfig
  path alias `apps/admin` was missing, and added the matching
  `import '@assets/iconify-icons/generated-icons.css'` to
  `apps/admin/src/app/layout.tsx`. Deliberately did **not** copy
  `bundle-icons-css.ts` (the dev-time icon-set generation script) or its
  `@iconify/*`/`tsx` devDependencies — the generated CSS is a complete,
  self-sufficient runtime artifact needing no build step, and wiring the
  full generation toolchain was judged out of scope for this fix.
  Re-verified in a real browser on 4 screens (Admin Users, Roles,
  Feedback, Abilities) — every row-action icon, the Abilities delete/trash
  icon specifically (previously only locatable via an accessibility-tree
  search, now directly visible), sort arrows, and the role-detail page's
  back-arrow and revoke-badge "×" are all now genuinely visible. The
  navigation dead-end this bug compounded into is resolved as a direct
  consequence (the "view" action icon is now a real, visible, clickable
  affordance); row-name/title text itself still isn't wired to navigate,
  confirmed to be this app-family's own established, intentional
  convention (`apps/web`'s `MembersTable.tsx` has the identical
  never-wired pattern), not a separate bug.
- **Super Admin disable-guard regression — investigated the backend
  first, turned out to be UI-only.** `AdminUser.disable()`
  (`apps/api/.../AdminUser.entities.ts`) already throws
  `UnauthorizedError('Cannot disable super admin account')` for
  `isSuperAdmin` targets — confirmed both by reading the entity and live
  via curl against the real backend (401, account status unchanged
  afterward). The real root cause: `RowAction.tsx`'s `type:
  'confirmation'` branch never forwarded a row action's `disabled`
  callback result to `<Confirmation>`, and `Confirmation.tsx` had no
  `disabled` prop at all to receive it — so `AdminUsersTable.tsx`'s
  already-correct guard (`disabled: () => admin.isSuperAdmin || isSelf`)
  was silently discarded for every `confirmation`-type row action in the
  app, not just this one. Fixed by adding `disabled?: boolean` to
  `ConfirmationProps` and wiring it through `RowAction.tsx`; also had to
  exclude `disabled` from the `ConfirmationProps` intersection in
  `libs/table/type.ts`'s `ConfirmationAction<T>` (it was colliding with
  `BaseAction<T>`'s own `disabled?: (row: T) => boolean`, producing an
  unsatisfiable type — `tsc` caught this immediately). **Verified via
  direct DOM inspection only, never by clicking the real super admin's own
  Disable button**: `admin@company.local`'s own row shows `disabled: true`
  for its Disable action (from both its own view and another admin's
  view); `test-admin@company.local` (temporarily given the "Admin" RBAC
  role for this check, then reverted to zero roles afterward) shows
  `disabled: false` on its own row when viewed by the super admin, but
  `disabled: true` when viewing its own row while logged in as itself —
  confirming both the `isSuperAdmin` and `isSelf` disjuncts of the guard
  independently work.
- Cross-cutting finding, not fixed (out of scope, flagged instead):
  `apps/web`'s own copy of `Confirmation.tsx`/`RowAction.tsx` has the
  identical `disabled`-prop gap, but no `apps/web` call site currently
  sets `disabled` on a `confirmation`-type row action, so it's a latent,
  unexercised gap there rather than an active bug — flagged in
  `internal-tools/user-frontend/backlog.md`.
- Two new test files: `src/app/layout.icons.test.ts` (17 tests — the
  layout import, the copied CSS file's presence/size, and every real
  `tabler-*` class this app's source references has a defined rule) and
  `src/libs/table/RowAction.test.tsx` (5 tests — the confirmation-type
  disabled guard, both directions, plus a no-`disabled`-callback
  no-crash case). Both confirmed to genuinely fail against the pre-fix
  code via a targeted `git stash`/re-run/`git stash pop` cycle.
  `apps/admin` now 14 files/86 tests (up from 12/64 the Screen 7 session
  left it at — 22 new: 17 icon-CSS + 5 RowAction disabled-guard).
- `pnpm --filter @vhyxvoid/admin typecheck/build/test` all clean;
  `pnpm turbo run typecheck/build --filter='!@vhyxvoid/web'` (10/10, 9/9);
  root e2e suite (22/22 files, 106/106 tests) and `apps/web`'s own test
  suite (8/8 files, 28/28 tests) both unaffected.

## Current State — chrome-visual verification pass (2026-09-18)

First real interactive browser click-through of every screen (Screens 1-7),
never done in any of the 7 build sessions above — all of them deferred it
(no Chrome extension available, or deliberately batched per Tanveer's
explicit direction). Full detail in
`internal-tools/admin-frontend/chrome-visual.md`; summary here:

- **Headline finding, app-wide, high severity**: every icon-only button in
  the app (every row action across all 7 screens, every `Confirmation`
  dialog's icon, every role/ability revoke-badge button) renders with
  **zero visible pixels** — fully real, wired, functional `<button>`
  elements, just invisible. Root cause confirmed by reading the code
  directly, not just observing the symptom: `apps/admin`'s copied
  `RowAction.tsx`/`Confirmation.tsx` use the Tabler icon-font className
  convention (`tabler-eye`, `tabler-trash`, etc.), but
  `apps/admin/src/app/layout.tsx` never imports the generated icon-font CSS
  those classes depend on — `apps/web` does
  (`apps/web/src/app/layout.tsx:38`, backed by a real
  `apps/web/src/assets/iconify-icons/` directory `apps/admin` doesn't have
  at all). This was never caught by any prior session's curl/test-suite
  verification, since it's a pure missing-CSS gap with no runtime error and
  no effect on the underlying API contract. Compounds into a real
  navigation dead-end: clicking a row's name/title text doesn't navigate to
  detail — only the invisible "view" action does, so a real user has no
  visible way to reach any detail page in the app today. Not fixed this
  session (verification pass, not a fix session) — see backlog.md.
- **A real, previously-undiscovered regression, not caught by any prior
  session's curl-only verification**: the Admin Users table's "Disable" row
  action is present and enabled (no `disabled` attribute) for the
  **Super Admin's own row** — the currently-logged-in super admin,
  `admin@company.local`. Contradicts the Screen 3 session's own record that
  this should be hidden/disabled for both the logged-in admin's own row and
  for super admins. Confirmed via the accessibility tree, deliberately not
  clicked (would have disabled the only super-admin login). Flagged in
  backlog.md as high priority.
- **Everything else genuinely works**, confirmed by real interaction (not
  just curl): login/bad-credentials/logout/route-protection; all 6 nav
  links; Admin Users' search/sort/status-filter/disable-enable-round-trip/
  role-assignment-and-revoke; Roles' Create dialog, isSystem-disabled edit
  form (genuinely disabled, typed into it and nothing was accepted), the
  two Alert messages (both correct text, though visually identical blue
  "info" styling rather than distinct — not filed as broken, a defensible
  design choice), ability-assignment-and-revoke; Abilities' Create dialog
  and delete-with-cascade-warning (verified the exact warning text matches
  what was documented); Audit Log's Previous/Next boundary correctness,
  all 4 filter-by modes, expandable rows with correctly-formatted Before/
  After JSON; Feedback's real pagination/counts badge, all 3 filters
  genuinely ANDed together (proved a 0-result combination), and the full
  triage form round-trip (status change persisted and reflected in the
  list and counts badge on return).
- All disruptive test actions were reverted (Testy Admin's disable/enable
  and role assignment/revocation, the Admin role's temporary ability
  assignment/revocation, the feedback item's status change) — the only
  genuinely new standing test data is a third disposable custom role,
  "Chrome Verify Role" (no delete endpoint exists for roles, same situation
  as the two pre-existing disposable roles — see backlog.md), and a
  Screen-5 test ability that was cleanly created and deleted within the
  same check, leaving no debt.

## Current State — Screen 7, FINAL SCREEN (2026-09-17, Feedback Triage session)

**Built and verified working end-to-end against the real local dev
backend** (a seventh and final session, after Audit Log). The founding
plan's full 7-screen list is now complete.

- **The one screen in this app whose backend genuinely matches
  `GenericServerTable`'s full server-driven mode out of the box** —
  confirmed independently, not assumed from the founding plan's own note:
  `GET /admin/feedback` has real `page`/`limit` server pagination and a
  real `total` in `meta` (via apps/api's `tableResponse()` helper, which
  puts `items`/`meta`/`extra` at the **top level of the JSON body, not
  nested under `data`** — a materially different envelope shape from
  every other endpoint in this app, confirmed by reading
  `response.util.ts` directly and via curl). `@vhyx/api-kit`'s
  `createHttpClient` default `unwrapResponse` only unwraps a `.data` key,
  so this response comes back as the *whole* envelope — matches how
  `apps/web`'s own Members/API Keys tables already handle this shape
  (`PaginatedResponse<T, TExtra>`, copied into `apps/admin/src/api/types/
  pagination.ts` since it's small, generic, and had no existing
  apps/admin equivalent).
- **A real, blocking `apps/api` bug found and fixed as a prerequisite for
  this session's own functional-verification requirement**: `GET
  /admin/feedback/:feedbackId` is gated by `adminAuthGuard` (sets
  `request.admin`), but its handler called `getUserContext(request)` — a
  helper whose own docstring says it's for routes gated by `userAuthGuard`
  (sets `request.user` instead). Every real admin token 401'd with "Not
  authenticated" on this one route, confirmed live via curl with a
  demonstrably valid, freshly-issued admin token that worked fine on the
  sibling list route in the same call. Fixed by swapping in
  `getAdminContext(request)` — the same helper every route in
  `admin.routes.ts` already uses correctly. See
  `internal-tools/api/decision.md`, 2026-09-17, for the full trail.
  Regression-tested (`tests/e2e/adminFeedbackDetailAuth.test.ts`, 2 tests
  — confirmed to genuinely fail against the pre-fix code via a
  stash/re-run/restore cycle before being trusted).
- **No sort support at all** — confirmed by reading both
  `adminListFeedbackSchema` (no `sortBy` field exists) and
  `PrismaFeedbackRepository` directly (`orderBy` is hardcoded to
  `createdAt: 'desc'` in every query method). Every column in the list is
  `enableSorting: false` — not an oversight, the first screen in this app
  with genuinely zero real sort dimensions to expose (Audit Log had none
  either, but for a different reason — no `sortBy` param and no
  server-side `orderBy` variance at all here).
- **Filters are real, server-side, and independently combinable** (not
  mutually exclusive like Audit Log's adminId/action/targetId) — `status`/
  `type`/`priority` are ANDed together in `PrismaFeedbackRepository`'s
  `where` clause, confirmed by reading it directly and empirically via
  curl (`type=FEATURE_REQUEST&status=OPEN` correctly narrowed to the
  intersection).
- **The real update payload, confirmed by reading
  `AdminUpdateFeedbackUseCase` directly and via curl**: `status`,
  `priority`, `adminNotes` — all independently optional, but the route
  requires at least one. The documented status flow in the route's own
  comment (`OPEN → UNDER_REVIEW → IN_PROGRESS → RESOLVED`, or `OPEN →
  WONT_FIX`/`CLOSED`) is **not enforced anywhere** — `updateStatus()` sets
  the new status unconditionally with no transition-graph check, confirmed
  by reading the entity directly (any status can be set from any other).
  The triage form offers every status value freely rather than implying a
  restriction the backend doesn't have.
- **A per-endpoint field-shape mismatch, the "found something on every
  screen" pattern holding again**: `GET /admin/feedback` (list) includes a
  real `user: {id, email, firstName, lastName}` object per row —
  present at runtime via `PrismaFeedbackRepository.findAll()`'s
  `include: { user: {...} }`, but **not declared anywhere in
  `FeedbackProps`'s TypeScript type** (confirmed via curl: the field is
  genuinely there in the JSON). `GET /admin/feedback/:id` (detail) has
  **no such field** — `findById()` has no `include` at all, confirmed via
  curl on the same real row immediately after the list call returned it
  with `user` present. The detail view shows the raw `userId` rather than
  assuming an enrichment that isn't actually there for that endpoint.
- **`PATCH /admin/feedback/:id`'s response is narrower than the full
  entity** — `{id, status, priority}` only, confirmed via curl; it
  **omits `adminNotes`** even though the same call updates it. The
  update mutation invalidates the detail query rather than trusting the
  response to reflect the new note.
- **A real, non-standard error envelope, found and deliberately not
  worked around**: the route's own "provide at least one field" 400 guard
  responds with `{"error": "..."}`, not this app's standard `{success,
  message, code, data, requestId}` shape used by every other error in the
  system — confirmed via curl. The UI always submits `status` +
  `priority` together with `adminNotes` on every save, which makes this
  specific 400 path structurally unreachable from this screen — documented
  in code rather than built around, since there's nothing to build around
  when the UI can't trigger it.
- **No audit logging for feedback triage** — confirmed both by reading
  `AdminUpdateFeedbackUseCase` (no `AdminAuditLog.create()` call anywhere)
  and empirically (updated a real feedback item's status/priority/notes,
  then confirmed via `GET /admin/identity/audit-logs` that no `feedback.*`
  action appeared) — unlike every other admin mutation in this app
  (Users/Roles/Abilities all write a real audit row). A real, notable gap,
  flagged in backlog.md, not fixed (a bigger backend change than a
  frontend session should make unprompted).
- **`AdminListFeedbackUseCase`'s per-status `counts` costs 4 extra DB
  round trips** (`findAll({status: X, limit: 1})` once per status, purely
  to read `.total`) — works, rendered as a small badge row in the list
  toolbar via `GenericServerTable`'s existing `extra` prop, but a real,
  minor server-side inefficiency, flagged in backlog.md, not fixed.
- **Real test data**: the local dev DB had **zero** feedback rows before
  this session (checked first, per the brief) — created two real rows via
  the actual user-facing `POST /api/v1/feedback` flow (logged in as
  `test@example.com`, the existing regular-user test account) rather than
  writing directly to the DB, then triaged both through the real admin
  update flow during verification (one moved to `UNDER_REVIEW`/`HIGH`
  with notes, one moved to `RESOLVED`/`LOW` with notes — confirmed
  `resolvedAt` was set correctly on the transition to `RESOLVED`). No
  delete endpoint exists for feedback either, so both rows remain as
  standing test data — flagged in backlog.md, same convention as Screen
  4's disposable roles.
- 4 new tests for `buildFeedbackQuery` (always sends page/limit,
  status/type/priority all sent together when present, omits an unset
  filter key rather than sending it empty, never sends search/sortBy/
  sortOrder) plus 2 new root-suite regression tests for the
  `getAdminContext` fix — `apps/admin` now 12 files/64 tests, root suite
  22 files/106 tests.
- `pnpm --filter @vhyxvoid/admin typecheck/build/test` clean;
  `pnpm turbo run typecheck/build --filter='!@vhyxvoid/web'` (10/10, 9/9,
  `apps/api`'s own typecheck included since its route file changed) and
  the root e2e suite (22/22 files, 106/106 tests) and `apps/web`'s own
  test suite (8/8 files, 28/28 tests) all pass — unaffected.
- **No browser check this session** — same batched-deferral convention.
  This is the last screen; the whole-app interactive browser-verification
  pass (backlog.md) is now the correct next step for a future session.
  Verified instead via a full curl sequence against the live backend:
  list with real pagination/filters/counts, detail (post-fix), and a
  complete triage update round-trip on two real, organically-created rows.

## Current State — Screen 6 (2026-09-17, Audit Log session)

**Built and verified working end-to-end against the real local dev
backend** (a sixth session, after Abilities). A read-only viewer over
`AdminAuditLog` — the central new finding is that this backend contract
genuinely doesn't fit the `GenericServerTable`/`TablePaginationComponent`
shape at all, not even in the "client-side pagination" adaptation Users/
Roles/Abilities used:

- **`GET /admin/identity/audit-logs`'s real contract, verified
  independently rather than assumed to match any prior screen** (every
  screen this session has built has had a genuinely different shape —
  confirmed true again here): `auditLogsQuerySchema` accepts `adminId`/
  `action`/`targetId` (all optional, **mutually exclusive** — the route
  handler branches `if (adminId) ... else if (action) ... else if
  (targetId) ... else findAll()`, confirmed by reading `admin.routes.ts`
  directly) plus real `limit`/`offset` (capped at 100, default 50).
- **No total/count field exists anywhere in the response** — confirmed
  two ways: reading `AdminAuditLogRepository` directly (no `countAll()`
  method exists at all; the three count-by-X methods it *does* have —
  `countByAdminId`/`countByAction`/`countByTargetId` — are never called by
  the route handler, dead code) and via a real curl call (`{success,
  message, data}` only, no `total`/`meta`/`count` key). This is a
  materially different gap from Roles/Abilities/Users: those have no
  server pagination at all but a small enough dataset to fetch everything
  and paginate client-side; Audit Log has real server-side `limit`/
  `offset` (so client-side "fetch everything" isn't viable or intended —
  the log is meant to grow unboundedly) but genuinely no way to know how
  many total rows exist.
- **`TablePaginationComponent` requires a real `total` to compute
  `pageCount`/render "Showing X to Y of Z entries"** (confirmed by reading
  it directly) and `GenericServerTable`'s own "Total: N" badge is
  unconditional, not gated by `enablePagination`. Fabricating a `total`
  to satisfy either would misrepresent what the backend can actually tell
  the UI. **Decision: this screen does not use `GenericServerTable` at
  all** — a purpose-built view reusing the same visual primitives (`Card`,
  `table.module.css`, `TableSkeleton`, `Typography`) but with its own
  minimal chrome: no "Total" badge, a plain Previous/Next pager instead of
  page-number pagination. "Is there a next page" is derived honestly by
  requesting `limit + 1` rows per page and slicing off the extra one
  (`sliceAuditLogPage`, its own directly-tested pure function) — verified
  against the real 28-row dataset Screens 3-5's own actions had already
  generated: page 1 (offset 0, limit 11) returns 11 rows → `hasNextPage`
  true; page 3 (offset 20, limit 11) returns 8 → `hasNextPage` false,
  confirmed via curl before trusting the logic.
- **Filter UI**: a single "filter by" control (None / By admin / By
  action / By target ID) matching the backend's own mutual-exclusivity
  exactly, rather than a combinable multi-filter form the backend can't
  do. "By admin" is a `Select` populated from the existing, already-wired
  `useAdminUsers()` hook (no status filter → every admin, active or
  disabled) rather than a raw UUID paste — reused, not rebuilt. "By
  action" and "By target ID" are plain text inputs (no fixed enum/picker
  built for `action`, since the schema accepts any string and hardcoding
  the backend's `AuditAction` enum client-side would be a permanent,
  unnecessary duplication for a filter box).
- **Each row's `adminId` resolves to a real email** via a client-side map
  built from the same `useAdminUsers()` call (verified against the real
  local dev backend: both real audit rows' `adminId` matched
  `admin@company.local`'s id exactly). `targetId`/`targetType` are shown
  as-is (truncated UUID + type badge) — no attempt to resolve a
  human-readable target name, since `targetType` varies across five
  different entity kinds and per-type resolution would be disproportionate
  for this screen.
- **Expandable rows**, not a separate detail page** — judged directly
  from real data, per the brief's instruction not to assume a detail page
  is needed: entries are small enough (a handful of fields plus two
  optional nested objects) that an inline expand is strictly simpler than
  a route, and real entries confirmed both `changes` and `metadata` are
  genuinely nullable independent of each other (e.g. `ability.deleted`
  has real `metadata` — ip/userAgent/statusCode — but `changes: null`;
  `role.created` has real `changes` but `metadata: null` — a real,
  pre-existing backend inconsistency in which routes bother to capture
  request metadata, not something this read-only screen can or should
  fix). `changes.before`/`changes.after` are **full entity snapshots, not
  a field-level diff** — confirmed via a real `role.updated` entry — so
  the detail panel renders each side as formatted JSON rather than
  computing a synthetic diff view (proportionate effort for a viewer
  screen).
- **`getActionDescription()`'s fallback confirmed live, not just read**:
  a real `admin.token_refreshed` entry (not in the entity's internal
  action→label map) came back with `actionDescription` equal to the raw
  action string itself — the entity's own documented fallback behavior,
  rendered as-is with no client-side re-formatting.
- 10 new tests: 6 for `buildAuditLogQuery` (no-filter/admin/action/target
  branches, offset math, empty-value-treated-as-no-filter) and 4 for
  `sliceAuditLogPage` (exact-limit/over-by-one/under-limit/zero-rows
  cases) — `apps/admin` now 11 files/60 tests.
- `pnpm --filter @vhyxvoid/admin typecheck/build/test` clean;
  `pnpm turbo run typecheck/build --filter='!@vhyxvoid/web'` (10/10, 9/9)
  and the root e2e suite (21/21 files, 104/104 tests, unchanged — no
  `apps/api` changes were needed this session) and `apps/web`'s own test
  suite (8/8 files, 28/28 tests) all pass — unaffected. (One flaky,
  unrelated timing test in `tests/e2e/subdomainRegistryRace.test.ts`
  failed on a single full-suite run and passed clean both in isolation
  and on a full-suite re-run — a pre-existing timing sensitivity, not a
  regression from this session's changes.)
- **No browser check this session** — same batched-deferral convention,
  still deferred until every screen is built. Verified instead via a full
  curl sequence against the live backend proving the exact pagination
  math (11/11/8 rows across three pages of a real 28-row dataset),
  filter-by-action and filter-by-adminId both narrowing results correctly,
  and the admin-email join resolving against real data.

## Current State — Screen 5 (2026-09-17, Admin Abilities session)

**Built and verified working end-to-end against the real local dev
backend** (a fifth session, after Roles) — extended the `admin-ability.*`
scaffold Screen 4 created (read-only, for Roles' "add an ability" dropdown)
rather than redefining it:

- **Admin Abilities list** (`/abilities`): `useAdminAbilitiesTableList` +
  a new `paginateAdminAbilities` pure client-side function — confirmed
  `GET /admin/identity/abilities` has **zero real server params at all**
  (no `listAbilitiesSchema` exists, `isActive: true` hardcoded
  server-side, confirmed both by reading `admin.routes.ts` directly and
  empirically via curl with `?page=1&limit=1&isActive=false` still
  returning all 23 rows) — same shape as Roles, not Users' hybrid.
  Sortable columns: action, category, isSystem (custom vs system badge).
- **Create Ability form** (`CreateAbilityDialog`, a `Dialog` + RHF + yup
  form matching the `CreateRoleDialog` template): `createAbilitySchema` is
  `action`/`category` (both required) + `description` (optional) — no
  password/security complexity, judged in-scope same as Create Role.
  Confirmed via curl: `POST /abilities` → 201, response shape
  `{id, action, category}` — narrower than `AdminAbilitySummary` (omits
  `description`/`isSystem`/`isActive`), same pattern as
  `adminRoleService.create()`'s narrow return type; a duplicate
  `category`+`action` pair correctly rejects with a real 409 `CONFLICT`
  ("Ability already exists"), confirmed via curl (`CreateAbilityUseCase`'s
  own `findByAction()` pre-check).
- **Delete action, with accurate confirm messaging — the brief's central
  question, resolved concretely, not assumed:**
  - `DELETE /abilities/:id` is a **real hard delete**
    (`PrismaAdminAbilityRepository.delete()` → a genuine
    `prisma.adminAbility.delete()`), not a soft deactivate — confirmed by
    reading the repository directly. `AdminAbility.canBeDeleted()` is just
    `!isSystem`; a system-ability delete attempt correctly rejects with a
    real, empirically-confirmed **400 `VALIDATION_ERROR`** ("System
    abilities cannot be deleted") — note this is a `ValidationError`
    (400), not a `ConflictError` (409) the way `AdminRole.update()`'s
    `isSystem` guard is — confirmed via curl, not assumed to match Roles'
    error code.
  - **No guard at all against deleting an ability currently assigned to a
    role.** `AdminRoleAbility.ability` is `onDelete: Cascade`
    (`schema.prisma`) — confirmed by reading the schema directly, then
    proven empirically end-to-end: created a disposable custom ability,
    assigned it to the "Support Agent" role (204), confirmed it appeared
    in that role's ability list, deleted the ability (204, no rejection,
    no warning), then confirmed via a follow-up `GET` that it silently
    disappeared from the role's ability list — a real, live cascade, not
    inferred from the schema alone. **The delete confirmation dialog
    states this explicitly** ("This permanently deletes the ability and
    removes it from every role it's currently assigned to") rather than
    implying an isolated, safe delete the backend doesn't actually
    provide.
  - Delete row action is disabled (matching the real 400 guard) for
    `isSystem` abilities.
- **No detail/edit page built** — confirmed no `PUT /abilities/:id`
  exists (re-confirmed this session, matching the founding plan's
  correction); nothing in the list needs a drill-down view the columns
  don't already show, so Abilities is list + create + delete only, no
  `/abilities/[id]` route.
- Extended, not redefined, the Screen-4-era `admin-ability.*` files:
  `admin-ability.types.ts` (fixed the same latent `description?: string` →
  `string | null` type bug `AdminRoleSummary` had before the Screen 4 fix,
  added `AdminAbilityCreateResponse`), `.endpoints.ts` (added
  `CREATE`/`DELETE`), `.service.ts` (added `create`/`remove`),
  `useAdminAbilities.ts` (added `useAdminAbilitiesTableList`,
  `useCreateAbility`, `useDeleteAbility`, all invalidating via the
  existing `adminAbilityKeys.all`).
- **Test data left clean** — unlike Roles' two disposable custom roles
  (which have no delete endpoint and remain as standing DB rows, see
  backlog.md), the disposable ability created for this session's delete/
  cascade verification was itself deleted as part of that same
  verification — no cleanup debt left behind.
- 8 new tests: 7 for `paginateAdminAbilities` (mirroring
  `paginateAdminRoles`'s test shape — search across action/category/
  description, sort by action/category/isSystem, pagination, unrecognized-
  sortBy fallback), 1 for `adminAbilityKeys` (`all` invalidates `list()`,
  matching the established convention from the Users/Roles key tests,
  narrower here since abilities has no `detail()` consumer) — `apps/admin`
  now 10 files/50 tests.
- `pnpm --filter @vhyxvoid/admin typecheck/build/test` clean;
  `pnpm turbo run typecheck/build --filter='!@vhyxvoid/web'` (10/10, 9/9)
  and the root e2e suite (21/21 files, 104/104 tests, unchanged — no
  `apps/api` changes were needed this session) and `apps/web`'s own test
  suite (8/8 files, 28/28 tests) all pass — unaffected.
- **No browser check this session** — same batched-deferral convention as
  Screen 4 (Tanveer's explicit direction), still deferred until every
  screen is built. Verified instead via full curl-against-live-backend
  discipline: list (with and without ignored query params), create,
  duplicate-conflict, delete-of-system-ability-rejected, and the full
  assign→confirm→delete→confirm-cascade sequence above.

## Current State — Screen 4 (2026-09-17, Admin Roles session)

**Built and verified working end-to-end against the real local dev
backend** (a fourth session, after Screen 3/Admin Users), following the
same "verify independently, don't assume Users' patterns transfer"
discipline the brief required:

- **Admin Roles list** (`/roles`): `useAdminRolesTableList` +
  `paginateAdminRoles`, a new pure client-side search/sort/pagination
  function — **not** a copy of Users' hybrid `paginateAdminUsers`
  (server `status` param + client rest), because `GET /admin/identity/
  roles` was independently confirmed to have **zero real server params at
  all** (no `listRolesSchema` exists — `isActive: true` is hardcoded
  server-side). Closer to the Invitations precedent than to Users' shape.
  Sortable columns: name, isSystem (custom vs system badge).
- **Admin Role detail + edit + ability assignment** (`/roles/[id]`):
  - Edit form (name/description) is **disabled entirely for `isSystem`
    roles**, with an explanatory `Alert` — `AdminRole.entities.ts`'s
    `update()` really does call `validateNotSystem()` and reject with a
    real 409 `CONFLICT` ("System roles cannot be modified"), confirmed
    both by reading the entity directly and empirically via curl (editing
    the seeded "Operator" role → real 409; editing a custom test role →
    real 200). This directly resolves the brief's question #2.
  - Ability-assignment sub-view: current abilities as revocable badges
    (`Confirmation`, matching Users' role-revoke pattern) plus a single
    VhyxUI `Select` "add an ability" dropdown — **not** a multi-select.
    `AssignAbilityToRoleUseCase`/`RevokeAbilityFromRoleUseCase` were read
    directly (not assumed from Users' role-assignment conclusion) and
    confirmed to take exactly one `abilityId` per call. This directly
    resolves the brief's question #1.
  - **Asymmetric finding, not explicitly asked but load-bearing for the
    UI**: unlike `update()`, ability assignment/revocation has **no
    isSystem guard at all** — confirmed by reading both use cases (no
    `validateNotSystem()` call) and empirically via curl (assigned then
    revoked an ability on the seeded "Operator" system role, both real
    204s, no rejection). The ability-assignment sub-view stays enabled for
    system roles, with a cautionary `Alert` distinguishing this from the
    blocked edit form just above it — the UI would otherwise be lying
    about what the backend actually allows.
- **Create Role form built this session** (`CreateRoleDialog`, a `Dialog`
  + RHF + yup form matching `apps/web`'s `CreateApiKeyDialog` template) —
  judged in-scope, unlike Users' deferred "Create Admin": `createRoleSchema`
  is two plain fields (`name` required, `description` optional), no
  password/security complexity, confirmed via curl (`POST /roles` → 201,
  response shape `{id, name, description}` — narrower than
  `AdminRoleSummary`, service typed accordingly rather than lying about
  `isSystem`/`isActive` being present).
- **No delete/deactivate action anywhere in the UI** — confirmed via grep
  that despite `AdminRole.entities.ts` having `deactivate()`/`activate()`/
  `canBeDeleted()` and `deactivateRoleUseCase` being decorated on the
  fastify instance, **no HTTP route calls any of them**. Roles only
  supports list/detail/create/update + ability assignment at the API
  level today.
- New `admin-ability.*` scaffold (`admin-ability.types.ts`,
  `.endpoints.ts`, `.service.ts`, `admin-ability.keys.ts`,
  `useAdminAbilitiesList`) — minimal, read-only, mirrors how
  `admin-role.*` was originally scaffolded read-only-only to support
  Users' role-assignment sub-view. Exists now only to back Roles'
  "add an ability" dropdown; a real Screen 5 (Abilities: create/delete)
  should reuse these files rather than redefining them.
- A role's assigned-abilities sub-resource doesn't fit
  `createQueryKeys`'s `{list, detail}` shape (it's nested under one role,
  not its own top-level collection) — used a hand-built
  `['admin-role-abilities', roleId]` key, same convention as `apps/web`'s
  `useOrg.ts` (`['invitations', accountId]`) for the equivalent case,
  rather than inventing a `.concat()`-based extension to the factory.
- Fixed a latent type bug in the pre-existing `AdminRoleSummary` (added
  during the Screen 3 session to support Users' role dropdown, never
  itself verified): `description?: string` → `description: string | null`
  — the real entity (`AdminRoleProps.description`) is `string | null`, and
  the route handler passes it through with no coercion. Also added
  `AdminRoleDetail` (adds `createdAt`/`updatedAt`, confirmed via curl) and
  `AdminRoleAbility`.
- 9 new tests: 6 for `paginateAdminRoles` (mirroring `paginateAdminUsers`'s
  test shape, minus the server-param split), 3 for `adminRoleKeys`
  disjointness/precision (list↔detail, all→detail prefix-match) — `apps/
  admin` now 8 files/42 tests.
- `pnpm --filter @vhyxvoid/admin typecheck/build/test` clean;
  `@vhyxvoid/web`/`@vhyxvoid/api`/`@vhyxvoid/hub` typecheck clean, root
  e2e suite (21/21 files, 104/104 tests) and `apps/web` test suite (8/8
  files, 28/28 tests) all still pass — unaffected.
- **No browser check this session** — per explicit direction, visual
  verification for `apps/admin` is deliberately batched to happen once,
  covering the whole app, after all screens are built (not a per-session
  gap the way it was flagged in Screens 1-3's sessions). Verified instead
  via the same curl-against-live-backend discipline as every prior
  session: every endpoint the UI calls (list, detail, create, update on
  both a system and a custom role, assign/revoke ability on both) was
  exercised directly and its response shape confirmed to match the
  TypeScript types before/after wiring the screen to it.

## Current State — Screen 3 (2026-09-17, Admin Users session)

**Built and verified working end-to-end against the real local dev
backend** (a third session, after scaffolding+login and the dashboard
shell):
- **Admin Users list** (`/admin-users`): real data via
  `useAdminUsersTableList`, the copied `GenericServerTable`/
  `useServerTable` wired up for real for the first time — confirms Part
  3.4's "copy now, extract later if it proves out" decision actually
  proved out, no changes needed to any of the ~13 copied files themselves.
  Sortable columns (name, email, status, last login) verified against the
  real backend contract first, per the brief's explicit instruction — see
  the sort-support finding below. Status filter (Active/Disabled) is the
  one genuine server-side param `GET /admin/identity/users` supports
  (confirmed by reading `listAdminsSchema` directly); search/sort/
  pagination are client-side over the resulting batch, extracted into a
  pure, directly-tested function (`paginateAdminUsers`) rather than left
  inline in the hook.
- **Admin User detail + role assignment** (`/admin-users/[id]`): identity
  fields, current roles (each individually revocable via `Confirmation`),
  and an "add a role" flow using a **plain VhyxUI `Select`, not a
  multi-select** — see the MultiSelectCombobox finding below, this was a
  real, concrete resolution of Part 1.3's open question, not a deferral.
- Row actions: view detail (navigate), disable/enable (`Confirmation`,
  matching the established pattern) — both hidden/disabled for the
  currently-logged-in admin's own row and for super admins, matching real
  backend guards (`AdminUser.disable()` throws for a super admin;
  self-disable would lock the session out, an added UI-level safeguard
  the backend doesn't itself provide).
- **Two real, previously-undiscovered `apps/api` bugs found and fixed**
  (found while building the detail view, not anticipated by the founding
  plan): `GET /admin/identity/users/:id` and `POST /admin/identity/users/:id/disable`
  both destructured `adminId` from `request.params`, but the route itself
  registers a `:id` placeholder — Fastify populates `request.params.id`,
  never `.adminId`, so both always operated on `undefined`. `GET` threw a
  raw 500 (`PrismaClientValidationError`); `disable` threw a 404
  regardless of a valid target. Confirmed via real curl against the live
  backend before fixing, same discipline as the scaffolding session's
  `fastify.jwtService`/`fastify.uow` find. Fixed with a two-line change
  each. See `internal-tools/api/context.md`/`decision.md`, 2026-09-17.
- **MultiSelectCombobox — confirmed NOT needed, resolving Part 1.3's open
  question concretely.** The founding plan speculated a multi-select shim
  would be needed "whenever Admin Users or Roles is built." Reading
  `AssignRoleToAdminUseCase`/`RevokeRoleFromAdminUseCase` directly found
  both operate on exactly one role per call (`assignRoleSchema` is
  `{roleId, reason?}`, singular) — the real API has no bulk-assign
  surface at all. A plain single-select `Select` (already in VhyxUI, no
  shim needed) for "add one role" plus individually-revocable role badges
  is the correct, honest UI for what the backend actually supports. Same
  conclusion almost certainly applies to Roles' ability-assignment
  sub-view (`assignAbilitySchema` is also singular, `{abilityId}`) — worth
  confirming directly when that screen is built, not assumed from this
  entry alone, but there's no reason to expect otherwise.
- **Disjoint-query-key staleness bug — checked from the start, confirmed
  structurally absent, not just assumed.** `apps/admin`'s copy of
  `GenericServerTable` is already the post-Phase-2, props-based version
  (no internal `useQuery` of its own), so the original bug class
  (`internal-tools/user-frontend/context.md` item 34) cannot recur by
  construction. Verified anyway, per the brief's explicit instruction not
  to assume immunity: a real `QueryClient`-based test proves
  `adminUserKeys.all` invalidation actually reaches every
  `adminUserKeys.list({status})` variant.
- **Standing test data added**: a second admin account,
  `test-admin@company.local` / `TestAdmin@12345` (non-super-admin, created
  via a real `POST /admin/identity/users` call, not a UI form — see the
  "Create Admin form" scope note below), needed to safely test disable/
  enable/role-assignment without touching the only login. Kept as
  standing infrastructure, same convention as `LOCAL_DEV_BACKEND.md`'s
  regular-user test accounts — see that file's own update.
- **"Create Admin" form and "Edit profile" form deliberately NOT built
  this session** — out of the brief's actual scope (list + sort + row
  actions + role-assignment sub-view, per Part 1.3's own framing), and
  the real test admin needed for functional testing was created via a
  direct API call instead (matching this project's established "seed via
  direct call/SQL, don't necessarily build UI just to enable testing"
  precedent — see `LOCAL_DEV_BACKEND.md`'s own history). Flagged in
  backlog.md as a real, deferred gap — `useCreateAdmin()` mutation hook
  already exists (wired to the real endpoint, invalidates correctly) for
  whenever the form is built.
- 15 new tests: 10 for `paginateAdminUsers` (search/sort/pagination
  correctness, including the "unrecognized sortBy falls back to email,
  not a silent no-op" edge case), 3 for the query-key disjointness proof,
  2 in the root suite for the route-param regression (registers the real
  `admin.routes.ts` plugin against a fake `FastifyInstance`, invokes the
  fixed handlers directly, asserts `findById` receives the real id) —
  `apps/admin` now 6 files/33 tests, root suite 21 files/104 tests.
- `pnpm --filter @vhyxvoid/admin typecheck/build/test` clean; full
  monorepo `pnpm turbo run typecheck/build --filter='!@vhyxvoid/web'`
  (10/10, 9/9) and the root e2e suite (21/21 files, 104/104 tests) all
  pass — `apps/web`/`apps/hub` unaffected.
- **No Chrome extension available this session either** (checked first,
  per the brief's explicit instruction to prioritize it if available) —
  same curl/real-backend + SSR/bundle-inspection approach as the
  scaffolding session: both new routes (`/admin-users`, `/admin-users/[id]`)
  return clean 200s with no server exceptions, and the compiled client
  bundle contains the real endpoint paths (`admin/identity/users`,
  `admin/identity/roles`). A real interactive click-through (typing a
  search term, clicking a sort header, confirming a disable dialog in an
  actual browser) is still unverified — flagged in backlog.md, now a
  three-session-running gap.

## Current State (2026-09-17, build session)

**Built and verified working end-to-end against the real local dev
backend:**
- Full scaffold: `apps/admin` (`@vhyxvoid/admin`), port 4001, excluded
  from the root `tsconfig.json` project-reference graph and root ESLint
  config (matches `apps/web`'s precedent exactly), own `vitest.config.ts`.
  `@vhyxui/react`/`@vhyxui/tokens`/`@vhyx/api-kit` all linked via the
  established sibling-repo `link:` convention and resolve correctly
  (verified real symlinks in `node_modules/@vhyxui/`, `node_modules/@vhyx/`
  after `pnpm install`).
- The real ~13-file `GenericServerTable`/`useServerTable`/`RowAction`/
  `Confirmation` dependency set copied verbatim from `apps/web` (Part 3.4's
  table, below) — with one correction found only once the copy was
  actually typechecked: `hooks/useFeedbackDialog.ts` had a trailing, dead
  `export type {...} from '@/api/domain/feedback/feedback.types'` line
  that Part 3.4's import-graph trace hadn't caught (it's syntactically an
  import edge, but genuinely unused — confirmed by grep in `apps/web`
  itself: nothing imports those three names from this module, only the
  file's own locally-defined `FeedbackType`). Deleted in the copy; not
  touched in `apps/web` (out of scope, but worth knowing it's there).
- Real admin login (Screen 1): RHF + yup + VhyxUI `Form`/`TextField`/
  `Button`, same template pattern as `apps/web`'s `Login.tsx`
  (`untypedForm` cast, `void form.formState.errors`), wired to the real
  `POST /admin/identity/auth/login` endpoint.
- Real auth wiring (Part 2 of the brief): `@vhyx/api-kit`'s
  `createHttpClient` confirmed to fit apps/admin's genuinely different,
  cookie-free auth model cleanly via its existing `getAuthHeaders`/
  `onUnauthorized` injection points — no gap found, nothing needed to
  reach past what the package already exposes (see decision.md for the
  detail Part 3.3 asked to confirm). Token storage: a Zustand store
  persisted to `sessionStorage` (matching `apps/web`'s own established
  choice for its persisted auth slice — see Part 3.3 below), holding
  *both* tokens (unlike `apps/web`, which keeps the access token
  memory-only and leans on an httpOnly cookie for the refresh token — no
  such cookie exists here).
- Minimal dashboard shell (Screen 2): top nav linking to all 7 screens, a
  working logout button, and a real `GET /admin/identity/me` call proving
  the Bearer-token wiring end-to-end.
- Stub pages for Screens 3-7 (Admin Users, Roles, Abilities, Audit Log,
  Feedback Triage) — routing structure only, per Part 1.5's explicit
  "stub pages are fine for now."
- 20 real tests (auth store behavior, and — genuinely new coverage
  `apps/web`'s own equivalent `http.ts` never had, confirmed by grep —
  `http.ts`'s `getAuthHeaders`/`onUnauthorized` refresh-queue/token-
  rotation/hard-logout logic, plus the 9 copied table tests unchanged).
- `pnpm --filter @vhyxvoid/admin typecheck/build/test` all clean; full
  monorepo `pnpm turbo run typecheck/build --filter='!@vhyxvoid/web'`
  (10/10, 9/9) and the root e2e suite (19/19 files, 99/99 tests) all still
  pass — `apps/web`/`apps/api`/`apps/hub`/`packages/*` unaffected.
- **Real, live login → authenticated-request → refresh → logout → post-
  logout-rejection flow verified via curl against the real local dev
  backend** (seeded via `pnpm seed`), matching this app's TypeScript types
  byte-for-byte. See "Two real apps/api bugs found and fixed" below —
  this verification pass is what found them.

**Two real, previously-undiscovered `apps/api` bugs found and fixed as a
blocking prerequisite** (not `apps/admin`-owned code — see
`internal-tools/api/context.md` item 49 and `internal-tools/api/decision.md`,
2026-09-17, for the full record; summarized here because they directly
gate everything above): `fastify.jwtService` and `fastify.uow` were both
declared in `fastify.d.ts` and read directly by `adminAuthGuard`/most of
`admin.routes.ts`, but neither was ever actually decorated anywhere in the
codebase. Every `adminAuthGuard`-gated request 403'd and every
`fastify.uow`-touching admin route 500'd — meaning **the Admin RBAC
backend was NOT actually functional beyond login/refresh** despite being
structurally complete and despite the prior scoping session's Part 1
correctly confirming the routes exist and are wired to real guards (route-
reading alone couldn't have caught this — it took an actual login +
authenticated request to surface it). Fixed with two lines in
`core.plugin.ts`. This is the reason Part 3's functional-verification
requirement took real investigation rather than being a quick confirmation
pass.

**Real, previously-unknown finding about VhyxUI's `VhyxUIProvider`:** it
throws a fatal (if non-blocking-to-render) `VhyxSealError` — "Manifest
generation failed: domain must be a non-empty string" — when its `domain`
prop and the `NEXT_PUBLIC_VHYX_DOMAIN` env var are both unset. This
directly validates the *concern* behind `apps/web`'s original decision to
use the narrower `ToastProvider`-only wrapper instead of the full
`VhyxUIProvider` (`internal-tools/user-frontend/decision.md`, 2026-09-10)
— though the specific problem turned out to be a missing required prop,
not general "unverified behavior" risk. Fixed by setting
`NEXT_PUBLIC_VHYX_DOMAIN=admin.vhyxvoid.com` in `apps/admin/.env` — kept
the full `VhyxUIProvider` (skip-link + SealProvider + Toast) rather than
retreating to the narrower wrapper, since the actual blocker is now
addressed and a fresh app has no reason to withhold VhyxUI's canonical
top-level API once it works.

**Server/Client boundary bug hit again, same class as `apps/web`'s
documented history:** the 5 stub screen pages (Server Components by
default) imported `Card` from `@vhyxui/react` directly and broke the
production build identically to the bug `internal-tools/user-frontend/
decision.md`'s Phase 1 entry already diagnosed and fixed once in
`apps/web` (`'use client'` needed on any file importing `@vhyxui/react`
directly, not just an implicit boundary). This plan (Part 3, below) didn't
call this out explicitly for the stub pages, since it hadn't anticipated
they'd hit the same bug — fixed by adding `'use client'` to all 5.

**No browser-based interactive verification this session** — no Chrome
extension available (matching the pattern noted throughout
`apps/web`'s own history). Verified instead via: (1) the real curl-based
API contract test above, (2) `apps/admin`'s own real test suite (20
tests), and (3) confirming the real SSR HTML of `/login` renders the
correct form (email/password fields, submit button with VhyxSeal's
agent-contract metadata attached, proving `SealProvider` initialized
without error post-fix) and that the compiled client bundle has the
correct API base URL inlined. Full click-through (typing credentials,
submitting, observing the dashboard render, clicking logout) is unverified
— flagged in backlog.md.

## Why this app doesn't exist yet

`apps/api`'s Admin RBAC system (`AdminUser`/`AdminRole`/`AdminAbility`/
`AdminSession`, immutable `AdminAuditLog`) has been fully built and
functional since before the VhyxUI migration started — see
`internal-tools/api/context.md` and `internal-tools/user-frontend/context.md`'s
Missing Features section. `apps/web`'s own `views/admin/` directory
(6 files) was 100%-commented-out mock scaffolding, never wired to a route,
and was deleted 2026-09-14 as dead code. No real frontend work has ever
been done against this backend. This session is the first to investigate
it end-to-end for the purpose of scoping a real, separate app.

## Part 1 — Backend verification (read route files directly, not just the prior summary)

Confirmed real and complete by reading
`apps/api/src/modules/identity/presentation/http/admin/admin.routes.ts`
and `apps/api/src/modules/feedback/presentation/http/feedback.routes.ts`
directly. Prefix: `adminRoutes` is registered at `/api/v1/admin/identity`
(`identity/presentation/http/index.ts`); `adminFeedbackRoutes` at
`/api/v1/admin/feedback` (separate registration, same file).

**Auth:**
- `POST /api/v1/admin/identity/auth/login` — email+password → `{accessToken, refreshToken, expiresIn, admin}`. Real bcrypt compare, real `AdminSession` row written, real `AdminAuditLog` entry (`admin.login`).
- `POST /api/v1/admin/identity/auth/refresh` — refresh token → new access token.
- `POST /api/v1/admin/identity/auth/logout` — revokes the `AdminSession` row by token hash, audit-logged.
- `GET /api/v1/admin/identity/me`, `GET /api/v1/admin/identity/me/abilities` — current admin identity + effective ability list (both just `adminAuthGuard`-gated, no specific ability required).

**Admin user management** (`admin.create`/`admin.read`/`admin.update`/`admin.disable`/`admin.enable` abilities):
- `POST /users` (create), `GET /users` (list — **no page/limit/sort params, only an optional `status` filter**; returns everything matching), `GET /users/:id`, `PUT /users/:id` (firstName/lastName only — **no email or password field**), `POST /users/:id/disable`, `POST /users/:id/enable`.

**Role management** (`role.create`/`role.read`/`role.update`/`role.assign`):
- `POST /roles`, `GET /roles` (list — **hardcoded server-side `isActive: true` filter, no page/limit/sort/search at all**), `GET /roles/:id`, `PUT /roles/:id`.
- `POST /users/:adminId/roles` (assign), `DELETE /users/:adminId/roles/:roleId` (revoke).

**Ability management** (`ability.create`/`ability.read`/`ability.delete`, plus `role.update` for role↔ability edges):
- `GET /abilities` (list — same shape as roles: hardcoded `isActive: true`, no pagination), `POST /abilities` (create). **No `PUT /abilities/:id` exists — abilities can be created and deleted, never edited.** The brief's assumed "abilities list (+ create/edit)" screen is wrong on this point; it's create + delete, not edit.
- `POST /roles/:roleId/abilities` (assign to role), `DELETE /roles/:roleId/abilities/:abilityId` (revoke from role), `GET /roles/:roleId/abilities` (list a role's abilities).

**Audit log:**
- `GET /audit-logs` — filterable by exactly one of `adminId`/`action`/`targetId` (not combinable), `limit`/`offset` pagination (no search, no sort). Every mutating route above writes an immutable row here (before/after diff where applicable, ip/userAgent/statusCode metadata).

**New finding, not in the prior summary — a second real admin-gated surface exists:**
`apps/api/src/modules/feedback/presentation/http/feedback.routes.ts`'s
`adminFeedbackRoutes` (registered at `/api/v1/admin/feedback`, gated by
plain `adminAuthGuard` — no `requireAbility` check, any admin can use it):
- `GET /` — list all users' feedback, filterable by status/type/priority, paginated (`page`/`limit`/`total`), and returns per-status `counts` "for the admin dashboard sidebar" (the route's own comment). This is real, working, server-paginated list infrastructure — better-shaped for `GenericServerTable` than the identity-module's own list endpoints.
- `GET /:feedbackId` — full detail including `adminNotes`.
- `PATCH /:feedbackId` — update `status`/`priority`/`adminNotes`. Documented status flow: `OPEN → UNDER_REVIEW → IN_PROGRESS → RESOLVED`, or `OPEN → WONT_FIX`/`CLOSED`.

This means a **Feedback triage screen** is a real, backend-ready 7th
screen the brief's proposed list didn't anticipate — see Part 3 below.

**Super admin bypasses every `requireAbility` check.** Read
`requireAbility.plugin.ts` directly: `if (request.admin.isSuperAdmin) return;`
— a super admin never calls `verifyAdminAbilityUseCase` at all, regardless
of whether any `AdminRole`/`AdminAbility` rows exist. `requireSuperAdmin`
(a separate, stricter guard) exists but is used by zero routes today.

### A real way to log in as admin today

`apps/api/src/modules/identity/infrastructure/scripts/seed-super-admin.ts`
(wired as `pnpm seed:admin`, or `pnpm seed`/`pnpm db:seed` alongside
`seed:abilities`/`seed:roles`) creates one super admin:
`admin@company.local` / `Admin@12345678`. Because super admin bypasses all
ability checks, this alone is enough to exercise every route above without
seeding any `AdminRole`/`AdminAbility` rows first.

**Checked against the standing local dev Postgres** (`Black-server`, see
`internal-tools/shared/context.md`'s Configuration table and
`LOCAL_DEV_BACKEND.md`): `AdminUser`/`AdminRole`/`AdminAbility` are all
**currently empty (0 rows)** in that database — the seed script has never
been run there. For the next session's functional testing, run
`DATABASE_URL="postgresql://tanveer:8657212134@localhost:5432/Black-server" pnpm seed:admin`
(or the full `pnpm seed` to also get real role/ability rows for role/ability
CRUD screens to render non-empty lists) from `apps/api` — same env-override
convention as starting the dev server, never editing `.env`.

**Done, in the 2026-09-17 build session**: ran `pnpm seed` (all three:
`seed:abilities` → 23 abilities, `seed:roles` → 4 roles, `seed:admin` → one
super admin) against the local dev Postgres — this is now standing seeded
data there, same "persists across sessions" convention as the rest of
`LOCAL_DEV_BACKEND.md`'s test accounts. Real credentials confirmed working
end-to-end: `admin@company.local` / `Admin@12345678`.

**Real, unfixed gap found while checking this:** there is no admin
password-reset/change endpoint anywhere (`updateAdminSchema` only accepts
`firstName`/`lastName`; grepped the whole admin module for `password` —
zero other hits). The seed script's own console output says "run:
`npm run reset-admin-password`" — **that script does not exist** in
`apps/api/package.json`. Not blocking for this session's plan (an admin
frontend doesn't need to build UI for an endpoint that doesn't exist), but
worth a mention if the backend is ever revisited. See backlog.md.

### A real, cross-cutting factual correction found in this session

`internal-tools/shared/context.md`'s Configuration & Environment table
previously stated `PRIVATE_KEY`/`PUBLIC_KEY` (RS256 asymmetric JWT) were
"confirmed unused... leftover from an abandoned plan... safe to delete,"
and that `JWT_SECRET`/`@fastify/jwt` (HS256) was "what's actually live."
**This is backwards.** Reading `AdminLogin.usecase.ts` while verifying
Part 1 found it constructs and signs with `RS256JwtService` directly — and
tracing further (`core.plugin.ts`, `userAuthGuard.ts`, `Login.usecase.ts`,
`RefreshSession.usecase.ts`) found `RS256JwtService` (reading
`PRIVATE_KEY`/`PUBLIC_KEY` or their `_B64` prod variants via
`resolveRsaKey()`) is the **real, live** signer/verifier for **both** the
regular-user auth path (`userAuthGuard`, `Login`/`RefreshSession` use
cases) and the admin auth path — not a dead leftover. `@fastify/jwt`
(`JWT_SECRET`) **is** registered (`register.plugin.ts`) but its only
consumer, `core/middleware/auth.middleware.ts`'s `authenticate`, is
already-documented dead code (zero importers — see
`internal-tools/user-frontend/context.md` item 42's note on this same
file). So `JWT_SECRET` is registered but functionally inert, and
`PRIVATE_KEY`/`PUBLIC_KEY` are load-bearing for every login on the whole
system, admin included. Corrected in place in
`internal-tools/shared/context.md`'s Configuration table and
`internal-tools/api/context.md` item 29; full investigation trail in
`internal-tools/api/decision.md`, 2026-09-17.

**Concrete consequence for this app's auth wiring (Part 3.3 below):** the
admin app will be verifying/receiving tokens signed by the *same* RS256
key pair the regular-user app uses, even though the two auth systems
(`AdminSession` vs the user session model) are otherwise fully separate —
same signing mechanism, different token `type` field (`"admin"` vs
implicit user), different guards (`adminAuthGuard` vs `userAuthGuard`),
different DB tables, and critically, **different token-delivery shape**:
regular-user login sets the refresh token as an httpOnly cookie
(`identity.routes.ts`, "Store refreshToken in httpOnly cookie"); admin
login returns *both* `accessToken` and `refreshToken` directly in the JSON
response body — no cookie involved anywhere in the admin auth path
(grepped `admin.routes.ts` and every admin use-case file for
`cookie`/`Cookie`: zero hits). The admin app cannot reuse `apps/web`'s
cookie-based refresh-token httpClient interceptor as-is; it needs its own
token-storage decision (see Part 3.3).

## Part 2 — VhyxUI current state (re-checked fresh, 2026-09-17)

`/Users/tanveer/Documents/tanveer/VhyxUI/packages/react/package.json`:
**0.3.1-alpha** (bumped from 0.3.0-alpha since the last check — `git log`:
`1c1b6e3 chore(react): bump version to 0.3.1-alpha`, `0ba8b29 fix(toast):
raise the toast region's max-width above each toast's own min-width`).

Component directory listing
(`packages/react/src/components/`): Alert, Badge, Breadcrumb, Button, Card,
Checkbox, Dialog, Drawer, Form, Input, Pagination, Popover, Progress,
Radio, Select, SelectField, Separator, Spinner, Switch, Tabs, TextField,
Textarea, TextareaField, Toast, Tooltip.

**Still no Autocomplete/multi-select/Combobox.** `Select`/`SelectField`
have no `multiple` prop or search/filter-as-you-type behavior — the
`role="combobox"` hits in `Select.test.tsx` are just the standard ARIA
role for a single-select trigger, not an actual autocomplete component.
This is the same gap flagged at every prior check (VhyxUI Step 3, Phase 3
part 1, and now here) — **not a blocker**, per the established precedent:
the same shim pattern already used for `Typography`/`Skeleton`/`Avatar`
(`apps/web/src/components/vhyxui-shims/`) is the fallback for role/ability
assignment UI (a searchable multi-select for assigning abilities to a
role, or roles to an admin user) — build a small local
`MultiSelectCombobox` shim (keep it in `apps/admin`'s own tree, matching
the shim precedent, not vendored into VhyxUI itself) rather than waiting
on upstream.

## Part 3 — Proposed scaffolding (plan only, nothing built this session)

### 3.1 Location, naming, workspace conventions

- **`apps/admin`**, package name **`@vhyxvoid/admin`** — matches
  `apps/web`'s `@vhyxvoid/web` naming exactly, and the monorepo's
  `apps/*`/`packages/*` pnpm-workspace glob (`pnpm-workspace.yaml`)
  already covers any new `apps/*` directory with no config change needed.
- **Excluded from the root TypeScript project-reference graph**
  (`tsconfig.json`'s `references` array currently lists `protocol`, `sdk`,
  `agent`, `shared`, `apps/hub`, `apps/api` — `apps/web` is deliberately
  absent), own `tsc --noEmit` script instead — same precedent as
  `apps/web`, for the same reason (a Next.js app doesn't fit `tsc -b`'s
  composite-project model cleanly, and doesn't need to — nothing else in
  the monorepo imports from an app). Own ESLint config too (`apps/web`
  runs its own ESLint 8 config, outside the root flat config).
- **Own port.** `apps/web` = 4000 (with 4177 as this project's established
  local fallback when 4000 is occupied — see
  `apps/api/src/core/constant/hub.constant.ts`'s `allowedOrigins`),
  `apps/api` = 9000, `apps/hub` = 9001 (nominally — `main.ts` logs 3001 but
  actually binds 9001, a pre-existing inconsistency, see
  `internal-tools/shared/context.md`). Proposed: **4001** for
  `apps/admin`'s dev server (`next dev --turbopack -p 4001`, matching
  `apps/web`'s `-p 4000` script convention) — free today, and distinct
  from apps/web's own 4000/4177 pair so both dashboards can run
  side-by-side during development. **Not yet added to `apps/api`'s CORS
  `allowedOrigins`** — that edit belongs to the scaffolding session itself
  (adding an origin for an app that doesn't exist yet would be dead
  config); flagged in backlog.md so it isn't forgotten once `apps/admin`
  is real.

### 3.2 VhyxUI + `@vhyx/api-kit` from day one — confirmed, no MUI phase

Both sibling-repo `link:` conventions apply identically to a new
workspace member — `internal-tools/shared/context.md` already states this
explicitly ("This is the established pattern for any future workspace
that consumes VhyxUI too, not a one-off for `apps/web`"):

- `"@vhyxui/react": "link:../../../VhyxUI/packages/react"`,
  `"@vhyxui/tokens": "link:../../../VhyxUI/packages/tokens"` — relative
  paths, VhyxUI checked out as a sibling directory to this repo.
- `"@vhyx/api-kit": "link:../../../vhyx-api-kit"` — same pattern, the
  shared `createHttpClient`/`createQueryKeys`/`createQueryClient` package
  (`internal-tools/shared/context.md` item 44). Its `createHttpClient`
  factory is already deliberately configurable (auth-header attachment and
  unauthorized-handling are injected via `getAuthHeaders`/`onUnauthorized`,
  not hardcoded to `apps/web`'s own refresh-queue model) — built with
  exactly this kind of second consumer in mind, per its own design intent
  recorded in `internal-tools/user-frontend/decision.md`'s Phase 1
  adoption entry.
- `next.config.ts` needs the same `turbopack.root` widening to the common
  parent of this repo, VhyxUI, and `vhyx-api-kit` — `apps/web`'s existing
  `next.config.ts` already does this for all three (added when
  `vhyx-api-kit` was adopted, no further widening was needed at the time),
  so `apps/admin`'s own `next.config.ts` needs the identical block, not a
  new investigation.
- No MUI/Vuexy phase — confirmed nothing in the Admin RBAC backend or this
  plan implies a design-system migration path; build directly on VhyxUI
  from the first screen, same as the brief assumed.
- `@tanstack/react-query` should be pinned to the **exact same version**
  `apps/web` currently pins (`5.102.8`) from the start, per the fragile
  duplicate-instance issue already documented in
  `internal-tools/user-frontend/backlog.md` — a second app resolving a
  different minor version against the same linked `vhyx-api-kit` copy
  would hit the identical `QueryClient` private-field mismatch.

### 3.3 Auth model — genuinely separate, concretely different wiring

Confirmed in Part 1: `AdminSession`/`adminAuthGuard`/`requireAbility` is a
fully separate system from the regular-user JWT auth apps/web uses, but
the two paths share the same RS256 key material (a new, previously-missed
finding this session made — see above). Concretely, for `apps/admin`'s own
`httpClient`/auth wiring:

- **Cannot reuse `apps/web`'s httpClient/auth interceptor as-is.**
  `apps/web`'s refresh flow relies on an httpOnly cookie the browser sends
  automatically; the admin login response returns both tokens in the JSON
  body with zero cookie involvement. `apps/admin` needs its own decision
  on where to hold `accessToken`/`refreshToken` (in-memory + a
  `vhyx-api-kit` `getAuthHeaders` callback reading from a small auth
  store, e.g.; **not** `localStorage` for the refresh token specifically,
  to avoid reintroducing the XSS-exposure class of issue
  `internal-tools/user-frontend/context.md` item 42 removed from
  `apps/web`'s own client-side signing code) and its own 401→refresh→retry
  flow via `@vhyx/api-kit`'s `onUnauthorized` hook, calling
  `POST /api/v1/admin/identity/auth/refresh` with the stored refresh
  token — structurally similar to `apps/web`'s pattern but not the same
  code, since the token source differs.
- **Every request needs `Authorization: Bearer <accessToken>`** —
  `adminAuthGuard` only ever reads via `extractToken(request)` (Bearer
  header), never a cookie.
- **Distinguish "logged in as admin" from "logged in as regular user"
  entirely at the app level**, not the token level — an admin token has
  `type: "admin"` and `isSuperAdmin` in its payload, but there's no shared
  session between the two apps (deliberately — this is two separate
  logins against two separate route trees), so `apps/admin` doesn't need
  to interoperate with `apps/web`'s auth state at all, just its own.
- Gate the app's own nav/route access on `GET /me/abilities`'s result
  (already fetched once per session) rather than re-deriving ability
  strings client-side — matches the backend's own
  `requireAbility('<resource>.<action>')` string convention
  (`admin.create`, `role.assign`, etc.) directly.

### 3.4 Copy, not extract — `GenericServerTable`/`useServerTable`/`RowAction`/`Confirmation`

Confirmed by reading the actual source and its import graph
(`apps/web/src/libs/table/`, `apps/web/src/libs/components/`,
`apps/web/src/contexts/`) — the real dependency set for a clean,
self-contained copy is larger than the four named files but every file in
it is small (largest is 65 lines) and carries **zero apps/web-specific
business logic** (no account/tunnel/member types leak in):

| File | Role | Real dependencies to also copy |
|---|---|---|
| `libs/table/GenericServerTable.tsx` | table shell | `libs/table/TableSkeleton.tsx`, `libs/components/TablePaginationComponent.tsx`, `libs/table/tableUtility.ts` (`useBulkSelection`), `hooks/mountFlag.ts` (`useMounted`), `components/vhyxui-shims/Typography`, its own `table.module.css` |
| `libs/table/useServerTable.ts` | page/limit/search/sort state hook | `libs/table/tableUtility.ts` (`usePersistedState`), `utils/debouncedSearch.ts` (`useDebounce`) |
| `libs/table/RowAction.tsx` | per-row action menu | `libs/table/type.ts`, `libs/components/Confirmation.tsx`, `libs/dialogs/OpenDialogOnElementClick.tsx` |
| `libs/components/Confirmation.tsx` | confirm-before-mutate dialog | `contexts/FeedbackContext.tsx` (the global confirm/alert Dialog — itself only depends on `hooks/useFeedbackDialog.ts` and `vhyxui-shims/Typography`, both self-contained) |

Total: ~13 files, none apps/web-specific. **Confirmed clean copy, not a
reference back into `apps/web`'s files** — `apps/admin` gets its own
`libs/table/`, `libs/components/`, `libs/dialogs/`, `contexts/`,
`hooks/`, `utils/`, `components/vhyxui-shims/` subset with these files
duplicated verbatim as the starting point, editable independently from
that point on (matching the brief's "self-contained" requirement — no
cross-app import path from `apps/admin` into `apps/web/src/...`).

**Real fit caveat found while checking this (same class of issue as
`internal-tools/user-frontend/context.md` item 47's Invitations
precedent):** `GenericServerTable`/`useServerTable` assume a server that
accepts `page`/`limit`/`search`/`sortBy`/`sortOrder`/`filters` — true for
apps/web's Members/API Keys/Tunnels, **not true** for the Admin RBAC
list endpoints checked in Part 1. `GET /admin/users`, `/roles`, and
`/abilities` accept no page/limit/sort/search at all (users has one
`status` filter; roles/abilities have none, `isActive: true` is
hardcoded server-side) — these three screens need `useServerTable` run in
**client-side-pagination mode** (the same adaptation Invitations needed),
not the full server-driven mode Members/API Keys use. `GET /audit-logs`
has partial server support (`limit`/`offset`, three mutually-exclusive
single-value filters, no search/sort) — closer to API Keys'
custom-param-mapping precedent than to a drop-in fit. Only
`GET /admin/feedback` (list-all-feedback) matches the full
server-driven shape `GenericServerTable` was built for out of the box.

### 3.5 Initial screen list (revised against the real backend, not the brief's assumption)

1. **Admin login** (`POST /auth/login`) — standalone page, no shell.
2. **Dashboard shell** — fetch `GET /me` + `GET /me/abilities` on mount,
   gate nav items by ability string, standard authenticated-shell pattern
   apps/web already has a working precedent for (`AuthGuard.tsx`) though
   the guard logic itself must be new (different token source, see 3.3).
3. **Admin Users** — **BUILT 2026-09-17** (list, detail, disable/enable,
   role-assignment sub-view — see "Current State — Screen 3" above).
   ~~list (client-side paginated, `status` filter only), detail/edit
   (firstName/lastName only), create (email/password/firstName/
   lastName), disable/enable action, and a role-assignment sub-view
   (assign/revoke `AdminRole`s on a given admin) — this is where the
   missing-multi-select gap from Part 2 actually bites; a
   `MultiSelectCombobox` shim is needed here (or on the Roles screen's
   ability-assignment view — whichever gets built first can host the one
   shim both reuse).~~ **Corrected when built: no multi-select shim
   needed at all** — `AssignRoleToAdminUseCase`/`RevokeRoleFromAdminUseCase`
   both operate on exactly one role per call, confirmed by reading them
   directly; a plain VhyxUI `Select` is the correct, honest UI. "Detail/
   edit" and "create" were narrowed at build time to detail + role
   assignment only — the edit/create forms were judged out of the actual
   list-screen scope and deferred (see decision.md); a real test admin
   was created via direct API call instead of a UI form.
4. **Roles** — **BUILT 2026-09-17** (list, detail/edit respecting the
   confirmed `isSystem` guard, ability-assignment sub-view, create — see
   "Current State — Screen 4" above).
   ~~list (client-side paginated, no filters), create, edit
   (name/description only — `isSystem` roles are presumably
   non-editable at the domain layer; confirm `AdminRole.update()`'s own
   guard when this is built, not assumed), and a per-role ability-
   assignment sub-view (`GET/POST/DELETE .../abilities`) — the other
   natural home for the multi-select shim.~~ **Corrected when built: no
   multi-select shim needed here either** (independently re-confirmed,
   same conclusion as Users) — `AssignAbilityToRoleUseCase`/
   `RevokeAbilityFromRoleUseCase` both take exactly one `abilityId` per
   call. `AdminRole.update()`'s `isSystem` guard confirmed real (409
   CONFLICT); ability assignment itself confirmed to have no such guard —
   an asymmetry the edit-form/ability-view UI now reflects explicitly.
5. **Abilities** — **BUILT 2026-09-17** (list, create, delete — see
   "Current State — Screen 5" above).
   ~~list (client-side paginated, no filters), create,
   delete. **No edit** — the brief's assumed "abilities list (+
   create/edit)" is corrected here; there is no update endpoint.~~
   **Confirmed when built:** no edit endpoint, no detail page needed
   either (nothing to drill into beyond the list columns). Delete is a
   real hard delete with no assigned-role guard (`onDelete: Cascade`) —
   the confirm-delete dialog states this explicitly.
6. **Audit Log viewer** — **BUILT 2026-09-17** (list, filter by one of
   admin/action/target, expandable-row detail — see "Current State —
   Screen 6" above).
   ~~filter by one of adminId/action/targetId,
   limit/offset pagination, read-only, renders `changes`
   (before/after diff) and `metadata` (ip/userAgent/statusCode) per row.~~
   **Corrected when built:** no total/count field exists in the response
   at all (not even a dead-code count call), so this screen doesn't use
   `GenericServerTable`/`TablePaginationComponent` — a purpose-built view
   with a Previous/Next pager instead. `changes` is a full before/after
   entity snapshot, not a field-level diff.
7. **Feedback triage** — **BUILT 2026-09-17, FINAL SCREEN** (list with
   real server pagination/filters/counts, detail + triage update — see
   "Current State — Screen 7" above).
   ~~list all feedback with status/type/priority
   filters and per-status counts (server-paginated, the one screen that
   fits `GenericServerTable` without adaptation), detail view, and an
   inline status/priority/notes update form. Real, working,
   already-designed-for-an-admin-panel backend surface sitting unused.~~
   **Confirmed when built**: genuinely does fit `GenericServerTable`'s
   full server-driven mode, the only screen in this app that does — but
   with zero sort support (not previously called out) and a top-level
   `items`/`meta`/`extra` envelope shape needing its own `PaginatedResponse`
   type (also not previously called out, since no prior screen in this
   app had used it).

**All 7 founding-plan screens are now built.** The next session's correct
next step is the batched whole-app interactive browser-verification pass
(see backlog.md), not further screen work.

### 3.6 `internal-tools/admin-frontend/` set up this session

This file, `decision.md`, `session_update.md`, `backlog.md` all created
2026-09-17, per the project's established per-component documentation
convention (`internal-tools/{api,hub,user-frontend,shared}/` already
follow this shape) — set up before any scaffolding, not retrofitted after.

## Open Questions

- ~~`AdminRole.update()`'s own guard on `isSystem` roles~~ **Resolved when
  Screen 4 was built (2026-09-17):** yes, real and enforced —
  `validateNotSystem()` throws `ConflictError('System roles cannot be
  modified')` (409 CONFLICT), confirmed by reading `AdminRole.entities.ts`
  directly and empirically via curl. Ability assignment/revocation on a
  role has **no** such guard (also confirmed both ways) — an asymmetry the
  built UI reflects (edit form disabled for system roles, ability
  assignment left enabled). See "Current State — Screen 4" above.
- ~~Does Admin Users' role-assignment need a multi-select?~~ **Resolved
  when Screen 3 was built (2026-09-17):** no — `AssignRoleToAdminUseCase`/
  `RevokeRoleFromAdminUseCase` both take exactly one `roleId` per call.
  See "Current State — Screen 3" above.
- ~~Does Roles' ability-assignment sub-view need a multi-select?~~
  **Resolved when Screen 4 was built (2026-09-17), independently
  re-confirmed rather than assumed from the Users answer above:** no —
  `AssignAbilityToRoleUseCase`/`RevokeAbilityFromRoleUseCase` both take
  exactly one `abilityId` per call. See "Current State — Screen 4" above.
- ~~Does `CreateAdminUseCase` require at least one role at creation
  time?~~ **Resolved by reading `CreateAdmin.usecase.ts` directly:** no —
  `AdminUser.create()` takes no role/ability input at all (and there's no
  `isSuperAdmin` param either, so a brand-new admin is always a regular,
  non-super admin with zero roles until one is assigned separately). The
  Admin Users create-screen should redirect straight into "assign a role
  now" after a successful create, since a freshly-created admin can log in
  but `requireAbility`-gated routes will reject everything until a role
  with abilities is attached — worth a visible empty/unprivileged state on
  that admin's detail page, not just a silent redirect.
