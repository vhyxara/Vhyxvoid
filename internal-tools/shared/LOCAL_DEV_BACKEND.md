# Local dev backend — for apps/web functional checks

Standing dev infrastructure so migration-step functional checks (Steps 3-5+
of the VhyxUI migration, and beyond) can hit a **real, running API** with
**real seeded org/member/tunnel/API-key data** instead of hitting a wall of
504/connection-refused and having to skip role-gated UI. Set up 2026-09-10.
See `internal-tools/shared/decision.md`, 2026-09-10, "Local dev backend set up
as standing test infrastructure" for the full investigation and rationale.

## What already exists on this machine

- **A local Postgres 16 server is already running** (Homebrew,
  `/usr/local/opt/postgresql@16/bin/postgres`), listening on `localhost:5432`.
- **A database named `Black-server` already exists there**, already migrated
  to this project's current Prisma schema (all 13 migrations under
  `apps/api/prisma/migrations` applied), and **already has substantial
  seeded test data**: 24 users, 25 accounts/orgs, 26 org memberships, 23 API
  keys, plus tunnel and invitation records. This predates this session —
  it was not created for this task, just discovered and reused.
- `apps/api/.env` already has a commented-out local `DATABASE_URL` line
  pointing at exactly this database (`postgresql://tanveer:...@localhost:5432/Black-server`)
  — someone had this working locally before, then switched the active line
  to a remote Neon Postgres instance. **That Neon line is left untouched.**

## Do NOT touch `apps/api/.env`'s active `DATABASE_URL`

The currently-active `DATABASE_URL` in `apps/api/.env` points at a **real,
remote, shared Neon Postgres database** (and the file also has real Stripe
and Resend keys). Never run `apps/api` against that for testing, and never
edit that file to "fix" this — override the env var for your shell session
instead, exactly as below. This keeps the real remote DB/Stripe/Resend
completely out of the loop for local functional testing.

## ⚠️ Local Redis IS production Redis (checked 2026-09-24)

`apps/api/.env`, `apps/hub/.env` and both `.env.production` files (locally
and on the server) all point at the **same** Upstash instance
(`discrete-pup-287387`), and the active `DATABASE_URL` in the local `.env`
files is the same Neon host production uses. There is no separate dev
Redis. The "ENOTFOUND, no network path to Upstash" note below is stale:
this machine reaches Upstash fine now. Consequences:

- Anything a local api/hub writes to Redis (API-key cache entries,
  `tunnel:sub:*` subdomain entries, usage counters, rate-limit and
  replay keys) lands in production's Redis. Use disposable accounts with
  unique slugs, and check for leftover keys by account id/keyId/slug
  afterwards (a force-killed hub leaves its `tunnel:sub:*` entry behind).
- Usage counters from both environments share the `usage:*` namespace.
  Each environment's api only drains accounts that exist in its own
  database (`FlushUsageWorker.runForPendingAccounts`, 2026-09-24), so
  neither deletes the other's counters. Keep it that way.
- Always override `DATABASE_URL` for **both** apps/api and apps/hub when
  running them locally (the hub's `.env` points at production too).

## ⚠️ Port 9000 may be a VS Code forward to PRODUCTION (found 2026-09-25)

While a VS Code Remote-SSH window to the production server is open, VS Code
listens on `127.0.0.1:9000` and forwards it to the server's api (published on
the server's own `127.0.0.1:9000`). A local `pnpm dev` api still starts (it
binds `*:9000`), but `curl localhost:9000` resolves to `127.0.0.1` and reaches
**production**, not your local api, with no error. That happened once
(api/decision.md, 2026-09-25, "#63": a test registration landed in
production). Before any live check: `lsof -nP -iTCP:9000 -sTCP:LISTEN` must
show only your node process, or run the local api on another port
(`PORT=9100 ... pnpm dev`) and target `127.0.0.1:9100` explicitly.

## Starting the backend

From `apps/api`:

```bash
DATABASE_URL="postgresql://tanveer:8657212134@localhost:5432/Black-server" \
  NODE_ENV=development pnpm dev
```

This overrides `DATABASE_URL` for just this process (dotenv does not
overwrite an already-set env var), so `apps/api/.env`'s Neon line is never
touched or used. The server listens on `http://localhost:9000`. No other
setup is required:

