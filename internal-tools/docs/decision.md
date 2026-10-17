# Decision Log — apps/docs

**Append-only. Never edit or delete an existing entry.** If a decision is later reversed, add a new entry that says so and references the original — don't rewrite history.

**Scope: apps/docs, the external developer/product documentation site (planned, not yet scaffolded).**

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

### 2026-09-19 — Docs framework: Fumadocs (core + mdx + ui), themed via VhyxUI tokens

**Decided by:** Claude Code (investigation-and-plan session; recommendation, pending user confirmation of the open questions in `context.md`)
**Context:** First-ever scoping of an external docs site. Brief: stay in the Next.js ecosystem unless compelling reason not to; weigh Fumadocs, Nextra, custom Next+MDX; judge each on (a) matching VhyxUI, (b) generated vs. hand-written content, (c) maintenance, (d) monorepo fit.
**Research basis and its limits:** web research this session (Fumadocs v16 docs/blog, Nextra 4 docs/guild post) plus reading this repo. I did not install or build either framework, so claims about theming effort are from documentation and architecture reasoning, not a spike. The scaffolding session's first hour should be the spike that confirms them (see Status).
**Options considered:**
1. **Fumadocs v16.** Requires Next 16 (matches `apps/web`/`apps/admin`'s 16.1.1). Three separable layers: `fumadocs-core` (headless: source/loader, page tree, search, TOC, i18n), `fumadocs-mdx` (content pipeline), `fumadocs-ui` (default layout built on Tailwind 4, styled through `--color-fd-*` CSS variables). Built-in Orama search (route handler; Algolia optional). Ecosystem for generated content: TypeDoc/`fumadocs-typescript` (type tables/auto-type from source), `fumadocs-openapi` (irrelevant today — no OpenAPI spec exists), Twoslash.
   (a) Theming: map ~a dozen `--color-fd-*` variables onto `@vhyxui/tokens`; the layout, sidebar, TOC and search dialog stay Fumadocs'. It will *resemble* VhyxUI (color/type/radius) but won't be VhyxUI *components*. If exact component parity ever matters, the headless `fumadocs-core` layer lets us swap layout pieces for VhyxUI ones one at a time without abandoning the pipeline — an escape hatch neither other option has. (b) Best fit of the three: generated pages are just MDX files emitted by scripts into the content tree. (c) Active, v16 in 2026, steady cadence; risk is major-version churn (v15→v16 was a Next-major-coupled bump). (d) Same Next/React/Tailwind versions as the existing apps; `apps/*` glob and port scheme unchanged.
2. **Nextra 4.** App Router only, Pagefind search (needs a post-build indexing step), Tailwind 4 theme with an `x:` class prefix, `theme.config` removed in favor of props.
   (a) Its docs theme is a packaged unit; restyling means overriding a prefixed Tailwind layer and its components — more of a fight than remapping variables, and no headless layer to fall back to. (b) MDX-first; nothing comparable to `fumadocs-typescript` for source-derived reference, so we'd write the same generators but with fewer hooks. (c) Simpler surface but a smaller design-flex ceiling; Pagefind adds a build step. (d) Fits fine mechanically. Not chosen because it saves effort only if we accept default looks, which contradicts requirement (a).
3. **Custom Next.js + MDX (`@next/mdx`/`next-mdx-remote`) with VhyxUI components directly.** Perfect visual match, but we would build and then maintain navigation/sidebar tree, TOC extraction, full-text search, syntax highlighting, MDX component mapping, and (later) versioning. VhyxUI's components also aren't RSC-safe (must sit behind `'use client'`), which makes an MDX-rendered docs page — mostly server components — awkward. Rejected: it is Fumadocs-core minus Fumadocs-core.
4. **Others (not investigated beyond a glance, by design):** Docusaurus (React but not Next; separate build/runtime and design system → contradicts monorepo precedent), Mintlify (hosted/closed, ongoing cost, no local source-derived generation), Starlight/Astro (non-React). No compelling reason found to leave the Next.js ecosystem.
**Decision:** Fumadocs: `fumadocs-core` + `fumadocs-mdx` + `fumadocs-ui`, restyled by mapping its CSS variables to VhyxUI tokens; no `@vhyxui/react` components in v1. Content pipeline is our own generators feeding MDX (see `context.md` Part 4).
**Rationale:** Passes all four criteria with the least fighting; the headless-core layer converts the "custom build" option from a rewrite into an incremental migration path; it is the only candidate whose ecosystem directly serves the "generated from source" requirement this project's documentation history makes non-negotiable.
**Status:** active, **conditional on a spike** — first task of the scaffolding session: install, map tokens, confirm (1) light/dark token mapping works with VhyxUI's theming attribute (`data-theme`, per apps/web), (2) the Orama search route works under `output: 'export'` if static export is chosen, (3) Twoslash/TypeDoc pipeline works with the workspace packages. If any of the three fails badly, re-open this entry with a superseding decision rather than working around it.

---

### 2026-09-19 — Freshness contract: derive from source or carry a machine-checkable source pointer; no unchecked prose

**Decided by:** Claude Code (proposal, pending user confirmation)
**Context:** The project's own history is dozens of context.md corrections for claims that drifted from code (e.g. JWT keys "dead" when live; rate limiting "stub" then "enforced" — and this session found "enforced" is itself over-broad). External docs go to strangers who cannot flag a wrong claim.
**Options considered:** all hand-written with periodic audits; all generated; hybrid with enforced metadata.
**Decision:** hybrid — generate what has a machine-readable source (SDK reference, CLI reference, scopes, enforced-limits table, env vars, versions); every hand-written page carries `verified.{date,commit,packages}` + `sources[]` frontmatter checked by `check:fresh` (git-log since verified commit on the source paths; package-version match; path existence); code samples type-checked in CI; a one-line rule in `.claude/CLAUDE.md` binds future sessions that touch the documented surface.
**Rationale:** audits rely on someone remembering; a failing check doesn't. Cost is frontmatter discipline and false-positive staleness (any commit touching a source file flags the page even if irrelevant) — accepted deliberately: a cheap re-verify beats a silently wrong page.
**Status:** active

---

### 2026-09-19 — Never publish `PLAN_LIMITS` wholesale; docs list only enforced limits

**Decided by:** Claude Code (proposal, pending user confirmation — Open Question 2)
**Context:** Reading enforcement sites showed max API keys/scopes/PROD keys/rotation are enforced at the API; the hub applies the PRO agent limit (5) to every plan; per-minute rate limiting runs only on key-validated paths (not public subdomain HTTP traffic) and falls back to unlimited on a cache-miss DB load; members/requests-per-month/retention/custom-domains have no enforcement site found.
**Decision:** the generated limits page reads `PLAN_LIMITS` through an allowlist of enforced keys and fails the build when `PlanLimits` gains an unclassified key. Unenforced allowances are omitted (not published as promises).
**Rationale:** documenting an unenforced limit either promises something not delivered (or, if later enforced, surprises users) — a docs-created contract we would then have to honor. Enforcement gaps themselves are filed to backlog, not fixed here.
**Status:** active

---

### 2026-09-19 — Canonical Next.js integration in docs: `@vhyxvoid/next`; TunnelClient documented with a secret-exposure warning; internal-only risks excluded

**Decided by:** Claude Code (proposal)
**Context:** Two divergent Next.js integrations exist (Known Risk #14): `@vhyxvoid/next` (default label `app`, port auto-detect, dev-only, banner) and `@vhyxvoid/middleware/next` (label `default`, no port detection, no dev-only gate beyond `NODE_ENV=production`).
**Decision:** document `@vhyxvoid/next` as the one Next.js path; don't present both as peers. Document `TunnelClient` honestly (browser use puts the API secret in the bundle) instead of hiding it. The "user-facing consequence" line: include inbound-replay gap, unauthenticated public URLs, plan-enforcement facts, 30 s/10 MB limits; exclude the auth-scheme split, admin RBAC, duplicated code, and tooling debt.
**Rationale:** two equal options forces readers to choose without information we already have; honest security framing costs less than the first incident; internal debt has no reader action attached.
**Status:** active

---

### 2026-09-19 — Scaffolding conventions: `apps/docs`, `@vhyxvoid/docs`, port 4002, tokens-only theming, no CORS change

**Decided by:** Claude Code (proposal)
**Context:** Match the `apps/web`(4000)/`apps/admin`(4001) conventions; 4002 unused (grepped); the docs site makes no browser calls to apps/api.
**Decision:** as titled; depend on VhyxUI *tokens only*, and prefer copying the token CSS into the app (with a `sync-tokens` script) over a `link:` if the deploy environment lacks the sibling VhyxUI checkout, so `apps/docs` can be built and CI-covered from this repo alone (apps/web is excluded from CI precisely because of the sibling-repo requirement).
**Rationale:** a public docs site should not be undeployable without a private sibling repo. This is a deliberate exception path to the "established pattern for any future workspace" VhyxUI linking convention, taken only if Open Question 1's answer requires it — and logged here so it isn't mistaken for drift.
**Status:** active, pending Open Question 1

---

### 2026-09-19 — Scaffold session: Fumadocs confirmed by a real spike, with docs pinned to a newer Next/Tailwind than web/admin

**Decided by:** Claude Code (executing the locked decisions from the user's brief; the version deviation below is this session's judgment call)
**Context:** The 2026-09-19 framework decision was conditional on a spike, because it rested on documentation reading only. The brief said: if the spike contradicts the plan, stop and report rather than push through a framework that doesn't fit.
**What the spike found (real installs, real builds, in a scratch dir then in the repo):** `fumadocs-mdx` 15.4.1's Turbopack rule is rejected by Next 16.1.1 (the version apps/web/admin use); Next 16.2.0 parses it and 16.3.4 builds. Fumadocs' preset CSS needs Tailwind >= 4.2 (4.1.17 fails on `-inset-s-4`; 4.3.3 works). Theming via `--color-fd-*` -> `--vhyx-color-*` works, after handling `--color-fd-diff-*` and VhyxUI's trailing global reset (see context.md "Current state").
**Options considered:** (1) stop and report at the version finding; (2) proceed with docs on Next 16.3.4/Tailwind 4.3.3 while web/admin stay put; (3) upgrade web/admin to match; (4) `next build --webpack` on 16.1.1 (tried; fails on the Tailwind version anyway).
**Decision:** (2), and proceed despite the brief's stop-and-report clause. **This is a judgment call on how to read that clause:** the clause's stated concern is "a framework that turns out not to fit". Here the framework fits; only two dependency pins differ, in an app with its own isolated dependency graph (no shared runtime, CSS, or code with web/admin), fully reversible, and the theming claim — the actual fit question — was confirmed. Stopping would have cost a round trip for a decision with one sensible answer. Flagged prominently in the report so it can be overruled. Option (3) was rejected as out of scope and risky (it would touch two production-facing apps for the sake of a docs site).
**Rationale / how to apply:** never "align" docs down to web/admin's Next/Tailwind versions — it breaks the build; bump docs independently. If web/admin later move to Next >= 16.2 and Tailwind >= 4.2, the difference disappears.
**Status:** active

---

### 2026-09-19 — Docs theme: dark-only, VhyxUI tokens + apps/web's brand override copied (not linked), reset stripped

**Decided by:** Claude Code (implements the user's locked "copy VhyxUI's token CSS, don't link" decision; the details are judgment calls)
**Context:** "Match VhyxUI" needed a definition. The dashboard is `data-brand="vhyxvoid"`, whose "light" mode is near-black; its dark mode is only slightly different.
**Options considered:** copy tokens only; copy tokens + brand override; light/dark toggle; dark-only.
**Decision:** copy both `@vhyxui/tokens/index.css` (0.1.3-alpha) and `apps/web`'s `vhyxui-brand-override.css` into `src/styles/` via `scripts/sync-tokens.mjs` (manual, needs the sibling repo, deliberately not part of build/CI). The tokens copy drops the trailing `reset.css` section, which zeroes all margins/padding and wrecks Fumadocs' layout (observed, not assumed). Site is dark-only (`data-theme="dark"`, `forcedTheme: 'dark'`, no toggle) since the product has no true light mode.
**Rationale:** copying only tokens would give a generic purple-on-slate look that doesn't match the dashboard; a toggle would present a mode the product doesn't have. **Cost accepted:** two copied files can drift from VhyxUI/apps/web — header comment in each says so and how to refresh; no automated drift check yet (backlog).
**Status:** active

---

### 2026-09-19 — Server-mode docs app; `/docs` proxied from apps/web via `DOCS_ORIGIN`, placeholder kept as the unset fallback

**Decided by:** Claude Code (mechanism); the `/docs` under apps/web origin was locked by the user
**Context:** Part 4 asked whether a clean rewrite is achievable given the documented deployment. Investigated directly: `nginx.conf` has server blocks only for `api.vhyxvoid.com` and `hub.vhyxvoid.com`; `docker-compose.yml` has no web service; no Dockerfile, CI job, or doc records where apps/web is hosted. So the destination URL cannot be derived from the repo.
**Options considered:** (a) hardcode a production URL (would be invented); (b) omit routing and report the gap; (c) implement the mechanism against an env var and report the missing production value.
**Decision:** (c). `apps/docs` uses `basePath: '/docs'` (so pages, `/_next` assets, and the search API all live under `/docs` on the shared origin), runs as a Next server (`next start -p 4002`) rather than a static export (a rewrite proxies HTTP either way, and server mode avoids static-host URL quirks like `.html` vs clean URLs and basePath-unaware `fetch`). `apps/web/next.config.ts` registers `beforeFiles` rewrites only when `DOCS_ORIGIN` is set (defaults to `http://localhost:4002` outside production); `src/proxy.ts` skips next-intl for `/docs` when the rewrite is active. In production with `DOCS_ORIGIN` unset there is no rewrite, the build warns, and the pre-existing "Coming soon" page serves — a visible failure, not a proxy to nothing.
**Rationale:** the mechanism is fully verified locally against a real production build of apps/web; only one deploy-time value is unknown, and it is one env var, named and documented (apps/web/README.md). The alternative of silently shipping a rewrite to a guessed origin is what the brief explicitly asked not to do.
**Known limits:** rewrites are baked at `next build`, so `DOCS_ORIGIN` must be present at build time, not just runtime. `/fr/docs` still hits the placeholder. If apps/web is deployed to a platform with its own rewrite/proxy layer (or behind nginx), that layer can serve `/docs` instead and this rewrite is redundant but harmless.
**Status:** active — **needs the user's answer on production topology** (context.md, Open Questions)

---

### 2026-09-19 — Getting Started documents the real, currently-broken SDK ESM import; hub cert expiry gates launch, not docs content

**Decided by:** Claude Code
**Context:** Verifying the walkthrough against the published tarballs confirmed `import { createClient } from '@vhyxvoid/sdk'` fails (`ERR_MODULE_NOT_FOUND`). Separately, `hub.vhyxvoid.com`'s cert was still expired on 2026-09-19.
**Decision:** the quickstart shows `require()` (and `createRequire` for ES modules) with a warning callout, and Limitations lists the ESM issue — instead of writing the "obvious" `import` example that a reader would copy and see fail. Not fixed in this session: it needs a source change plus a new npm publish of a package with pre-existing uncommitted local edits (`packages/sdk/package.json`), outside this brief. The cert expiry is *not* written into public docs (an operational incident is not product documentation); it is recorded as a launch gate in context.md instead. When the SDK is republished with a working ESM entry, revise the quickstart callout, the Limitations item, and re-run `check:fresh` (the `verified.packages` versions will flag it automatically).
**Rationale:** docs that are wrong on first copy-paste are worse than docs with a stated workaround; the freshness tooling is built to catch exactly this transition.
**Status:** active

---

### 2026-09-19 — Integrations: document the correct API behind loud "published package is broken" callouts, instead of omitting or softening

**Decided by:** Claude Code
**Context:** Running the four published packages against a fake hub showed `@vhyxvoid/middleware@1.0.3` crashes at startup with credentials set (Express and Fastify), `@vhyxvoid/next@1.0.3` needs an undeclared `better-sqlite3`, and `vhyxvoid init` exits without writing anything. The brief says: if a real API doesn't support something the plan assumed, correct the plan rather than write around the gap silently.
**Options considered:** (a) write Express/Fastify as if working (would send every reader into a crash); (b) leave them as stubs until republished; (c) write them accurately, verified against the working-tree build, with an error callout at the top and the CLI as the workaround; (d) fix and republish the packages in this session.
**Decision:** (c). (d) was out of scope (source change plus an npm publish of packages that have pre-existing uncommitted edits, and publishing is not something to do unasked). The callouts are in Express, Fastify, Installation and Limitations ("Known problems in the current releases") and all say what to do today. Removal is a checklist item tied to the middleware version bump (context.md "Integrations section", item 1).
**Rationale:** the API, options and behavior are correct and will be needed the moment a fixed version ships; a stub gives readers nothing and hides a real defect; an unqualified guide sends them straight into a crash. The freshness tooling will flag the pages when the package version changes.
**Status:** active

---

### 2026-09-19 — Verify with a fake hub rather than wait for the cert

**Decided by:** Claude Code
**Context:** The hub's certificate is still expired, which blocked live verification of every integration last session. The agent-side behavior (what the docs actually describe) does not depend on the real hub.
**Decision:** run the published packages against a minimal local stand-in hub (protocol messages taken from `packages/protocol/src/messages.ts`). Claims that depend on the real hub are sourced from reading `HttpTunnel.handler.ts`/`Message.router.ts` and labeled as such in the pages ("checked by sending requests through the agent") rather than implied to be end-to-end.
**Rationale:** it turned a source-reading exercise into observed behavior and found four defects a code read would not have (middleware crash, undeclared dependency, broken init, cross-user cache hit). **Limit:** it is not a substitute for a live run; the live quickstart re-run remains a launch gate (backlog).
**Status:** active

---

### 2026-09-19 — Next.js page recommends `allowedDevOrigins`, and a default of `enabled` off outside dev is presented as a feature, not a caveat

**Decided by:** Claude Code
**Context:** Tunneling `next dev` produces a cross-origin dev-resource warning on 16.1.1 that becomes a hard error in a future major. Verified `allowedDevOrigins: ['*.vhyxvoid.com']` clears it.
**Decision:** the recommended config in the Next.js page includes it from the start, with an explanation, rather than mentioning it as troubleshooting later. Scoped to Next 16.1.1 in wording; other versions untested.
**Status:** active

---

### 2026-09-19 — Publish follow-up: re-verify against the live npm packages, and correct pages the fixes made wrong (and ones they never touched)

**Decided by:** Claude Code
**Context:** agent 1.0.19, next 1.0.4 and middleware 1.0.4 went live. The brief: remove the crash/"not yet published" callouts and update versions, but re-verify each claim against the now-published packages rather than assume it.
**Decision / what changed beyond deleting callouts:**
1. **Every claim was re-run against packages installed from the registry** (clean projects; local stand-in hub; a real pty for `init`). Wrappers install with no `better-sqlite3`, `ws` or `axios` in the tree and start (Express, Fastify, Next dev); `next build` with credentials starts no tunnel; `NODE_ENV=production` and missing credentials behave as documented; `stopTunnel()` and Fastify `app.close()` disconnect the agent; CLI: `--version` 1.0.19, interactive `init` on a pty, env-file-over-shell precedence, `--write-env`, `--debug` (11 debug lines vs 0), per-caller cache (alice MISS, bob MISS, alice HIT), Host rewriting, raw-body HMAC verification through the agent.
2. **Docs that had described the bugs were rewritten as the new behavior, not just trimmed:** Quickstart step 2 is `npx @vhyxvoid/agent init` again (manual file kept as an alternative); the CLI page gains an "Interactive setup" section and the `--debug` flag/`VHYXVOID_DEBUG_LOGGING`; the "Known issues" list became "Things to know" with the cache described as it now works (including the residual gap for unrecognised credential header names); Limitations' "Cached responses can be shared" section became "Cached responses" and says agents <=1.0.18 leaked and that the bundled integrations need upgrading too; "Known problems" lost every agent/next/middleware bullet. The Installation native-module callout now says only the agent needs `better-sqlite3`.
3. **Two pages were more generous about the SDK than the published SDK deserves, and were corrected.** Verified on `@vhyxvoid/sdk@1.0.1` from npm: ESM `import` still fails (`ERR_MODULE_NOT_FOUND`), and a binary response (`image/png`, 8 bytes) comes back as a garbled string, not a `Buffer`, because the published build lacks the fix that is in source. Quickstart had said binary responses come back as a `Buffer`; that sentence now points at Limitations, which lists both SDK problems as open and suggests plain `fetch` for binary. This is the only claim in the section the publish did NOT make true; it was wrong since the Quickstart was first written (it described the source, not the published SDK).
4. **`check:fresh` is green** (10 pages, `verified.commit` moved to a91d383, `verified.packages` to the new versions). It is only as good as the frontmatter: the SDK sentence above passed the old check for a session because the page cited `packages/sdk/src/client.ts` (source) while documenting the published build. Lesson recorded: for anything about `@vhyxvoid/sdk`, verify the tarball, not the source.
**Status:** active

---

### 2026-09-19 — SDK docs: verified against sdk 1.1.0 from npm; browser framing replaced by a flagged "Node.js only" limitation

**Decided by:** Claude Code
**Context:** sdk 1.1.0 went live. The follow-up: drop the ESM and binary-response callouts, restore the plain `import` and `Buffer` claims, and stop describing the SDK as browser-capable.
**Decision:** (1) Verified every SDK claim on the affected pages against a fresh `npm i @vhyxvoid/sdk@1.1.0`, not against source (the lesson from the earlier binary-response mistake): ESM `import` and CJS `require`; `baseUrl`, `accountSlug`/`label`/`hubDomain` and `VHYXVOID_ACCOUNT_SLUG`/`VHYXVOID_LABEL` configuration and the no-config error; GET query objects, POST/PUT/PATCH JSON bodies, DELETE; JSON parsed, text as string, png as an identical `Buffer`; `ClientError` (`status`, `data`, `url`); the timeout error; the `onRequest` hook and config `headers`; the client sends no VhyxVoid credentials. The Quickstart's snippet was run verbatim. (2) The Limitations section on the browser was replaced by a warn-callout section placed third (after "Tunnel URLs are public"), not last, that states the earlier description was wrong, gives the verified bundling failure, why polyfilling would make secret leaks easier, what to do in a browser, and what `TunnelClient` is for. (3) The `verified.packages` sdk versions moved to 1.1.0 and `verified.commit` to the sdk comment commit; `check:fresh` is green.
**Rationale:** correcting a capability the docs had asserted needs to be findable, not a footnote; and the reclassification is recorded in shared/decision.md, not just edited in.
**Status:** active

---

### 2026-09-21 — Generated docs blocks live inside hand-written pages and every mapping fails loudly

**Decided by:** Claude Code
**Context:** Part 4A of the plan proposed generated MDX under `content/docs/**/_generated/`, one file per source. The reference pages need prose around the tables (what a flag means in practice, which SDK client to pick), and a page made only of generated text would have nowhere to put it.
**Options considered:** (a) `_generated/*.mdx` files included from pages; (b) marker-delimited blocks inside the page; (c) generate whole pages from templates in the script.
**Decision:** (b). `scripts/generate.mjs` replaces everything between `{/* generated:begin NAME */}` and `{/* generated:end NAME */}` and, with `--check`, exits 1 if any block differs. `check:fresh` runs `--check`. Inputs are the built CLI's `--help` (needs `pnpm --filter @vhyxvoid/agent build`), the TypeScript compiler API over the SDK barrel, the real `PLAN_LIMITS`/`ApiScope`/protocol constants evaluated from their `.ts` files, and small JSON files in `content-config/` for the parts that need a human (which limits are enforced, what a scope means, env var descriptions, SDK description overrides). Each mapping fails instead of guessing: an unclassified plan limit, an unmapped scope, an env var read but not listed (or listed but not read), an SDK export no block claims, a JSDoc that mentions `context.md`/`decision.md`, a note for a symbol that no longer exists, a flag in the manifest that `--help` no longer lists. All five were triggered by hand.
**Rationale:** the plan's point was that a reference claim is derived or checked, not remembered; prose and generated tables can share a page as long as the tables cannot be edited by hand and cannot go stale silently. **Cost accepted:** the CLI block depends on a built agent, so the check is not yet CI-runnable from a clean checkout (backlog); `content-config` files are hand-maintained but each is checked against its source.
**Status:** active

---

### 2026-09-21 — The per-plan rate limit is not listed as enforced (deviation from the brief)

**Decided by:** Claude Code
**Context:** The brief said to list the per-plan rate limits as "confirmed enforced, per earlier findings". The earlier finding (context.md, Part 2) said "partly". Re-reading current source: `HubAuthService.authenticateAgent` returns `rateLimitPerMinute: -1` and never rate limits; the public tunnel HTTP path validates no key; the only limiter is `ValidateApiKeyUseCase`, reached by `TunnelClient` (sdk:register / sdk:request), and it applies the plan value only while the key's Redis cache entry (5 minute TTL, seeded at create/rotate) is warm, because `rowToCache()` sets `-1` when it reloads from the database.
**Options considered:** list the values with a caveat; list them as not enforced; omit and explain.
**Decision:** omit from the enforced table and say why in one paragraph on the plans page ("Not listed here"). The enforced table is exactly the four API-side checks (active keys, scopes per key, PROD keys, rotation). The concurrent agent limit is a fifth real limit but not per plan (`PLAN_AGENT_LIMITS.PRO` for everyone), so it is in a separate "same for everyone" table.
**Rationale:** the docs rule since 2026-09-19 is that a limit is listed only when something applies it; publishing 60/1,000/unlimited would promise a limit that a `TunnelClient` user gets for five minutes and nobody else gets at all. The brief's premise was an earlier session's over-broad summary, not a decision to publish. Reported prominently so the product owner can overrule; if the limiter is fixed, move `rateLimitPerMinute` from `notEnforced` to `enforced` in `content-config/enforced-limits.json` and the table regenerates.
**Status:** active

---

### 2026-09-21 — SDK reference is generated from source, with overrides, and a note where source and the published 1.1.0 differ

**Decided by:** Claude Code
**Context:** 2026-09-19's lesson was to verify the tarball, not the source, for anything about `@vhyxvoid/sdk`. A generator reads source. The export list and signatures are identical between the barrel and the published `dist/index.d.ts` (checked), but source has moved on in two places: `TunnelClientConfig.timeout` defaults to 120 000 in source (commit 473b4ff) and 30 000 in 1.1.0, and several JSDoc comments are wrong or internal (`accountSlug` "found in your dashboard"; a `TIMING.REQUEST_TIMEOUT_MS` reference; "context.md risk #21").
**Decision:** generate from the barrel via the TypeScript compiler API (only real exports appear; an unclaimed export fails the build), and correct the two problems in `content-config/sdk-notes.json`: `descriptions` replace a JSDoc that is wrong/internal, `notes` add a callout such as the 1.1.0-vs-source timeout. Not changed: the SDK source comments (out of scope for a docs session; backlog).
**Rationale:** the reference should track the code automatically, but a generated page must never publish a comment that is false or that leaks an internal note. The override file is small, keyed by symbol, and fails when a key goes stale, so it cannot rot quietly. When the SDK is republished, `check:fresh` flags every SDK page (package version) and the timeout note comes out.
**Status:** active

---

### 2026-09-21 — Timeouts are documented by where the wait ends, not as one number

**Decided by:** Claude Code
**Context:** Existing pages said "your server has 30 seconds, then the caller gets 504". Running the published agent 1.0.19 against a stand-in hub with `timeoutMs: 118000` and a 45 s backend: the agent gave up at 28.08 s with `BACKEND_UNAVAILABLE ... timeout of 28000ms exceeded`, which the hub renders as **502** (only `AGENT_TIMEOUT` maps to 504). The repo's current agent honours the hub's `timeoutMs` (3 s budget, 3.1 s answer). So the 30 s to 504 claim was already wrong before the hub change, and the change to 120 s in the hub does not by itself move the limit a user hits.
**Decision:** describe four limits (agent to local server 28 s in 1.0.19 and earlier; hub to agent 120 s default, 5-600 s range, hub-operator only; `createClient` 30 s; `TunnelClient` 30 s in 1.1.0), say the shortest fires first, and describe the caller-visible result of each. `TUNNEL_REQUEST_TIMEOUT_MS` is documented as a hub-operator setting, not something a user sets. Not asserted: that the production hub already runs the 120 s default (cannot be seen from the repo); the page says "in the current hub code" and that an un-updated hub still waits 30 s.
**Rationale:** a single "120 seconds" would have been the same class of error as the single "30 seconds": true of one component and wrong for what the caller sees.
**Status:** active

---

### 2026-09-21 — WebSocket support is documented as partial, with the failing cases named

**Decided by:** Claude Code (wording of the brief's "partially working, not fully")
**Context:** shared/ws-tunnel-design.md found ten defects; Phase 1 (8c74574) fixed D1, D2, D5, D7, D10 and the D3 information leak. D3's early-frame loss, D4 subprotocols, D6, D8 and all of Phases 2-5 are open. The published agent 1.0.19 still batches WS frames (checked in the tarball), and whether the production hub has its half of Phase 1 is unknown.
**Decision:** Troubleshooting has a section and Limitations a short one saying: a simple connection works; Vite HMR fails on the subprotocol (1011, "Server sent a subprotocol but none was requested"); a first message right after open can be lost (socket.io falls back to long polling); an upgrade rejected by the local server shows as an open-then-closed socket; no caps or keep-alive. The fixed defects are described as "in the repository, not in any released agent", not as fixed. Next.js and other HMR: "not tested". No claim of support.
**Rationale:** ws-tunnel-design says not to document WS-through-tunnel as supported until Phase 4 passes; naming the concrete failures is more useful than "experimental" and stays true until Phase 2 ships. Revise this section when an agent with Phase 1 is published and again after Phases 2 and 4.
**Status:** active

---

### 2026-09-21 — Dashboard guide written from code, findings stated as found

**Decided by:** Claude Code
**Context:** The brief asked to verify against the real, current UI. No browser walk-through was done (the local dev backend needs Postgres and Redis; the earlier docs sessions had the same limit), so the guide comes from reading every view and the API use cases behind it.
**Decision:** describe behavior that the code fixes (columns, buttons, roles, validation limits, the one-hour rotation grace, the three-day invitation link, the once-only secret), and state two gaps as facts rather than smoothing them over: the sidebar lists organizations only (so a personal-account-only user has no key link until they create an organization), and the hub accepts agents only for `ACTIVE` accounts (so `PAST_DUE` is refused although the grace period keeps plan limits; read from code, hedged on the page). The upgrade dialog's feature bullets and prices are deliberately not repeated in the docs because they contradict `PLAN_LIMITS`.
**Rationale:** a guide that only describes the happy path would repeat the Quickstart's earlier mistake (implying a click path that isn't there). **Limit:** column order, wording and icons can drift; each page carries the view files as `sources`, so a change to them flags it.
**Status:** active


---

### 2026-09-21 — Docs after agent 1.0.20 / next+middleware 1.0.5 went live: version-conditional wording, hub half not claimed

**Decided by:** Claude Code
**Context:** The agent's timeout and WebSocket fixes were published. Verified against the npm tarballs (harness `shared/verify-agent-packed.cjs` on all three, plus greps of the published bundle) before editing. The hub half of WS Phase 1 and the configurable timeout are in source (473b4ff, 8c74574), but no session here has confirmed the production hub runs them.
**Decision:** (1) Timeout wording is stated per version, not replaced: 1.0.20+ waits for the hub's per-request budget (hub timeout minus 2 s, so 118 s on the default), 1.0.19 and earlier 28 s, and a hub that predates the configurable timeout still sends 28 s (it sent 30 s minus 2 s). The 502 text is documented as `timeout of <n>ms exceeded` with `118000` as the default example, checked against the published agent with a 5 s budget. (2) The WS pages say the burst/ordering/close/cleanup fixes are released in agent 1.0.20 and next/middleware 1.0.5, but say the fix has a hub half that the page cannot check, and keep the subprotocol and early-message problems listed as unfixed. (3) The SDK's 30 s (`createClient`, `TunnelClient` 1.1.0) is now called out as the shortest limit for users on the new agent. (4) `verified.commit` was repointed to 377c924 only on pages whose sources the bump commit touched (only `package.json` files, no code); pages unaffected keep their commit.
**Rationale:** old agent versions stay installed for a long time and the in-process wrappers only pick the fix up on republish, so a bare "fixed" would mislead anyone on 1.0.19/1.0.4. The hub half is unverified against production; claiming it would repeat the over-claiming the earlier WS entry avoids. **Limit:** the hub-half hedge should be removed once someone confirms the deployed hub commit; the SDK `TunnelClient` figures still say 30 s until the next SDK release.
**Status:** active

---

### 2026-10-16 — Contact form captcha is Cloudflare Turnstile; the blog finds or creates categories and tags by name

**Decided by:** Claude Code (user asked for a captcha and a blog whose categories and tags are reused, or created when missing)
**Context:** The contact form had a honeypot and a per-address limit only. The site had no blog.
**Options considered:** captcha: Turnstile, hCaptcha, reCAPTCHA, a home-made question. Taxonomy: a fixed list admins manage first, or names typed in the post.
**Decision:**
- **Captcha:** Turnstile, off until both halves are set (API `TURNSTILE_SECRET_KEY`, public setting `support.captchaSiteKey`). The API fails closed (503) when Cloudflare can't be reached.
- **Taxonomy:**
  - Posts send category and tag *names*. The API upserts by `slugify(name)` inside the save's transaction (tags with `createMany skipDuplicates`), so case and spacing variants and concurrent saves reuse one row.
  - A Categories & tags screen covers the tidy-up: rename, re-address, describe, merge tags, delete.
- **Post saves** send only the changed fields. The update schema has no zod defaults: an earlier version applied `.default()`s under `.partial()` and wiped a post's body on a slug-only save; a test now covers it.
- **Renamed posts:** a published post's renamed slug goes to `previousSlugs` and the website answers it with a permanent redirect.
- **Scheduling** is `publishedAt` in the future, with no job. The website's 60 s fetch revalidation is what makes a scheduled post appear, "within a minute".
**Rationale:**
- Turnstile is free, mostly invisible and has documented test keys.
- Find-or-create removes the "set up taxonomy first" step the user wanted gone.
- A scheduler would be one more moving part for something the cache already bounds.
**Status:** active

---

### 2026-10-16 — SEO: settings for site defaults, a table per address, redirects in the website proxy

**Decided by:** Claude Code (user: "give all control to admin panel and additionally do it from the frontend side too")
**Context:** Pages set their own `<title>`; there was no canonical, Open Graph, structured data, redirect management or 404 visibility.
**Decision:**
- **Site-wide defaults** are settings (group `seo`, public). They show on the SEO screen, not on Settings.
- **Per-address overrides** live in `seo_pages`, keyed by site path. They apply to any address and win over the page's own SEO fields (content entries, posts), so one screen can fix any page. Overrides with nothing left in them are deleted.
- **Page metadata** is built once (apps/web views/seo/seo.ts). Canonical links are always the unprefixed path on the site address, which folds /fr/x and tracking parameters into /x.
- **Redirects** (`seo_redirects`) run in the Next proxy from an in-memory copy on `globalThis`. It refreshes in the background every 60 s, and `/api/revalidate` marks it stale, which was checked on a production build. The proxy matcher now lets dotted paths other than static-file extensions through, so old `.html`/`.php` addresses can be redirected.
- **Loops** are refused when a redirect is saved (simulating the website's matching, up to 10 hops), with a last guard in the proxy.
- **Missing addresses** are reported by the website after the response (`after()`), authenticated with the existing revalidate secret, and capped at 5000 rows. Crawlers are not filtered out, since their 404s are the ones that matter for search.
- **Share images** without an uploaded one are generated by `/api/og`.
- **Rules shared** by API, admin and web (path normalising, redirect matching, title template, fixed routes) are in packages/content/src/seo.ts.
**Rationale:** settings already give validation, audit log and caching for free. A path-keyed table is the simplest thing that covers fixed routes, CMS pages and posts alike. Redirects belong before rendering, and the API is not on the request path.
**Limits:** redirect hits and 404 reports need `REVALIDATE_SECRET`. On several website instances, a redirect change reaches the instance that received the revalidate call at once and the others within 60 s. The audit's length limits (60/160) are guidance, not what every engine does.
**Status:** active

---

### 2026-10-17 — Website gaps: void look everywhere, media in Postgres, signed previews, consent-gated analytics

**Decided by:** Claude Code (user: "build all of them in that order")
**Context:** After the landing redesign, the other public pages still used the light app look. Images could only be linked, drafts couldn't be seen before publishing, the default footer had no About, Contact or Blog, the blog had no search, ToC or sharing, and there was no analytics.
**Decision:**
- **Void look**: MarketingShell always renders a dark `vhyxvoid` brand scope and overrides tokens in `.voidShell[data-brand][data-theme]`, which beats the brand selector. Content can't style itself, so CMS pages match without changes. The 404 page is rendered by the same shell.
- **Media** is stored as bytes in Postgres (`media_assets`), processed by sharp on upload (EXIF rotation, metadata stripped, max 2400 px wide, WebP thumbnail; SVG refused). It is served through the website at `/media/<id>/<name>` with an immutable cache, so addresses are on the site's own domain. "Used in" is a LIKE on the id over posts, content, SEO overrides and settings.
- **Draft preview** is an HMAC-signed token (pepper-derived key, 48 h), with no table. It is passed in the query because Fastify's route parameter limit is 100 characters. Anyone with the link can view it; the response is no-store and noindex, and /preview is disallowed in robots.txt.
- **About and Contact** are built-in defaults like terms and privacy. The built-in footer's Company column takes footer-flagged pages, then Blog (only once a post is live).
- **Blog search** is a case-insensitive `contains` over title, excerpt and body. The ToC uses one slugger for the markdown (list) and for the rendered headings (ids). Share links are plain URLs, with no third-party scripts.
- **Analytics** is settings (group `analytics`, public). The website injects the script on the client. Cookie-setting providers (GA4, GTM) wait for consent under mode `auto`. The choice is kept in localStorage plus a `vv_consent` cookie for a year, and "Cookie settings" in the footer reopens the banner.
**Rationale:**
- Postgres storage needs no bucket or credentials and is backed up with everything else. Images are capped at 10 MB and resized, which bounds growth.
- A signed token keeps previews stateless.
- Settings give validation, audit and caching for free.
**Limits:**
- A media library of many thousands of large images belongs in object storage; the serving route is the seam for that.
- Preview links can't be revoked before they expire, except by rotating the pepper.
- Blog search is substring matching, not ranked full-text.
- Scripts loaded by a GTM container are gated by GTM's own consent mode, not by our banner.
**Status:** active

---

### 2026-10-17 — Website round two: newsletter, changelog, landing proof, yearly billing, brand, authors, one language, emails

**Decided by:** Claude Code (user: "build all of them in that order and remove french translation, we only keep single language only or comment out french and multi language for future add")
**Decision:**
- **Newsletter** is our own table (`newsletter_subscribers`) with double opt-in, not a mailing-service integration.
  - Confirm and unsubscribe links are HMAC-signed (no token column). Confirm links last 7 days; unsubscribe links never expire.
  - Sign-up answers never reveal whether an address is known. Confirmation emails are throttled per address.
  - A post is emailed at most once (`newsletterSentAt`, claimed atomically), one email at a time in the background, with RFC 8058 one-click unsubscribe through the website.
- **Changelog** is a table of entries (version, labels, markdown, date), shown at `/changelog` with RSS. A future date waits, like a scheduled post.
- **Landing proof** (logos, showcase, testimonials) ships empty and hidden while empty. Nothing made up appears on the site.
  - Videos only play from YouTube (nocookie) or Vimeo (dnt), or as a direct file.
  - Images are https or site paths.
- **Yearly billing** extends `billing.stripePrices` with `<PLAN>_YEARLY`, so there is no new setting.
  - The pricing switch shows only when a yearly price is both written on the page and buyable.
  - `/public/plans` says which plans can be bought yearly, without IDs.
- **Brand** adds two setting types, `image` and `color`, so only a validated value can reach the page.
  - The accent colour is one inline rule. It sets the site's accent variables and VhyxUI's accent tokens (`!important`, the admin's choice), with shades from `color-mix`.
  - The favicon moved to `public/` because Next always adds `app/favicon.ico`.
- **Authors** are profiles (`blog_authors`). Posts keep `authorName` as the signature when there's no profile, or after the profile is deleted.
- **One language.** `LOCALES = ['en']`, with French commented out and its messages kept. `RETIRED_LOCALES = ['fr']` redirects `/fr/…` to English with a 308. The `[locale]` segment and next-intl stay, so a language can come back by editing one file.
- **Email wording.** Eight emails have editable subject, heading, text, button and note, with `{{variables}}` checked per email (`emails.overrides`).
  - An unedited email is byte-for-byte what the code builds.
  - The API keeps the overrides in memory, refreshed every 30 s and at once on save.
- **Polish.**
  - A "Skip to content" link is the first Tab stop on the website and the dashboard.
  - `/.well-known/security.txt` comes from the support settings.
**Limits:**
- A newsletter send interrupted by a restart isn't resumed.
- The accent colour covers buttons, links and the main violet, not every decorative gradient.
- The dashboard upgrade dialog's price labels come from build-time env, not the pricing page.
**Status:** active
