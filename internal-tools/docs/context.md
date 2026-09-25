# Project Context — apps/docs

**Scope:** `apps/docs` (`@vhyxvoid/docs`), the external developer/product documentation site — install, SDK, framework integrations, dashboard usage, troubleshooting. **Audience: external developers using VhyxVoid.** Out of scope, permanently: internal engineering/architecture docs (`internal-tools/*`) and admin-panel operations (`apps/admin`).

Created 2026-09-19 (see `session_update.md`, `2026-09-19-docs-app-scoping-investigation-plan`). This file began as the plan; the 2026-09-19 scaffold session executed it. **The "Current state" section below is authoritative where it differs from the plan text that follows** (the plan sections are kept, with corrections noted inline, per the append-only-correction convention). Framework choice reasoning: `decision.md`.

## Current state (as built, 2026-09-19 scaffold session)

**Built and verified:** `apps/docs` (`@vhyxvoid/docs`, private, port **4002**), Fumadocs (`fumadocs-core` 16.15.11, `fumadocs-mdx` 15.4.1, `fumadocs-ui` aliased to `npm:@fumadocs/base-ui@16.15.11` — the alias is `create-fumadocs-app`'s own current default) on **Next 16.3.4, React 19.2.3, Tailwind 4.3.3, TypeScript 5.9.3**. Typechecks, builds, and builds **standalone outside the monorepo with no VhyxUI checkout present** (copied the app to a scratch dir, `pnpm install --ignore-workspace`, `next build` passed). Root `pnpm turbo run typecheck|build --filter='!@vhyxvoid/web'` (11/11, 10/10) and root `pnpm test` (22 files, 106 tests) pass with docs in the graph; apps/web `tsc --noEmit` and `next build` pass.

**Spike findings that corrected the plan (all in decision.md, 2026-09-19 scaffold entry):**
1. **The plan's "same Next/Tailwind versions as apps/web/apps/admin" is wrong for docs.** `fumadocs-mdx` 15.4.1 emits a Turbopack rule that **Next 16.1.1 cannot parse** (`failed to parse next.config.js: turbopack.rules.*.json: data did not match any variant of untagged enum Either`); Next 16.2.0 gets past it and 16.3.4 builds. (`--webpack` on 16.1.1 also failed, for the Tailwind reason below.) Fumadocs' preset also needs **Tailwind >= 4.2** (`Cannot apply unknown utility class -inset-s-4` on 4.1.17); 4.3.3 works. So docs pins Next 16.3.4 / Tailwind 4.3.3 while web/admin stay on 16.1.1 / 4.1.17. Safe because apps/docs shares no runtime, no CSS, and no dependency graph with them (separate pnpm importer). **Consequence: do not "align" docs' versions down to match web/admin — it will break the build.** Bump docs' Next/Tailwind independently.
2. **Token theming works as claimed, with three additions the docs had not mentioned:** (a) import `fumadocs-ui/css/preset.css` only, never a color preset, and define every `--color-fd-*` in an `@theme inline` block mapped to `--vhyx-color-*` (`src/app/global.css`); (b) `preset.css` also builds utilities from `--color-fd-diff-*`, so those four must be defined too (VhyxUI has no equivalent; Fumadocs' defaults copied); (c) **VhyxUI's `index.css` ends with a global reset (`* { margin:0; padding:0 }`, body rules) that flattens Fumadocs' layout** — the copy strips that trailing `reset.css` section (`scripts/sync-tokens.mjs`).
3. **VhyxVoid's "light" theme is near-black** (`apps/web/src/app/vhyxui-brand-override.css`: `--vhyx-color-bg: #050505` under `[data-brand="vhyxvoid"]`), so "match the dashboard" means copying the **brand override too**, not just VhyxUI's tokens. Docs is **dark-only**: `<html data-brand="vhyxvoid" data-theme="dark">`, `RootProvider theme={{ forcedTheme: 'dark' }}`, theme switch disabled. A light/dark toggle would offer a mode the product doesn't have. Not yet shared with apps/web's theme preference (same origin, so localStorage/cookie sharing is possible later).
4. **Do not set `theme={{ attribute: ['class','data-theme'] }}` on `RootProvider`.** The first build using it made the page's renderer freeze in Chrome (screenshot/JS timeouts, headless Chrome hung); removing it fixed the freeze. I did not root-cause it (possibly a next-themes attribute-sync loop), so treat as a known-bad config rather than a diagnosed bug.
5. **Server mode, not static export** (plan left this open). `next start -p 4002` behind the rewrite; search is Fumadocs' default `createFromSource` route (`/docs/api/search`, verified live incl. match highlighting through apps/web's proxy). Static export was spiked and builds too (needs `staticGET` + an explicit `from: '/docs/api/search'` on the client because `basePath` is not applied to `fetch`), so it remains an option if a static host is chosen.

**Routing (Part 4) — mechanism implemented; production destination NOT determinable from this repo.** apps/docs uses `basePath: '/docs'`. `apps/web/next.config.ts` adds `beforeFiles` rewrites `/docs` and `/docs/:path*` -> `${DOCS_ORIGIN}/docs/...`; `apps/web/src/proxy.ts` bypasses next-intl for `/docs` when an origin is configured (next-intl would otherwise rewrite to `/en/docs` before the rewrite can match — request order is proxy, then `beforeFiles`). Verified against a real `next build && next start` of apps/web (port 4010) with `DOCS_ORIGIN=http://localhost:4002`: `/docs`, `/docs/getting-started/quickstart`, `/docs/limitations`, `/docs/api/search`, and hashed `/docs/_next/static/*.css` all 200 through web; browser client-side navigation between docs pages stays under `/docs`; `/pricing`, `/support`, `/login` unaffected. With `DOCS_ORIGIN` unset in a production build: the build warns and `/docs` serves the existing "Coming soon" placeholder (chosen so a missing origin is visible, not a proxy to nowhere). **`nginx.conf`/`docker-compose.yml` only cover api./hub.; nothing in the repo says where apps/web or apps/docs are deployed. Open Question 1 below is therefore unresolved and needs the user.** Not tested: apps/web's own `next dev` (the user's dev servers on 4000/4001 were already running; `next.config.ts` is not hot-reloaded, so **restart apps/web's dev server**).

**Content state (as of the scaffold session; updated by the Integrations section below; the Integrations pages carry no crash/unpublished callouts as of the publish follow-up):** real pages: `index`, `getting-started/{quickstart,installation,concepts}`, `limitations`. 24 stub pages (frontmatter `stub: true`, body a "hasn't been written yet" callout) cover the rest of the IA in `meta.json` order. Freshness: `scripts/check-fresh.mjs` implements rules 1-4 of Part 4B (frontmatter present, sources exist, package versions match, `git log <verified.commit>..HEAD -- <sources>` empty) and was exercised both ways (passes clean; against the repo's root commit it reports the two commits that touched the cited sources; a bogus source path is flagged). Not in CI (needs full git history, `fetch-depth: 0`) — see backlog. Generators (Part 4A) are not started. **UPDATE 2026-09-21: started and used; see "Reference, SDK, dashboard and troubleshooting" below.** `.claude/CLAUDE.md` now carries the one-line `check:fresh` rule (note `.claude` is gitignored).

**Facts established while writing Getting Started (verified against the published tarballs `npm i @vhyxvoid/{agent@1.0.18,sdk@1.0.1,middleware@1.0.3,next@1.0.3}` in a scratch dir, plus source):**
- `npm view` re-run this session: agent 1.0.18, sdk 1.0.1, middleware 1.0.3, next 1.0.3 — still current.
- **`import { createClient } from '@vhyxvoid/sdk'` fails on the published 1.0.1 with `ERR_MODULE_NOT_FOUND`** (exports `import` -> `dist/index.mjs`, never built). `require()` and `createRequire` work. Confirmed real, not hypothetical (was flagged unverified last session). The quickstart documents the workaround honestly. `@vhyxvoid/next` and `@vhyxvoid/middleware` (root and `/next`) import fine in both ESM and CJS; `@vhyxvoid/middleware/fastify` needs `fastify`/`fastify-plugin` installed (peer deps).
- `vhyxvoid --version` from the published 1.0.18 prints **1.0.16** (stale version string in the bundle).
- `npx @vhyxvoid/agent [init]` works without a global/local install (single bin).
- **The dashboard never displays the account slug** (grep of `apps/web/src/views` + domain types: no `slug`), yet `client.ts`'s JSDoc and `vhyxvoid init`'s prompt say "from dashboard". The real source is the agent's `Public:` line on connect (URL is `https://<slug>--<label>.<hubDomain>`); the agent prints only Local/Label if the hub finds no slug.
- Key creation dialog preselects `tunnel:connect` (the only scope `HubAuth` requires); FREE plan cannot create PROD keys (enforced).
- **Not verified end-to-end:** a live agent -> hub -> local server request. `hub.vhyxvoid.com`'s certificate is **still expired** (`notAfter=Aug 3 21:03:51 2026 GMT`, checked 2026-09-19; `curl https://hub.vhyxvoid.com/health` fails validation), so a real agent's `wss://` connection cannot be exercised, and the local dev backend was not brought up (needs Postgres + Upstash Redis). The quickstart's console output block, status-code table, and SDK behavior are taken from source and the package tarballs, not a live run. Dashboard steps (register, API Keys page, create dialog) come from reading `apps/web` code, not a browser walk-through against a running backend. **The docs must not launch publicly until the cert is fixed and the quickstart is re-run live** (Known Risk #2, shared).

## Integrations section (2026-09-19 integrations session)

**Real pages now:** `integrations/{nextjs,express,fastify,standalone-cli,webhooks}` (sidebar order: Next.js first, since it is the locked recommended path). Quickstart, Installation and Limitations were corrected in the same session (see below). 19 stubs remain (CLI/SDK reference, dashboard guide, reference tables, troubleshooting, changelog). Every real page carries `verified`/`sources`; `check:fresh` passes (10 pages). All 118 internal links/anchors on the real pages were crawled against the running docs server and resolve.

**How it was verified (reusable pattern):** the four packages were installed from npm into a scratch dir (`npm i @vhyxvoid/{agent@1.0.18,sdk@1.0.1,middleware@1.0.3,next@1.0.3}` + express/fastify/fastify-plugin/next/stripe), and a ~30-line **fake hub** (a `ws` server that answers `agent:register` with `hub:registered` + a `tunnelUrl`, and pushes `tunnel:forward` on demand) stood in for `hub.vhyxvoid.com`. That made real agent-side runs possible despite the expired cert: CLI, Express, Fastify, Next dev/build, `--write-env`, env-file precedence, header/body fidelity, raw-body signature verification (HMAC and the real `stripe` package's `generateTestHeaderString`), and response caching. What it can NOT cover: the real hub's own behavior (header/body handling was checked by reading `HttpTunnel.handler.ts`), auth against real API keys, and the dashboard. The fake hub lives only in the session scratchpad; if this pattern is wanted again, rebuild it from `packages/protocol/src/messages.ts` (`AgentRegisterMsg`, `HubRegisteredMsg`, `TunnelForwardMsg`, `AgentBatchMsg`).

**Plan corrections found by real runs (things the plan/earlier pages got wrong or did not know). UPDATE 2026-09-19 (publish follow-up): items 1, 2, 3, 4 (cache), 6 (debug lines, version) are FIXED and PUBLISHED — agent 1.0.19, next 1.0.4, middleware 1.0.4 — the docs callouts are removed and every changed claim was re-verified against the packages installed from npm (see decision.md, "Publish follow-up"). Item text below is kept as the historical finding. Still true for the published packages: items 5 (Host rewriting), 7-10 and 11 (webhooks/no inspector); still OPEN: the SDK problems (ESM import, binary responses returned as garbled text in 1.0.1).**
1. **`@vhyxvoid/middleware@1.0.3` (Express AND Fastify) is broken on npm.** With credentials set it throws `Could not locate the bindings file` at `vhyxvoid()`/plugin registration. Cause: the published bundle contains neither `disableQueue` nor `NoOpQueue` (grep of `dist/{index,next,fastify}.js`), so it still builds a `DurableQueue`, and its bundled `bindings` cannot find the native module. `@vhyxvoid/next@1.0.3` and `@vhyxvoid/agent@1.0.18` do contain the fix. The fix exists in the repo working tree (uncommitted `packages/agent/src/queue/NoOpQueue.ts` + `AgentClient.ts`), and a build of the working-tree middleware passed every test below. So: the Express/Fastify pages document the correct API, verified against the working-tree build, behind a prominent "published package crashes" callout, and point at the CLI as the workaround. **When middleware is republished, remove those callouts** (Express, Fastify, Installation, Limitations "Known problems"); `check:fresh` will flag the pages when the version in `packages/middleware/package.json` moves.
2. **`@vhyxvoid/next@1.0.3` and `middleware@1.0.3` publish `"dependencies": {}`** (npm view) yet import `better-sqlite3` at config-load time (`--external:better-sqlite3`). In a clean project `next dev` fails: `Cannot find module 'better-sqlite3'`. Docs tell users to install it explicitly. (The `@vhyxvoid/agent` workspace dependency also disappears from the published manifests.)
3. **`vhyxvoid init` is broken** on Node 24: exits 0 silently right after the secret prompt, writes nothing (`askSecret` creates and closes a second readline on stdin, after which the first interface's `ask` never gets input). Reproduced under a PTY. **My Quickstart step 2 (previous session) described init working; that was wrong and is corrected** — Quickstart now has the reader create `.env.vhyxvoid` by hand.
4. **Agent response cache serves one caller's response to another** when the backend sends `Cache-Control: max-age>0` on a 2xx `GET` (cache key is path+query only; verified two requests with different cookies, second is `x-vhyxvoid-cache: HIT` with the first caller's body). This is shared Known Risk #5, now reproduced end to end and user-visible, not just a code-reading finding. It applies to every agent mode (CLI, Next, middleware). Documented in Limitations and each integration page. Resolves the "is the cache user-visible" backlog item: yes.
5. **The agent forces `Host: 127.0.0.1:<port>` and `x-forwarded-host: 127.0.0.1:<port>` and adds `x-forwarded-by: vhyxvoid`.** No `x-forwarded-proto`/`-for`. The public hostname is never visible to the local server. Documented.
6. **Published agent prints per-message debug lines** (`[agent] ...`, `[batcher] ...`, marked `// ← ADD` in source). The Quickstart's "you'll see" block omitted them; now mentioned. Startup banner and hub registration both carry `1.0.16` (the `--version` bug is not cosmetic-only: the wrong version is sent to the hub in `agent:register`).
7. **`@vhyxvoid/next` port detection** works via `-p` under `npx`, and also with the bare `next` binary (Next sets `PORT` itself). My first draft claimed direct invocation would fall back to 3000; that was wrong and was corrected after testing.
8. **Next dev cross-origin warning:** through the tunnel URL, Next 16.1.1 logs `Cross origin request detected to /_next/* resource` (future-major hard requirement). `allowedDevOrigins: ['*.vhyxvoid.com']` in next.config removes it (0 warnings, re-tested). Documented in the Next.js page.
9. **The brief's "NEXT_PHASE inconsistency" risk:** for `@vhyxvoid/next` the gate is `NODE_ENV==='development' || NEXT_PHASE==='phase-development-server'`. Verified on **Next 16.1.1 only**: `next dev` starts exactly one tunnel; `next build` with credentials present starts none; `enabled: true` starts one **during `next build`**. Other Next versions were not tried. The middleware/Express gate is only `NODE_ENV !== 'production'`, so `NODE_ENV=test` or unset turns the tunnel ON (shared Known Risk #16 still applies to `middleware/next`, which the docs deliberately don't document).
10. **Credential sources differ per integration:** CLI reads `.env`, `.env.local`, `.env.vhyxvoid` with `override: true` (files beat the shell; flags beat files — tested); `@vhyxvoid/next` reads the same files but never overrides already-set env; **middleware reads `process.env` only** (so `.env.vhyxvoid`, which the CLI's init would write, is not read by Express/Fastify). Default labels differ: CLI/middleware `default`, `@vhyxvoid/next` `app`. Documented per page.
11. **Webhook use case is real** (raw method/path/query/headers/body pass through the agent unchanged; UTF-8 JSON with emoji and odd whitespace verified a signature end to end through the agent), but there is **no request inspector** anywhere in the product, and the `webhook:receive`/`webhook:inspect` scopes are defined in `apikey.constant.ts` and checked by nothing (hub requires only `tunnel:connect`). Text bodies are decoded as UTF-8 at the hub (`HttpTunnel.handler.ts`), so a non-UTF-8 body under a text content type would not survive; binary content types (`isBinaryContentType`) are base64'd. The plan's "webhooks" bullet assumed possible inspection; it does not exist and the page says so.

**Not done / could not be done:** no live check against a real hub (cert still expired; `notAfter` Aug 3 2026, unchanged); dashboard steps unchanged from last session (read from code). The Next.js `.env.local` write-back ordering (whether Next sees the value on first run) was not tested — the page says "restart once or use `onConnect`" rather than asserting either way. Fastify was tested on the version `npm i fastify` gave (5.x); Express likewise latest. Windows/Linux not tested.

**Collateral incident (mine):** while cleaning up Next dev processes I ran `pkill -f "next dev"`/`pkill -f next-server`, which also killed the user's own running dev servers (apps/web :4000, apps/admin :4001, and an unrelated `livein-admin-web` Next dev). They were not restarted. Recorded so it is not a surprise; the lesson (kill by PID/port, never by process-name pattern on a shared machine) is in session_update.md.

## Reference, SDK, dashboard and troubleshooting (2026-09-21 session)

**State:** 27 real pages (verified/sources on each), 2 stubs left: `changelog` and `cli/configuration` (not in the brief; `cli/configuration` is largely covered by "Any stack (CLI)"). `check:fresh` is green and now also runs `generate --check`. Root typecheck/build 18/18, `pnpm test` 32 files / 203 tests, crawl of all 29 pages: 455 internal links and anchors resolve. Commits `a47747d` and `0ba974d`.

**Generators exist now (Part 4A started):** `scripts/generate.mjs`, blocks between `{/* generated:begin NAME */}` / `{/* generated:end NAME */}` inside hand-written pages; `pnpm --filter @vhyxvoid/docs generate` rewrites, `generate:check` verifies. Inputs and failure modes are in decision.md ("Generated docs blocks live inside hand-written pages"). Blocks: `cli-flags`, `cli-help` (CLI reference), `sdk-http`, `sdk-ws`, `sdk-errors`, `sdk-exports`, `plans-enforced`, `plans-flat`, `env-vars`, `env-timeout`, `scopes`. Hand-maintained inputs are `apps/docs/content-config/{env-vars,enforced-limits,scopes,sdk-notes}.json`, each checked against its source. **The CLI blocks need `packages/agent/dist/cli.js`** (`pnpm --filter @vhyxvoid/agent build`), so `check:fresh` on a clean checkout fails until the agent is built. Confirmed the repo's built CLI help is identical to npm `@vhyxvoid/agent@1.0.19`. Not built: code-sample typechecking (Part 4C), the protocol-error-code generator (the SDK errors page keeps a hand-written code table sourced from `errors.ts`/the hub router and named in its `sources`).

**Corrections to earlier claims in this file (found by re-reading source and running things):**
1. **Rate limiting is not "partly enforced", it is effectively not enforced.** `HubAuthService.authenticateAgent` hardcodes `rateLimitPerMinute: -1`, so agent registration is never limited (the row above said "agent registration and SDK-WS requests"). Only `TunnelClient` (`sdk:register`/`sdk:request`) reaches the limiter, and it holds only while the key's Redis cache entry (TTL 5 min, seeded at create/rotate) is warm; a reload from the database sets `-1`. Public tunnel HTTP never checks a key. The docs list no rate limit (decision.md, 2026-09-21).
2. **The concurrent-agent limit is real but flat:** `PLAN_AGENT_LIMITS.PRO` (5) for every account, message `Maximum 5 agents allowed on your plan`. Documented as "same for everyone".
3. **`expiryAllowed` has no enforcement site either** (the dashboard offers an expiry date to every plan). Enforced set is exactly: `maxApiKeys` (active keys), `maxScopesPerKey` (create and update), `prodKeysAllowed`, `rotationAllowed`.
4. **A slow local server gives 502, not 504.** Published agent 1.0.19 hardcodes a 28 s local-call cap and ignores the hub's `timeoutMs`; on expiry it sends `BACKEND_UNAVAILABLE`, which the hub renders as 502 (only `AGENT_TIMEOUT` is 504). Source since 473b4ff honours the hub's budget (verified: 3 s budget, answer at 3.1 s); **published in agent 1.0.20 / next+middleware 1.0.5 (verified from npm 2026-09-21: 33 s request answered with a 60 s budget; 5 s budget gives `timeout of 5000ms exceeded`) and the docs now say so per version.** The 30 s to 504 sentence in Quickstart/Limitations/Webhooks was wrong before the hub change too; fixed.
5. **Published SDK 1.1.0 `TunnelClient` defaults to 30 s** (source: 120 s, unreleased). The `createClient` timeout is 30 s and independent of the hub's.
6. **Hub cert:** `hub.vhyxvoid.com` serves a valid cert (notAfter 2026-11-27, checked 2026-09-21), so the "certificate is still expired" launch gate in this file is resolved; the live quickstart re-run with a real key remains undone. Note for anyone testing from a machine with a stale resolver: `hub.` resolves to the origin there and nginx answers `403`; through Cloudflare's address it answers 200.

**Facts established for the pages (verified by running unless marked "code"):**
- Wrong key ID on the live hub: `❌ Fatal error: API key not found` then `Agent stopped.` (agent exits its loop). Fake-hub runs of agent 1.0.19 for `INVALID_SIGNATURE` (wrong secret), `SCOPE_MISSING` and `AGENT_LIMIT_REACHED`: the agent logs `hub error {...}` and **retries once a second indefinitely** (backoff resets; only `AUTH_FAILED`/`VERSION_UNSUPPORTED` stop it). `AUTH_FAILED` "Account is not active" stops it.
- The hub renders agent-side and hub-side failures as JSON `{error, status, tunnel:true}`; 502 messages seen: `Local backend on port N is not responding: <axios message>`, `Agent disconnected while processing your request`, `Failed to send request to agent`; 504 `Agent did not respond in time`.
- `vhyxvoid bogus` fails with `too many arguments for 'start'` (default command swallows the word); `--port abc` prints `Invalid port` and exits 1.
- SDK 1.1.0 (run): runtime exports are `createClient, VhyxvoidClient, ClientError, TunnelClient, TunnelError, TunnelTimeoutError`; `createClient` timeout throws a `DOMException` `TimeoutError` (not a `ClientError`); non-2xx throws `ClientError`; `TunnelClient` not connected throws `TunnelError AGENT_NOT_FOUND` (not retryable); a failed `connect()` throws a plain `Error`. `TunnelClient` local discovery sends the request straight to `127.0.0.1:<the discovered agent's backend port>` and ignores `label`/account.
- Code (not run against a real account): as of `internal-tools/shared/decision.md`, 2026-09-22 sessions S1/S4 (`c8b98e6`, `2465450`; both fixed in source, **not deployed**), the hub accepts agents whose account is `ACTIVE` **or `PAST_DUE`** (the seven-day grace period keeps tunnels running, not just plan limits) and re-checks every connected account roughly once a minute, evicting one that becomes non-connectable within that interval; the grace deadline is now actually set by the webhook, so `GracePeriodWorker`'s hourly sweep has something real to suspend. Until both are deployed, the deployed behavior is the OLD one this line used to describe (PAST_DUE refused outright, deadline never set). Members see/revoke/rotate only their own keys, admins and owners all keys; invitation links last 3 days and must be opened as the invited email; ownership transfer is a single click.
- Dashboard structure (code): sidebar lists ORGANIZATION accounts only, with Members/API Keys/Tunnels for all, Billing for owners, Settings for admins+; a personal-account-only user sees "Create organization". Tunnels page = active card (30 s refresh) + session history, no request list. Billing page's upgrade dialog hardcodes prices and feature bullets that do not match `PLAN_LIMITS` (not repeated in the docs).

**Not done / could not be done:** no browser walk-through of the dashboard; no run with a real API key on the live hub; `next`/`middleware` timeout and WS behavior were not run (agent and SDK only); Vite/socket.io/Next HMR through a real tunnel untested; whether production has the 120 s hub default or WS Phase 1 deployed is unknowable from the repo (pages hedge accordingly).

## Status of things the docs must describe (verified by reading source 2026-09-19)

All four packages are **published on npm at exactly the local versions**: `@vhyxvoid/agent` 1.0.18, `@vhyxvoid/sdk` 1.0.1, `@vhyxvoid/middleware` 1.0.3, `@vhyxvoid/next` 1.0.3 (`npm view`). So install docs describe real, installable packages, and "what the docs say" = "what the published tarball does" — not just the workspace.

`apps/web` already has a public `/docs` route that is a "Coming soon." placeholder (`apps/web/src/app/[locale]/(public-pages)/docs/page.tsx`), and `DashboardFooter.tsx` links to it (`target=_blank`). `/pricing` and `/support` are equally stubs (12-15 lines). See "Scaffolding" for what to do with the `/docs` link.

## Part 2 — Content inventory (what actually exists)

### SDK (`packages/sdk`, barrel `src/index.ts`, confirmed exports)
- **HTTP client (documented as primary)**: `createClient(config?)`, `VhyxvoidClient`, `ClientError`, types `ClientConfig`, `ClientResponse`. `ClientConfig`: `accountSlug` (env `VHYXVOID_ACCOUNT_SLUG`), `label` (default `default`, env `VHYXVOID_LABEL`), `baseUrl`, `hubDomain` (default `vhyxvoid.com`, env `VHYXVOID_HUB_DOMAIN`), `headers`, `timeout` (30000), `onRequest(req)`. Methods: `request`, `get(path, query?, headers?)`, `post/put/patch(path, body?, headers?)`, `delete(path, headers?)`, `getBaseUrl()`. Throws `ClientError(status, data, url)` on non-2xx. Body is `JSON.stringify`ed always; response parsed as JSON / `Buffer` (binary content-types) / text. **It is a plain `fetch` to `https://<slug>--<label>.<hubDomain>` — it uses no API key and does no signing.**
- **WebSocket client (secondary, no new features)**: `TunnelClient`, `TunnelError` (`code`, `retryable`), `TunnelTimeoutError`; types `TunnelClientConfig` (`hubUrl`, `keyId`, `secret`, `label?`, `timeout?`, `localDiscovery?`), `TunnelResponse` (`status`, `headers`, `body: string|Buffer|null`, `durationMs`, `isLocal`), `RequestOptions`. Methods: `connect`, `disconnect`, `request`, `get/post/put/patch/delete`, `isConnected`, `getSessionId`, `pendingCount`. **Takes the raw API-key secret in its config.** CORRECTED 2026-09-19: this used to say the decided use case is browser contexts. The SDK is Node-only (cannot be bundled for a browser; see shared decision.md, "SDK reclassified as Node-only"), so the docs say to keep the secret in server-side environment variables and never in client-side code.
- Not exported / must NOT be documented: `LocalAgentClient` (internal to TunnelClient's discovery), `blackserver-client.ts` (dead), `demo.js`.
- **The `@vhyxvoid/sdk/ws` subpath does not exist** (shared context Known Risk #12b still open): everything comes from the package root. Docs must document the *real* import, and this page must be revised in the same PR as any repackaging.

### Agent (`packages/agent`) — CLI `vhyxvoid` (bin → `dist/cli.js`)
- `vhyxvoid init` — interactive prompts (key ID, secret hidden, port, label, hub URL, account slug); writes `.env.vhyxvoid`, appends it to `.gitignore` (creates one if absent).
- `vhyxvoid [start]` (default command). Flags/env: `-k/--key` `VHYXVOID_API_KEY`; `-s/--secret` `VHYXVOID_SECRET`; `-p/--port` `VHYXVOID_PORT` (default 3000); `-l/--label` `VHYXVOID_LABEL` (default `default`); `--hub` `VHYXVOID_HUB_URL` (default `wss://hub.vhyxvoid.com/agent`); `--queue-path` `VHYXVOID_QUEUE_PATH` (default `~/.vhyxvoid/queue.db`); `--no-local-discovery` (disables port 4242 discovery server); `--write-env [file]` `VHYXVOID_WRITE_ENV` (default file `.env.local`); `--env-key` `VHYXVOID_ENV_KEY` (default `NEXT_PUBLIC_TUNNEL_URL`).
- `.env`, `.env.local`, `.env.vhyxvoid` are auto-loaded from cwd, last wins (`.env.vhyxvoid` overrides).
- Behavior worth documenting: reconnects automatically with exponential backoff 1s→300s; SIGINT/SIGTERM graceful stop; `uncaughtException` is logged, not fatal; needs `better-sqlite3` native binding (install can fail on machines without build tools — real troubleshooting entry). Library use: `import { AgentClient } from '@vhyxvoid/agent'` exists (advanced; **do not** document in v1 — middleware/next are the supported embedding path).
- Note: `vhyxvoid init`'s "Account slug (from dashboard)" is only needed by SDK consumers, not by the agent itself.

### Zero-config integrations
- `@vhyxvoid/middleware`: Express `app.use(vhyxvoid(opts?))` (root export `.`); Fastify `app.register(vhyxvoidPlugin)` from `@vhyxvoid/middleware/fastify`; Next `withVhyxvoid(nextConfig, opts?)` from `@vhyxvoid/middleware/next`. Options: `key`, `secret`, `port`, `label` (default `default`), `hub`, `writeEnv`, `envKey`, `onConnect(url)`, `enabled` (default: false when `NODE_ENV=production`). Peer deps express/fastify/fastify-plugin/next all optional.
- `@vhyxvoid/next`: `withVhyxvoid(nextConfig, options)` (named + default export). **Differs from the middleware/next variant** (Known Risk #14 duplication): default label `app` (vs `default`), auto-detects port from `-p/--port` in `npm_lifecycle_script` then `VHYXVOID_PORT`, `PORT`, 3000; only runs when in dev; prints a banner with the public URL; loads `.env`/`.env.local`/`.env.vhyxvoid` itself (does not override already-set vars). **The docs must pick one canonical Next.js path — recommendation: `@vhyxvoid/next` (richer, dev-only by design, Next-specific package) — and never present both as equal options.** Mention the other only as a Known-difference note if at all.
- Both run the agent **in-process** with `disableQueue: true` and `localDiscovery: false`; missing credentials → warns and does nothing (no crash). Started once per process (singleton guard).
- Middleware/Next runtime caveat with user-facing consequence: Known Risk #16 (tunnel may start during `next build`/CI) is open for `middleware/next`; `@vhyxvoid/next` gates on dev. Document the `enabled: false` / `NODE_ENV=production` escape hatch under CI troubleshooting.

### Tunnel URL model (what "the URL" is)
`https://<accountSlug>--<label>.vhyxvoid.com` (single label segment; `parseSubdomain` splits on `--`). Requests are forwarded to `127.0.0.1:<port>`. CORS preflight (`OPTIONS`) is answered by the hub itself, reflecting `Origin` with credentials allowed. Body limit **10 MB** (413). Hub timeout **30 s** (504). Status codes a developer will actually see: 404 no active tunnel, 503 label registered but agent not connected, 413 too large, 504 agent timeout, 400 malformed host. WebSocket upgrade through the tunnel exists (`tunnel:ws_open/message/close` in protocol) — **not verified end-to-end for docs purposes; verify before documenting WS support** (see backlog).

### Dashboard (`apps/web`, live routes)
Public: `/`, `/pricing` (stub), `/support` (stub), `/docs` (stub). Auth: `/register`, `/login`, `/verify-email`, `/verify-email-sent`, `/forgot-password`, `/reset-password`, `/invitations/accept`. App: `/dashboard`, `/profile` (profile edit, change password, feedback history), `/organizations/[accountId]/{members,tunnels,api-keys,billing,settings}`. Global: notification bell, feedback button (types + free text; history under Profile).
- **API keys**: create (name, description, environment DEV/PROD, scopes, optional expiry), secret shown once in a dialog, list (name, key ID copy, env, status ACTIVE/REVOKED/EXPIRED, scopes, last used, expires), rotate (1 h grace window with old secret still valid — `ROTATION_GRACE_MS`), revoke. Scopes: `tunnel:connect|read|write`, `webhook:receive|inspect`, `metrics:read`, `*`. Key ID prefix `vhyxvoid_dev_`/`vhyxvoid_live_`.
- **Tunnels**: read-only table (agent, status, API key, connected, duration) plus usage.
- **Organizations/members**: create org, invite by email (roles offered in UI: Member, Admin), change role, transfer ownership, remove, cancel invitation; accept via emailed link. Account types PERSONAL / ORGANIZATION.
- **Billing**: flat-rate FREE/PRO/ENTERPRISE via Stripe Checkout + customer portal, subscription status (TRIALING/ACTIVE/PAST_DUE/CANCELED), invoices. No metered billing (decided 2026-09-13). `PAST_DUE` has a **7-day grace period** (`GRACE_PERIOD_DAYS`) after which the account is `SUSPENDED` and drops to FREE limits.
- **Feedback & notifications**: as above.
- Locale-prefixed routes (`next-intl`); the dashboard UI copy is English.

### Real limits and what is actually enforced (READ BEFORE WRITING ANY LIMITS TABLE)
`PLAN_LIMITS` (`apps/api/.../billing/domain/enums/index.ts`) declares: FREE / PRO / ENTERPRISE — agents 1/5/∞, requests-per-month 1,000/50,000/∞, members 1/10/∞, API keys 3/20/∞, scopes-per-key 2/10/∞, **rate limit per minute per key 60/1,000/∞**, environments DEV / DEV+PROD / DEV+PROD, rotation ✗/✓/✓, key expiry ✗/✓/✓, analytics retention 7/90/365 days, custom domains ✗/✓/✓. Reading enforcement sites directly (2026-09-19) shows **a large part of this table is not enforced today**:

| Limit | Enforced? | Evidence |
|---|---|---|
| Max API keys, scopes/key, PROD keys (FREE=DEV only), rotation allowed | **Yes** (API, at create/update/rotate) | `CreateApiKey`/`UpdateApiKey`/`RotateApiKey` use cases |
| Rate limit/min/key | **Partly** — enforced in `ValidateApiKeyUseCase`, which only runs for agent registration and SDK-WS requests; **never on public subdomain HTTP traffic** (`HttpTunnelHandler` does no key validation). Also `rowToCache()` sets `-1` (unlimited) on a Redis cache-miss DB fallback (`packages/shared/src/validateApiKey.ts:219`, a `TODO`); the real value is only seeded into the cache at key create/rotate | code |
| Concurrent agents | **Hub enforces `PLAN_AGENT_LIMITS.PRO` (5) for everyone** (`Message.router.ts:221`), i.e. FREE's documented 1 is not applied | code |
| Max members, requests/month, custom domains, retention | **No enforcement site found** (`planLimitGuard` supports `maxAgents`/`maxApiKeys`/`maxMembers` but only `maxApiKeys` is wired) | grep |

**UPDATE 2026-09-21: the rate-limit row above is too generous; see the corrections list in "Reference, SDK, dashboard and troubleshooting" below.**

**Docs rule:** the generated limits table (Part 4) lists only limits on an explicit "enforced" allowlist; everything else is left out or listed under "plan allowances (not currently enforced)" **only if the product owner decides that's desirable**. Do not publish `PLAN_LIMITS` wholesale. This also means `internal-tools/api/context.md` Known Risk #4 ("rate limiting is enforced end-to-end") is over-broad — see backlog.

### Known limitations that DO cross into user docs (upfront, "Limitations" page)
1. **Inbound replay gap** (hub Known Risk #3, accepted 2026-09-12): a request sent while the agent is reconnecting and not answered within the 30 s pending window gets 504 and is never replayed. GET is safe to retry; POST/PUT/PATCH/DELETE may have executed on your backend even though the caller saw an error → make handlers idempotent. Do not claim "requests survive disconnects" (the hub decision's own trigger condition).
2. **Public tunnel URLs are unauthenticated.** Anyone who knows/guesses `slug--label.vhyxvoid.com` reaches your local backend; the HTTP client sends no credentials and the hub checks none. Tunnel your dev server only, protect sensitive routes in your own app, don't tunnel anything holding real data.
3. **Local response cache keys on path+query only** (Known Risk #5) — affects agents used in shared/CI environments; **verify at writing time whether it is user-visible** (which responses are cached and for how long) before choosing to document it.
4. **Local discovery (port 4242)** is unauthenticated by design (accountIdHash never populated) — mention only under `--no-local-discovery`.
5. **The SDK is Node.js only** (2026-09-19 correction of "TunnelClient secret in browser"): documented as a flagged section on the Limitations page.
6. Single hub instance, no HA (`HubPubSub` stub) — **not** a user-doc item beyond a generic "no SLA" line; don't document internals.
7. Email verification is not enforced at login (API Known Risk #1) — **do not document** as a feature ("verify your email" wording must not promise enforcement).
8. Plan enforcement gaps above — **do not document as a feature**.

**Stays OUT of user docs (internal engineering debt):** two-auth-scheme split, duplicated integration logic, the `ValidateApiKeyUseCase` unification story, admin RBAC, Turbopack/VhyxUI linking, MUI removal, test infra, ts-node-dev zombies, dead code.

**Live-production issue that gates a public docs launch:** shared context Known Risk #2 — the hub/api TLS cert (`*.vhyxvoid.com`) **expired 2026-08-03** (as of last live check 2026-09-12; needs re-verification). A docs site telling people to `wss://hub.vhyxvoid.com/agent` is not launch-ready while that stands. Re-check with `openssl s_client` at the start of the scaffolding session.

## Part 3 — Information architecture

Route root `/` on `docs.vhyxvoid.com` (no `/docs` prefix inside the app). Structure is exactly what the inventory warrants; nothing is included that has no source content.

```
/                              Landing: what VhyxVoid is (1 screen), 3 paths (CLI / Express-Fastify / Next.js), links
getting-started/
  quickstart                   Account → API key → run the agent → hit the URL (CLI path, the shortest end-to-end)
  concepts                     Agent, hub, label, account slug, tunnel URL shape, key vs. secret, DEV/PROD
  installation                 npm package matrix (agent/sdk/middleware/next), Node version, better-sqlite3 note
integrations/
  express                      @vhyxvoid/middleware
  fastify                      @vhyxvoid/middleware/fastify
  nextjs                       @vhyxvoid/next (canonical); env/.env.local write-back; CI/production behavior
  standalone-cli               vhyxvoid init/start for any stack (Django/Rails/etc. — anything on a local port)
  webhooks                     Using the URL as a webhook target (Stripe/GitHub); only what's verifiable — see backlog
cli/
  reference                     GENERATED (commands, flags, env vars)
  configuration                 .env precedence, .env.vhyxvoid, --write-env, multiple labels
sdk/
  overview                      HTTP client vs. WS client — which to use (HTTP default)
  http-client                  createClient guide (hand-written) + reference (GENERATED from TSDoc)
  websocket-client             TunnelClient guide + prominent secret-exposure warning + reference (GENERATED)
  errors                       ClientError / TunnelError codes (GENERATED code list, hand-written meaning)
dashboard/
  account-and-organizations    Personal vs. org account, create org, settings
  api-keys                     Create, scopes, environments, expiry, rotation grace, revoke
  tunnels                      Reading the tunnels table & usage
  members-and-roles            Invite, roles, transfer ownership
  billing                      Plans, Checkout/portal, PAST_DUE grace, invoices
  feedback-and-notifications   (short)
reference/
  plans-and-limits             GENERATED, enforced-allowlist only
  scopes                       GENERATED from ApiScope
  environment-variables        GENERATED from a manifest, cross-checked by test
  http-status-codes            Statuses the tunnel returns (404/503/413/504/400) — hand-written, verified
troubleshooting/
  index                        Symptom → cause table
  faq                          Short answers, each linking to the owning page
limitations                    The 8-item list above minus internal-only ones — honest, upfront
changelog                      Per-package changelog (link to npm/GitHub releases until a real source exists)
```

Deliberately NOT proposed yet: a public REST API reference (apps/api has zod schemas but no OpenAPI spec/`@fastify/swagger`, and its consumer is apps/web, not third-party developers); a self-hosting guide (Dockerfiles exist but self-hosting isn't a stated product surface — separate audience decision); a versioned docs switcher (only one version of every package is current — add when a second major exists); i18n (dashboard is next-intl but docs are English-only for v1); a blog.

## Part 4 — Content-freshness approach

**Principle: a docs claim is either derived by a script that reads the source, or carries a machine-checkable pointer to the source it was verified against. No third kind.**

### A. Generated / derived (never hand-edited; a `generated: true` banner in each file's header; CI fails if regenerating produces a diff)
| Content | Source of truth | Mechanism |
|---|---|---|
| SDK reference (`createClient`, `VhyxvoidClient`, `ClientConfig/Response`, `ClientError`, `TunnelClient`, `TunnelClientConfig/Response`, errors) | `packages/sdk/src/index.ts` barrel → exported symbols only | TypeDoc JSON entry-pointed at the barrel (so only real exports appear, catching the `LocalAgentClient`/legacy-client leakage class), rendered by `fumadocs-typescript`/a small MDX emitter. **Prerequisite: add TSDoc (`@param`/`@example`) — `client.ts` has partial JSDoc, `TunnelClient` little** |
| CLI reference (commands, flags, defaults, env) | `packages/agent/src/cli.ts` commander program | Build step runs the built `dist/cli.js --help` and `start --help` and parses to MDX. (cli.ts calls `parse()` at import so it cannot be imported — shell out instead.) Fallback if parsing proves brittle: refactor `cli.ts` to export `buildProgram()` |
| Plans & limits (enforced only) | `PLAN_LIMITS` + `apps/docs/content-config/enforced-limits.json` allowlist | Script imports `PLAN_LIMITS`, emits only allowlisted keys, and **fails if a key is added to `PlanLimits` without being classified enforced/unenforced** — forces the enforcement question the first time someone adds a limit |
| API-key scopes | `ApiScope` enum (`apikey.constant.ts`) | Import + emit table (hand-written description column keyed by enum value; script fails on an unmapped value) |
| Env var reference | `VHYXVOID_*` reads across `packages/{agent,middleware,next,sdk}/src` | Hand-authored `env-vars.json` manifest (name, description, default, applies-to) **plus** a test that greps the four packages for `VHYXVOID_[A-Z_]+` and fails on any name absent from the manifest or vice-versa |
| Protocol error codes surfaced to users | `packages/protocol` error enums | Import + emit code list; meanings hand-written and keyed |
| Package versions/install snippets | each `package.json` `version` | Interpolated via a tiny MDX variable (`<Version pkg="sdk"/>`), never typed |

Not proposed for generation: dashboard screens (no schema to derive from — hand-written + verified), and the REST API (no spec exists).

### B. Hand-written content: frontmatter contract + drift checker
Every hand-written page's frontmatter:
```yaml
verified:
  date: 2026-09-19
  commit: <short sha of Black-Server at verification>
  packages: { "@vhyxvoid/sdk": "1.0.1", "@vhyxvoid/next": "1.0.3" }
sources:                    # files whose behavior this page asserts
  - packages/next/src/index.ts
  - packages/agent/src/cli.ts
```
`pnpm --filter @vhyxvoid/docs check:fresh` (a script, run in CI **and** referenced from the root CLAUDE.md):
1. For each page, `git log <verified.commit>..HEAD -- <sources...>`; any commit → page reported **stale** (fails CI on pages, warns on PRs that don't touch docs).
2. `verified.packages` must equal current `package.json` versions for pages on published surface, or the page is stale (forces a re-read on every publish).
3. Every `sources` path must exist (catches renamed/deleted files — the "docs drifted from reality" failure this project has had for dozens of sessions).
4. Pages without `verified`/`sources` fail the build.
Marking a page fresh is a deliberate act: re-read the sources, update `verified.commit/date`. A rendered "Last verified against v1.0.1 · <date>" footer makes the claim visible to readers.

### C. Code samples must compile
All fenced `ts`/`tsx` samples are extracted (`fumadocs-mdx` remark hook or a script) into `apps/docs/.generated/samples/` and typechecked against the real workspace packages in CI (`tsc --noEmit`, using the workspace `@vhyxvoid/*` builds). Samples that can't compile (pseudo-code) must be marked ```` ```ts no-check ````, which is grep-able and counted. This is the single highest-value check — the SDK examples are the most likely thing to rot.

### D. Process hooks (the "sessions" half)
- Add to `.claude/CLAUDE.md` (a one-line addition, done in the scaffolding session): *"If your task changes anything under `packages/{agent,sdk,middleware,next}`'s public surface, `apps/web`'s dashboard features, or `PLAN_LIMITS`, run `pnpm --filter @vhyxvoid/docs check:fresh` and update or re-verify every page it flags, in the same session."*
- The same rule is a checklist line in `internal-tools/docs/backlog.md` conventions.
- Release rule: publishing any of the four packages requires a green `check:fresh` (add to the packages' `prepublishOnly`? — no, keep out of package scripts to avoid coupling; a CI job on tags instead).

## Part 5 — Scaffolding plan (for the next session)

**Location/name:** `apps/docs`, `@vhyxvoid/docs`, `private: true`, `"license": "Commercial"` if that's what `apps/admin`/`apps/web` use (copy their field verbatim).
**Port:** **4002** (`next dev --turbopack -p 4002`). 4000 web, 4001 admin, 9000 api, 9001 hub, 4242 agent discovery; grep confirmed nothing else references 4002. **No `apps/api` CORS edit needed (confirmed as built)** — the docs site makes no browser calls to apps/api (static content). Do not add 4002 to `allowedOrigins`.
**Framework:** Fumadocs v16 (see `decision.md`). **[Superseded 2026-09-19: Next 16.1.1 and Tailwind 4.1.17 do NOT work with Fumadocs — docs pins Next 16.3.4 / Tailwind 4.3.3. See "Current state".]** Search: Fumadocs' built-in Orama search served from a route handler (static export at build) — no external service, no keys.
**Monorepo conventions (mirror apps/admin exactly):**
- `pnpm-workspace.yaml` already globs `apps/*` → no change. Root `package.json` add `"dev:docs"` and `"build:docs"` scripts (same shape as `dev:admin`/`build:admin`). `turbo.json` needs no change (`apps/*/.next/**` output already added, uncommitted in the working tree at time of writing — do not revert it).
- Excluded from the root TS project-reference graph and root ESLint flat config; own `tsc --noEmit` `typecheck` script and own ESLint config (same rationale as `apps/web`/`apps/admin`).
- **CI**: `.github/workflows/ci.yml` currently excludes `@vhyxvoid/web` from install/typecheck/build (needs sibling VhyxUI checkout). Extend the same exclusion pattern to `@vhyxvoid/admin` if not already, and **only add `@vhyxvoid/docs` to the CI-covered set if it has no `link:` deps** (see next point). This is the deciding reason to keep VhyxUI out of the v1 dependency list.
**VhyxUI usage — recommended: theme by CSS tokens only, no `@vhyxui/react` in v1.**
- Fumadocs UI is styled via CSS variables (`--color-fd-*`) on Tailwind 4; map them once in `globals.css` to VhyxUI's tokens (`@vhyxui/tokens`) so colors, radii, and fonts match. That satisfies "looks like VhyxUI" for sidebar/TOC/search/code blocks without rebuilding those components.
- `@vhyxui/tokens` is still consumed via `link:../../../VhyxUI/packages/tokens` (established convention, don't rediscover) — which brings back the sibling-checkout requirement. **Open question for the user (see below): does the docs deploy (Vercel/CI) have both repos?** Two ways out if not: (1) copy the small generated token CSS into `apps/docs/src/styles/vhyxui-tokens.css` with a header noting its origin and a `sync-tokens` script (recommended fallback: docs are public and deployed independently of the dashboard), or (2) check out VhyxUI in CI. Decide in the scaffolding session before `pnpm install`.
- Custom/interactive MDX components (Callout, Tabs for package managers, copy button) use Fumadocs UI's; use `@vhyxui/react` (via `'use client'` wrappers, per the established rule that VhyxUI components aren't RSC-safe) only where Fumadocs lacks a component and only if VhyxUI is linked at all.
**Directory layout:**
```
apps/docs/
  package.json  next.config.ts  source.config.ts  postcss.config.mjs  tsconfig.json
  content/docs/**.mdx  (+ meta.json per folder for ordering)
  scripts/  gen-cli-ref.ts  gen-sdk-ref.ts  gen-limits.ts  gen-scopes.ts  check-fresh.ts  check-env-vars.ts  extract-samples.ts
  content-config/  enforced-limits.json  env-vars.json
  src/app/(docs)/[[...slug]]/page.tsx  src/app/api/search/route.ts  src/app/layout.tsx  src/app/globals.css
  src/lib/source.ts
```
Generated MDX lives in `content/docs/**/_generated/` (committed — reviewable diffs, CI verifies regeneration is a no-op).
**`turbopack.root`:** only needs the `apps/web`-style widening if VhyxUI is `link:`ed; if tokens are copied in, leave the default.
**[Superseded 2026-09-19: docs origin is `/docs` under apps/web, proxied by a rewrite — see "Current state" > Routing. The placeholder page is kept as the unset-`DOCS_ORIGIN` fallback.]** Original text: leave the placeholder untouched; recommended origin `docs.vhyxvoid.com`. Consequences to handle: (a) hub's `HttpTunnelHandler.isTunnelRequest()` treats **every** `*.vhyxvoid.com` host as a tunnel request, so `docs.` must be routed by nginx/the host before it reaches the hub (nginx `server_name` blocks already do this for `api.`/`hub.`; if docs is deployed to Vercel via DNS, the hub never sees it — confirm DNS isn't a wildcard pointing at the hub box); (b) `docs` and other product hostnames (`api`, `hub`, `admin`, `app`, `www`) should be reserved against account-slug collisions — subdomain format is `slug--label`, so the double-dash keeps real collisions unlikely, but confirm no slug validation permits a bare hostname form.
**Deployment:** not decided here; static export (`output: 'export'`) is viable for a docs-only site and removes any server. Deferred to the scaffolding session, with the TLS issue above resolved first.

### Docs-writing sequencing (suggested session breakdown)
1. **Prereq fixes (small, outside apps/docs):** see "Prerequisites" below.
2. **Scaffold session:** empty app, Fumadocs wired, theming via tokens, search working, three stub pages, `internal-tools/docs/*` kept current, CI/`check:fresh` skeleton, CLAUDE.md line.
3. **Generators session:** the six scripts + TSDoc pass over `client.ts`/`types.ts`/`TunnelClient.ts`.
4. **Content session(s):** Getting Started + integrations + limitations first (highest value/risk), then dashboard guide (needs a live walk-through of `apps/web` against the local dev backend, per `LOCAL_DEV_BACKEND.md`), then troubleshooting.

### Prerequisites the docs cannot honestly paper over (real bugs found while reading source; filed in shared backlog)
1. `packages/sdk/package.json` `exports["."].import → ./dist/index.mjs`, but the build (`tsc -b`) never emits `.mjs` — an ESM `import { createClient } from '@vhyxvoid/sdk'` **may fail to resolve for real npm consumers** (shared Known Risk #12 noted this as "unrelated"; for a docs site it's the first thing a reader would hit). Verify against the published 1.0.1 tarball (`npm pack`/install in a scratch dir) before writing the SDK quickstart.
2. `packages/sdk/package.json` depends on the npm package `crypto@^1.0.1` (a deprecated placeholder for Node's built-in) and `ws`/`isomorphic-ws` — install noise readers will ask about; verify if it's actually imported.
3. The `packages/sdk/src/demo.js`/`blackserver-client.ts` shipping in `dist` (`files: dist/**`) — visible in the published package; low priority.
4. TLS cert expiry (above).
5. Decide the canonical Next.js package (`@vhyxvoid/next` vs `middleware/next`) — see recommendation.

## Open Questions (for the user; answers change the plan)

**Answered 2026-09-19 (locked by the user):** #2 (unenforced limits stay out of public docs), #3 (`@vhyxvoid/next` is the sole Next.js path; middleware is Express/Fastify only), #4 (docs origin is `/docs` under apps/web), and #1's token half (tokens are copied, not linked). **Still open, needs the user:** where apps/docs (and apps/web) are actually deployed — i.e. what `DOCS_ORIGIN` is in production, and whether apps/web's host can reach it.

Original list (kept):
1. **Where will docs deploy, and does that environment have the sibling VhyxUI checkout?** Determines token-copy vs. `link:`, and whether `apps/docs` can be in CI. (Recommendation: copy tokens, keep docs buildable from this repo alone.)
2. **Should not-enforced plan allowances (members, requests/month, retention, custom domains) appear in public docs at all?** (Recommendation: no, until enforced.)
3. **Canonical Next.js integration:** confirm `@vhyxvoid/next` (recommended) so the other can be de-emphasized/deprecated later.
4. **Public docs origin:** `docs.vhyxvoid.com` (recommended) vs. `vhyxvoid.com/docs` via a rewrite in `apps/web`.