- **Redis/Upstash**: `apps/api/.env`'s existing `UPSTASH_REDIS_REST_URL`/
  `_TOKEN` are used as-is. `initRedis()` only checks that these two env vars
  are *set*, not that Upstash is actually reachable — so the server boots
  fine even if this sandbox can't reach Upstash's cloud endpoint (confirmed:
  `ENOTFOUND` on the Upstash hostname, no network path out to it from here).
  **This DOES have a real, confirmed effect on API-key create/rotate/revoke**
  (found in the Step 5b session, 2026-09-11) — see the dedicated warning
  below. Nothing else exercised so far (Steps 1-5a) hit an affected code
  path, but don't assume a new mutation is safe just because it's on a
  different screen — check whether it touches `RedisApiKeyCacheService` or
  similar before trusting a 500 as "nothing happened."

### ✅ RESOLVED (2026-09-12): API-key create/rotate/revoke used to return 500 even on success

**Fixed** — `RedisApiKeyCacheService.set()`/`.invalidate()` now fail soft
(log and swallow) instead of re-throwing, matching the pattern its own
`incrementUsage()` method already used. Create/rotate/revoke now correctly
return `201`/`200`/`204` in this sandbox despite Redis/Upstash still being
genuinely unreachable — the real secret is now visible end-to-end in the
create/rotate response for the first time. See
`internal-tools/api/decision.md`, 2026-09-12, "Bug 1 fix:
RedisApiKeyCacheService.set()/invalidate() now fail soft...". The historical
symptoms below (kept for context, no longer current):
- Create/revoke's underlying Postgres writes always succeeded even when the
  HTTP response 500'd — rotate's did too, contrary to what was originally
  suspected (see the linked entry's correction).
- If you still see a 500 on these endpoints, it's a **different**, new
  issue — this specific Redis-re-throw cause is gone.

**Still true and unrelated:** `RedisApiKeyCacheService.get()` (gateway
key-validation hot path) and `.markRequestId()` (replay protection) have
the same unguarded-Redis-call shape and were *not* fixed this session —
flagged in `internal-tools/api/decision.md` as a separate, higher-blast-radius follow-up (a
Redis outage would currently break tunnel/API request validation entirely,
not just the admin screens).

### ✅ RESOLVED (2026-09-15): mutation-failure toasts now actually appear

**Fixed** — and the original root cause here was imprecise, corrected while
fixing it. It was never "no toast container mounted anywhere": a real,
working `<Toaster/>` (`react-hot-toast`) was always mounted in
`providers.client.tsx`. The bug was that `queryClient.ts`'s global
`onError` handlers called `toast.error(...)` from a **different**,
also-installed toast library, `react-toastify` — whose own
`<ToastContainer/>` was never mounted anywhere, so those specific calls had
nowhere to render. Fixed by wiring `queryClient.ts` (now built on the
shared `@vhyx/api-kit` package's `createQueryClient`) onto `react-hot-toast`
instead — the library that's actually mounted — rather than adding a
second, competing toast container. `utils/copyToClipboard.ts` had the
identical bug (same wrong-library import) and was fixed the same way. See
`internal-tools/user-frontend/decision.md`, 2026-09-15, "Phase 1 adoption:
@vhyx/api-kit in VhyxVoid".

**Visually confirmed** (2026-09-15, Phase 2 pilot session, once the Claude
in Chrome extension was connected): logged in as `alicess@example.com`
(Acme Corp), submitted "Invite member" for an email already pending
invitation — the real `POST .../members/invite` returned `409`, and a red
error toast rendered top-right reading "A pending invitation already exists
for this email", screenshotted directly. This had only ever been verified
at the data level across the prior three sessions; the pixel-level check is
now done.
- **Stripe/Resend**: only called on-demand (checkout, invites, password
  reset emails) — booting the server and browsing the app never triggers
  them. Avoid deliberately triggering "Upgrade plan", "Invite member", or
  "Forgot password" while testing against this local setup, since those
  *would* fire real calls using the real keys in `.env`.
- **apps/hub is NOT needed** for typical `apps/web` functional checks — the
  Tunnels list page reads tunnel records from Postgres via `apps/api`
  directly; no live Hub/WebSocket connection is required to view or test
  the list UI.

### ✅ RESOLVED (2026-09-12): Remove-member's "500" was never a RemoveMemberUseCase bug

The Step 5c "remove-member returns 500" finding was a **misdiagnosis**, now
corrected. `RemoveMemberUseCase` was never broken. What actually happened:
Step 5c's throwaway test UUID (`11111111-1111-1111-1111-111111111111`) is
not a valid RFC4122 UUID (its variant nibble is wrong), so `apps/api`
correctly rejected it with a `ZodError` — but a **separate, real,
previously-unknown bug** (`server.setErrorHandler` registered too late in
`server.ts`'s plugin boot sequence — now fixed) meant that `ZodError` never
reached the app's custom error formatting and fell through to Fastify's raw
default handler as an opaque `500` instead of the intended `400`, which is
why it looked like a server crash instead of "your test UUID is malformed."
With both the UUID format and the `setErrorHandler` timing now understood
and the latter fixed, remove-member with a real, well-formed UUID has
always worked and returns a clean `200`. See
`internal-tools/api/decision.md`, 2026-09-12, "Bug 2 resolution..." for the
full three-tier diagnostic that
found this. **When crafting throwaway test UUIDs by hand for future
sessions, use `crypto.randomUUID()` (or any real UUID generator) — not a
hand-typed repeating-digit string — since Zod's `.uuid()` validates the
actual version/variant nibbles, not just the general shape.**

Then, from `apps/web`, start the dev server on **port 4000**, not the
`4177` used for earlier no-backend testing:

```bash
npx next dev --turbopack -p 4000
```

**Port 4000 matters**: `apps/api`'s CORS allowlist
(`apps/api/src/core/constant/hub.constant.ts`) only allows
`http://localhost:4000` and (as of this session) `http://localhost:4177`.
If you use a different port, requests will fail at the browser's CORS
layer with no server-side log entry at all — which looks identical to "no
backend running" and is easy to misdiagnose. Prefer port 4000 when nothing
else has it occupied; fall back to 4177 (already allow-listed) if something
else on this machine is using 4000, as has happened in prior sessions —
check with `lsof -ti :4000` before assuming either port is free, and never
kill whatever you find there without confirming what it is first.

## Test accounts (passwords reset this session to a known value)

Both accounts' passwords were reset directly via SQL (bcrypt, cost 12,
matching `BcryptPasswordHasher`) since the originals were unknown. This is
local-only test data — resetting them has no effect outside this machine.

| Email | Password | Role | Org(s) |
|---|---|---|---|
| `test@example.com` | `DevTest@12345` | Owner | **Test Corp** (org, 1 member, 2 active API keys, 9 tunnel records, 1 pending invitation) and **Test's Workspace** (personal) |
| `alicess@example.com` | `DevTest@12345` | Owner | **Acme Corp** — 2 members: `alicess@example.com` (Owner, email **not** verified — useful for testing the "Email not verified" Badge state) and `alicesss@example.com` (Admin, verified). Also happens to co-own a second, separately-created account also named "Test Corp" (pre-existing data quirk, not something this session created — don't be confused by the name collision with the first row) |
| `alicesss@example.com` | `DevTest@12345` | Admin | Acme Corp (see above) |
| `admin@company.local` | `Admin@12345678` | Super Admin (Admin RBAC system — separate from the regular-user auth above, see `internal-tools/api/context.md`) | N/A — logs into `apps/admin`, not `apps/web` |
| `test-admin@company.local` | `TestAdmin@12345` | Regular Admin (Admin RBAC — **not** super admin), currently no roles assigned | N/A — logs into `apps/admin`. Added 2026-09-17 (Admin Users screen session) specifically so disable/enable/role-assignment testing has a real target that isn't the only working super-admin login — `admin@company.local` cannot be disabled (backend rejects it) and shouldn't be used for destructive testing regardless. |
| `ada.verify@company.local` | `Admin@123` | Regular Admin, role **Support Agent** (`audit.read`) | Created 2026-09-22 through the Create Admin dialog; name edited to "Adaline Verify". **Convention from 2026-09-22: every test account created from here on uses `Admin@123`.** |
| `contract-check@company.local` | `Contract@1234` | Regular Admin, no roles | Created by curl 2026-09-22 while verifying the create/update contract (named "Conrad Tracton" by the PUT probe). Older password, not the new convention. |
| `solo-check@example.com` | `DevTest@12345` | Owner | **Solo's Workspace** (personal) only, no organization; two DEV keys. Created 2026-09-21 through the real `/auth/register` and `/auth/verify-email` endpoints (email delivery stubbed by setting the token's SHA-256 hash to a known value) as the personal-only case: use it to test anything a user who never created an organization sees. |

Admin RBAC seed data (`AdminUser`/`AdminRole`/`AdminAbility`, all
independent of the regular-user tables above) was added 2026-09-17 via
`pnpm seed` from `apps/api` — 23 abilities, 4 roles (Super Admin/Admin/
Moderator/Operator), one super admin (row above), plus the second regular
admin row above (created via a real `POST /admin/identity/users` call,
not the seed script). Real, standing seeded data, same
persists-across-sessions convention as the rest of this table.
See `internal-tools/admin-frontend/context.md` for the frontend that
consumes it.

**Use `alicess@example.com` / Acme Corp whenever a test needs multiple
members with different role levels** (role-badge rendering, permission
gating, RequireRole behavior) — this is the one org in the existing seed
data that actually has that. Use `test@example.com` / Test Corp for
single-owner scenarios, or when you specifically want its existing API
keys / tunnel records / pending invitation.

Do not rename, delete, or otherwise mutate these accounts/orgs as a side
effect of a functional check unless you deliberately revert the change
before finishing (as this session did after testing the org-rename form —
renamed "Test Corp" to "Test Corp Renamed" and back). Future sessions
should be able to rely on this table staying accurate.

## Verified working, this session

- Login as `test@example.com` → real dashboard with 2 real orgs.
- Members, API Keys, Tunnels, Settings pages on `Test Corp` — all render
  real data (previously only ever seen as loading skeletons or empty
  states in every prior migration-step session).
- The org-rename form (`OrgSettingsView`) — previously untestable (hidden
  behind `RequireRole` with no real admin membership) — fires a real
  `PATCH`, and the UI updates. Tested end-to-end and reverted.
- Login as `alicess@example.com` → Acme Corp's Members table renders two
  different role badges (Owner / Admin) and two different verified states
  (Pending / Verified) side by side.

## Stopping / restarting

Both processes were stopped at the end of this session (not left running
between sessions). To restart: repeat the two commands above. Expect ~10s
for `apps/api` and ~10-20s for `apps/web`'s first Turbopack compile of
whatever route you hit first.

### ⚠️ `lsof -ti :9000 | xargs kill` is NOT enough to actually stop apps/api

`pnpm dev` runs `ts-node-dev --respawn`, which is a **supervisor process**
that watches files and re-spawns a child worker on change — that child is
what actually binds port 9000. Killing only the port-listener (via `lsof
-ti :9000`) kills the child but **leaves the ts-node-dev supervisor alive**,
which will happily start a new child and re-bind to port 9000 later,
completely silently, whenever the port frees up (e.g. once a later
session's own server exits). This actually happened across multiple past
sessions (2026-09-11 and earlier) — by 2026-09-12, **six separate orphaned
`ts-node-dev` supervisors** had accumulated, dating back several days, and
were actively racing each other for port 9000 (one of them is almost
certainly what a future session will find "mysteriously" occupying port
9000 again, if this isn't done correctly).

**Correct way to fully stop apps/api:**

```bash
ps aux | grep -i "ts-node-dev\|apps/api/src/server.ts" | grep -v grep | awk '{print $2}' | xargs -r kill -9
```

This kills every ts-node-dev supervisor *and* worker process for this
project, not just whatever's currently bound to the port. Verify with:

```bash
lsof -ti :9000        # should print nothing
ps aux | grep ts-node-dev | grep -v grep   # should print nothing
```

Do this **before** trusting `lsof -ti :9000` as evidence the port is free,
and before starting a new `pnpm dev` — starting a new one while an old
supervisor is still alive causes an `EADDRINUSE` crash-loop as both fight
over the port.
