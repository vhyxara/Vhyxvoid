# Session Updates — apps/docs

Append-only. Each entry is a fenced JSON block. Schema matches the other components' `session_update.md` files (see `internal-tools/shared/session_update.md`: session_id, date, agent, repo, brief_summary, status, summary, decisions_made, bugs_found_fixed, bugs_found_unfixed, files_changed, gate_results, open_items_for_next_session, context_md_updates_needed).

---

```json
{
  "session_id": "2026-09-19-docs-app-scoping-investigation-plan",
  "date": "2026-09-19",
  "agent": "claude-code",
  "repo": "Black-Server (new: apps/docs, not yet scaffolded)",
  "brief_summary": "Investigate and plan a new external-docs app: evaluate Fumadocs/Nextra/custom Next+MDX, inventory the real product surface (sdk/agent/middleware/next/dashboard/limits), propose IA, a content-freshness approach, and a scaffolding plan; create internal-tools/docs/. No code scaffolded.",
  "status": "completed",
  "summary": "Read shared/context.md, user-frontend/context.md, api/context.md, hub context (replay notes), shared/decision.md, then read package source directly (sdk barrel/client/types, agent cli/AgentConfig, middleware, next, hub HttpTunnel handler and Message.router, PLAN_LIMITS and their enforcement sites, apps/web routes/views). Framework research was web-doc based only (no spike). Recommended Fumadocs (core+mdx+ui) themed via VhyxUI tokens; produced inventory, IA, freshness contract, and scaffolding plan in internal-tools/docs/context.md with reasoning in decision.md. Verified all four packages are published on npm at local versions.",
  "decisions_made": [
    "Fumadocs over Nextra/custom, conditional on a first-hour spike (decision.md, 2026-09-19)",
    "Freshness contract: generate from source or carry verified/sources frontmatter checked in CI; samples compiled",
    "Publish only enforced plan limits, never PLAN_LIMITS wholesale",
    "Document @vhyxvoid/next as the single canonical Next.js path; TunnelClient documented with secret-exposure warning",
    "apps/docs, port 4002, no apps/api CORS change, tokens-only VhyxUI (copy tokens if deploy lacks sibling repo)"
  ],
  "bugs_found_fixed": [],
  "bugs_found_unfixed": [
    "Public tunnel subdomain HTTP requests are unauthenticated at the hub (HttpTunnelHandler does no key validation) - by design as far as found, but user-facing security consequence; no rate limiting on that path",
    "Hub enforces PLAN_AGENT_LIMITS.PRO (5 agents) for every plan (Message.router.ts:221), FREE's 1 not applied",
    "packages/shared validateApiKey rowToCache() sets rateLimitPerMinute -1 (unlimited) on DB fallback (TODO, line ~219); api/context.md Known Risk #4 'enforced end-to-end' is over-broad",
    "maxMembers/maxRequestsPerMonth/customDomains/retention have no enforcement site found; planLimitGuard only wired for maxApiKeys",
    "@vhyxvoid/sdk package.json exports.import -> dist/index.mjs never emitted (known #12 side note); may break ESM consumers of the published 1.0.1 - unverified against the tarball",
    "@vhyxvoid/sdk depends on npm 'crypto' placeholder package; demo.js/blackserver-client.ts ship in dist",
    "@vhyxvoid/next and @vhyxvoid/middleware/next diverge in defaults (label app vs default, port detection, dev gating)",
    "TLS cert for *.vhyxvoid.com was expired as of 2026-09-12 (Known Risk #2) - not re-checked this session; gates public docs launch"
  ],
  "files_changed": [
    "internal-tools/docs/{context,decision,session_update,backlog}.md (new)",
    "internal-tools/shared/backlog.md (appended)"
  ],
  "gate_results": {
    "note": "Docs/planning only; no code, build, or tests run. npm view confirmed published versions agent 1.0.18, sdk 1.0.1, middleware 1.0.3, next 1.0.3."
  },
  "open_items_for_next_session": [
    "Answer the four Open Questions in internal-tools/docs/context.md (deploy env/VhyxUI checkout, unenforced limits in docs, canonical Next package, docs origin)",
    "Start scaffolding with the Fumadocs spike (light/dark token mapping, search under static export, TypeDoc/Twoslash)",
    "Re-check TLS cert live and verify SDK ESM resolution against the published tarball before writing quickstarts",
    "Add the check:fresh line to .claude/CLAUDE.md"
  ],
  "context_md_updates_needed": [
    "internal-tools/api/context.md Known Risk #4: rate limiting is not enforced on public subdomain HTTP traffic and falls back to unlimited on cache-miss DB load; hub agent limit is hardcoded to PRO",
    "internal-tools/shared/context.md Directory Structure: mention apps/docs once scaffolded"
  ]
}
```

---

```json
{
  "session_id": "2026-09-19-docs-app-scaffold-spike-getting-started",
  "date": "2026-09-19",
  "agent": "claude-code",
  "repo": "Black-Server (apps/docs, apps/web)",
  "brief_summary": "Scaffold apps/docs and prove the stack: real Fumadocs spike, first real page (Getting Started), and /docs routing from apps/web; plus freshness-tooling skeleton.",
  "status": "partial",
  "summary": "Spiked Fumadocs for real (scratch install, then in-repo). It fits, but only on Next >=16.2 and Tailwind >=4.2, not the 16.1.1/4.1.17 web and admin use, so docs pins Next 16.3.4/Tailwind 4.3.3; I proceeded rather than stopping (judgment call, decision.md). Scaffolded apps/docs (port 4002, basePath /docs, VhyxUI tokens plus apps/web's brand override copied, dark-only), built the full IA skeleton (24 stubs), and wrote real Quickstart/Installation/Concepts/Limitations pages verified against the published tarballs. Implemented the apps/web /docs rewrite via DOCS_ORIGIN and verified it against a production build; status is partial because the production DOCS_ORIGIN cannot be determined from the repo and the quickstart could not be run live (hub cert still expired).",
  "decisions_made": [
    "Proceeded past the spike's version mismatch instead of stopping (docs on Next 16.3.4 / Tailwind 4.3.3, isolated from web/admin)",
    "Dark-only theme; copy brand override as well as tokens; strip VhyxUI's trailing global reset from the token copy",
    "Server-mode docs app with basePath /docs (not static export)",
    "apps/web rewrite driven by DOCS_ORIGIN, dev default localhost:4002, placeholder page kept as visible unset-origin fallback; proxy.ts bypasses next-intl for /docs",
    "Quickstart documents require()/createRequire because the published SDK's ESM import is broken; hub cert expiry kept out of public docs and recorded as a launch gate"
  ],
  "bugs_found_fixed": [],
  "bugs_found_unfixed": [
    "@vhyxvoid/sdk@1.0.1 ESM import fails with ERR_MODULE_NOT_FOUND (confirmed on the published tarball)",
    "Published @vhyxvoid/agent@1.0.18 prints --version 1.0.16",
    "Dashboard never displays the account slug though SDK JSDoc/init prompt say it does",
    "hub.vhyxvoid.com TLS cert still expired (notAfter 2026-08-03) as of 2026-09-19",
    "RootProvider attribute array config froze the page renderer (avoided, root cause unknown)",
    "apps/web unknown-route catch-all returns 200 for missing pages under the placeholder-fallback config (noted, not investigated)"
  ],
  "files_changed": [
    "apps/docs/** (new)",
    "apps/web/next.config.ts",
    "apps/web/src/proxy.ts",
    "apps/web/README.md",
    "package.json (dev:docs, build:docs)",
    "pnpm-lock.yaml (docs importer added)",
    "internal-tools/docs/{context,decision,backlog,session_update}.md",
    "internal-tools/shared/backlog.md",
    "(.claude/CLAUDE.md, gitignored)"
  ],
  "gate_results": {
    "apps/docs typecheck": "pass",
    "apps/docs build": "pass (also standalone outside the monorepo, no VhyxUI present)",
    "turbo typecheck --filter=!web": "pass 11/11",
    "turbo build --filter=!web": "pass 10/10",
    "root pnpm test": "pass 22 files / 106 tests",
    "apps/web tsc --noEmit + next build": "pass (with and without DOCS_ORIGIN)",
    "routing (prod build of web on :4010 -> docs :4002)": "pass for /docs, /docs/getting-started/quickstart, /docs/limitations, /docs/api/search, hashed CSS asset; client nav stays under /docs; /pricing /support /login unaffected",
    "not run": "apps/web next dev with the new config (dev servers already running, config not hot-reloaded); live agent->hub->local request; browser walk-through of dashboard steps"
  },
  "open_items_for_next_session": [
    "User: where are apps/web and apps/docs deployed? Set DOCS_ORIGIN at apps/web build time",
    "Fix hub TLS cert, then re-run the quickstart live",
    "Fix SDK ESM export + republish, then update quickstart/limitations callouts",
    "Restart apps/web dev server to pick up the rewrite; try /docs in dev",
    "Generators (CLI ref, SDK ref, scopes, limits, env vars) and fill the stub pages"
  ],
  "context_md_updates_needed": [
    "internal-tools/shared/context.md Directory Structure: add apps/docs (and the port table: web 4000, admin 4001, docs 4002)",
    "internal-tools/user-frontend/context.md: /docs is now proxied to apps/docs (next.config.ts + proxy.ts)"
  ]
}
```

---

```json
{
  "session_id": "2026-09-19-docs-integrations-section",
  "date": "2026-09-19",
  "agent": "claude-code",
  "repo": "Black-Server (apps/docs)",
  "brief_summary": "Build the Integrations section of apps/docs (Express, Fastify, Next.js, standalone CLI, webhooks) as real, hand-written, source-verified guides.",
  "status": "completed",
  "summary": "Installed the four published packages from npm and ran them against a small fake hub (a ws server speaking the agent protocol), so agent-side behavior was observed rather than inferred despite the expired hub cert. That found real defects the plan didn't know about: published @vhyxvoid/middleware 1.0.3 crashes at startup (Express and Fastify), @vhyxvoid/next needs an undeclared better-sqlite3, `vhyxvoid init` exits without writing anything, and the agent cache returns one caller's response to another. Wrote all five pages with verified/sources frontmatter, corrected the previous session's Quickstart (init, debug lines), Installation and Limitations, and reordered the sidebar with Next.js first. Also fixed a docs nav bug (title link went to /docs/docs).",
  "decisions_made": [
    "Express/Fastify written accurately (verified against working-tree build) behind 'published package crashes' callouts, with the CLI as workaround; not stubbed, not fixed/republished (decision.md)",
    "Verify against a fake hub instead of waiting for the cert; label hub-dependent claims as source-read",
    "Next.js page recommends allowedDevOrigins from the start",
    "Next.js first in the Integrations sidebar",
    "Only Stripe documented as a worked webhook provider; no inspector claims"
  ],
  "bugs_found_fixed": [
    "Docs nav title link pointed at /docs/docs (next/link prepends basePath); now '/'",
    "Quickstart described `vhyxvoid init` working and omitted debug output (my previous-session error); corrected"
  ],
  "bugs_found_unfixed": [
    "@vhyxvoid/middleware@1.0.3 crashes at startup with credentials (published bundle lacks disableQueue/NoOpQueue); fix exists only uncommitted in working tree",
    "@vhyxvoid/next@1.0.3 and middleware@1.0.3 publish empty dependencies but import better-sqlite3",
    "`vhyxvoid init` exits 0 after the secret prompt without writing .env.vhyxvoid (Node 24)",
    "Agent sends 1.0.16 as agentVersion to the hub (not only printed)",
    "Agent ResponseCache returns one caller's response to another (Known Risk #5, reproduced end to end)",
    "Per-request debug console.logs left in AgentClient/MessageBatcher",
    "Hub TLS cert still expired (Aug 3 2026)"
  ],
  "files_changed": [
    "apps/docs/content/docs/integrations/{nextjs,express,fastify,standalone-cli,webhooks}.mdx (real content)",
    "apps/docs/content/docs/integrations/meta.json",
    "apps/docs/content/docs/getting-started/{quickstart,installation}.mdx",
    "apps/docs/content/docs/limitations.mdx",
    "apps/docs/src/lib/layout.shared.tsx",
    "internal-tools/docs/{context,decision,backlog,session_update}.md",
    "internal-tools/shared/backlog.md"
  ],
  "gate_results": {
    "check:fresh": "pass (10 pages checked, 19 stubs skipped)",
    "apps/docs typecheck + build": "pass",
    "turbo typecheck+build --filter=!web": "pass 18/18 tasks",
    "root pnpm test": "pass 22 files / 106 tests",
    "docs link crawl": "118 internal links and anchors on the real pages all resolve; headless screenshots of Express and Next.js pages render correctly",
    "agent-side runs vs fake hub": "CLI (env file, flag precedence, --write-env variants, forwarding, cache hit/miss and cross-caller leak), published middleware Express+Fastify (crash, confirmed), working-tree middleware Express+Fastify (register, forward, writeEnv, production gate, env-only config, onClose), @vhyxvoid/next dev/build/enabled:true on Next 16.1.1, allowedDevOrigins, port detection, raw-body HMAC and real Stripe constructEvent (Express, Fastify) and HMAC (Next)",
    "not run": "any live hub/API run (cert expired); Windows/Linux; Node != 24; Next != 16.1.1; WebSocket/HMR through the tunnel; apps/web dev server after the /docs change"
  },
  "open_items_for_next_session": [
    "Commit the NoOpQueue/AgentClient working-tree changes, rebuild, bump and republish @vhyxvoid/middleware (then remove the crash callouts)",
    "Declare better-sqlite3 (or stop importing it) in next/middleware; fix `vhyxvoid init`, the 1.0.16 version string, and the debug logging",
    "Decide what to do about the agent response-cache cross-caller leak",
    "Fix hub TLS cert, then a live quickstart and integrations re-run",
    "User: apps/web:4000, apps/admin:4001 and livein-admin-web dev servers were killed by my pkill and need restarting; set DOCS_ORIGIN for production"
  ],
  "context_md_updates_needed": [
    "internal-tools/shared/context.md Known Risk #5: cache leak reproduced end to end; Known Risk #17: 'NoOpQueue fixes the middleware SQLite complaint' is true only in the working tree, not in the published package",
    "internal-tools/shared/context.md Known Risk #15 note: published next/middleware manifests have empty dependencies"
  ]
}
```

---

```json
{
  "session_id": "2026-09-19-docs-publish-followup",
  "date": "2026-09-19",
  "agent": "claude-code",
  "repo": "Black-Server (apps/docs)",
  "brief_summary": "Remove the crash / not-yet-published callouts from the docs now that agent 1.0.19, next 1.0.4 and middleware 1.0.4 are live, re-verifying every claim against the published packages; keep sdk excluded and check the docs don't overstate it.",
  "status": "completed",
  "summary": "Confirmed all three versions on npm (next and middleware with empty dependencies, agent without protocol), then installed them fresh from the registry into clean projects and re-ran the integration steps against a stand-in hub and a real pty. Everything the pages now say held. Removed the callouts and updated versions on Express, Fastify, Installation, Quickstart, Next.js, CLI and Limitations, and rewrote the sections that had documented the bugs (init back as Quickstart step 2, cache described as fixed, --debug added). Verifying the SDK found that the published 1.0.1 still fails ESM import and returns binary responses as garbled text, so the Quickstart's Buffer claim was corrected and Limitations lists both. check:fresh is green.",
  "decisions_made": [
    "Rewrite bug-describing sections as the new behavior instead of only deleting callouts",
    "Correct the Quickstart's SDK binary claim and list both SDK problems in Limitations",
    "Verify the SDK against its tarball, not its source (lesson recorded in decision.md)"
  ],
  "bugs_found_fixed": [
    "Quickstart claimed binary SDK responses come back as a Buffer (false for published sdk 1.0.1)",
    "Docs implied an installed better-sqlite3 was needed for next/middleware (no longer true, and was documented as such)"
  ],
  "bugs_found_unfixed": [
    "sdk 1.0.1: ESM import fails; binary responses corrupted (stale build lacking the source fix); protocol dependency issue for its next publish",
    "Agent still prints a dotenv tip line and two [agent] info lines by default",
    "Hub TLS cert still expired, so the whole flow is still unverified against the real hub"
  ],
  "files_changed": [
    "apps/docs/content/docs/{getting-started/{quickstart,installation,concepts},integrations/{express,fastify,nextjs,standalone-cli,webhooks},index,limitations}.mdx",
    "internal-tools/docs/{context,decision,backlog,session_update}.md",
    "internal-tools/shared/{backlog,context}.md"
  ],
  "gate_results": {
    "npm registry": "agent 1.0.19, next 1.0.4, middleware 1.0.4 latest; sdk still 1.0.1; next/middleware dependencies empty; agent has no @vhyxvoid/protocol",
    "live re-verification from npm": "Express/Fastify/Next dev connect and forward without better-sqlite3/ws/axios installed; hub recorded agentVersion 1.0.19; next build with creds starts no tunnel; NODE_ENV=production off; no-credentials warns and app still serves; stopTunnel and Fastify close disconnect the agent; CLI --version 1.0.19; interactive init on a real pty writes all answers; env file beats shell env; --write-env; --debug 11 lines vs 0; cache alice MISS/bob MISS/alice HIT; Host rewritten; raw-body HMAC 200",
    "sdk 1.0.1 from npm": "ESM import ERR_MODULE_NOT_FOUND; require ok; JSON/text ok; 8 binary bytes returned as a garbled string",
    "check:fresh": "ok, 10 pages",
    "docs typecheck+build": "pass",
    "turbo typecheck+build --filter=!web": "pass 18/18",
    "root pnpm test": "pass 29 files / 151 tests",
    "docs crawl": "116 internal links and anchors resolve; no callout phrases from the old bugs remain (one intentional historical note about 1.0.16)",
    "not run": "live hub (cert expired); Windows/Linux; Node != 24; Next != 16.1.1"
  },
  "open_items_for_next_session": [
    "SDK republish round (ESM export, protocol republish/bundling, stale-build cause), then trim Limitations and Quickstart per docs/backlog.md",
    "Fix hub TLS cert, then a live quickstart run",
    "Generators and the remaining stub pages"
  ],
  "context_md_updates_needed": [
    "internal-tools/shared/context.md item 54: published as agent 1.0.19 / next 1.0.4 / middleware 1.0.4"
  ]
}
```

---

```json
{
  "session_id": "2026-09-19-docs-sdk-1-1-0-and-node-only",
  "date": "2026-09-19",
  "agent": "claude-code",
  "repo": "Black-Server (apps/docs, packages/sdk comments)",
  "brief_summary": "Clean the docs up for the live sdk 1.1.0 (remove the ESM and binary-response caveats, show the real import) and reclassify the SDK from browser-capable to Node.js-only everywhere it was described as browser-oriented, with a flagged Limitations section and a recorded decision.",
  "status": "completed",
  "summary": "Confirmed sdk 1.1.0 live on npm, then installed it fresh and re-verified every SDK claim on the affected pages (imports, configuration, response handling, errors, timeout, hooks, no credentials), running the Quickstart snippet verbatim. Removed the two sdk-problem sections and the require() workaround; Quickstart now uses import and says binary responses are Buffers. Grepped apps/docs, internal-tools, packages and the hub for browser framing, corrected the living docs and the sdk description and comments, and added a flagged 'The SDK is Node.js only' Limitations section that says the earlier description was wrong. Re-verified against 1.1.0 that even createClient alone cannot be bundled for a browser. Recorded the reclassification in shared/decision.md. check:fresh is green.",
  "decisions_made": [
    "SDK reclassified as Node-only; browser support is a future project needing bundling and a browser-safe auth design together (shared/decision.md)",
    "Limitations section placed third with a warn callout, not last",
    "Edit living docs in place with CORRECTED notes; leave append-only decision/session entries and add superseding ones",
    "Change the sdk package description and source comments now (description reaches npm at the next release)"
  ],
  "bugs_found_fixed": [
    "Docs described the SDK/TunnelClient as browser-oriented and included a browser secret-exposure section that presumed browser use",
    "package.json description said 'Frontend TypeScript SDK'"
  ],
  "bugs_found_unfixed": [
    "SDK cannot be bundled for a browser (by decision, not fixed)",
    "Hub TLS cert still expired",
    "Docs still describe everything against a stand-in hub, not the real one"
  ],
  "files_changed": [
    "apps/docs/content/docs/{getting-started/{quickstart,installation,concepts},integrations/*,index,limitations}.mdx (verified commits; sdk pages)",
    "packages/sdk/{package.json,src/TunnelClient.ts,src/index.ts}, apps/hub/src/HubServer.ts (comments/description only)",
    "internal-tools/{shared,docs}/{context,decision,backlog}.md, internal-tools/docs/session_update.md"
  ],
  "gate_results": {
    "npm registry": "@vhyxvoid/sdk 1.1.0 latest; dependencies ws, isomorphic-ws; exports types/import/require",
    "live re-verification of sdk 1.1.0 from npm": "ESM import and CJS require; exports; baseUrl/accountSlug/label/hubDomain and env configuration, no-config error; JSON/text/binary (Buffer identical); query object; POST/PUT/PATCH JSON body and content-type; DELETE; ClientError status/data/url; timeout error; onRequest and headers options; default request headers carry no credentials; Quickstart snippet run verbatim (success and 500 paths)",
    "browser bundle of published 1.1.0": "esbuild --platform=browser fails on crypto and http for createClient, TunnelClient, and both; --platform=node passes",
    "check:fresh": "ok, 10 pages",
    "docs typecheck+build": "pass",
    "turbo typecheck+build --filter=!web": "pass 18/18",
    "root pnpm test": "pass 29 files / 158 tests",
    "docs crawl": "116 internal links and anchors resolve; no stale sdk-problem phrases; Limitations renders with the new flagged section",
    "not run": "TunnelClient against a real hub; live hub (cert expired)"
  },
  "open_items_for_next_session": [
    "Fix hub TLS cert and re-run the live quickstart",
    "SDK reference/guide pages are still stubs (write them Node-only)",
    "Generators and remaining stubs",
    "Next sdk release will carry the corrected package description"
  ],
  "context_md_updates_needed": []
}
```

---

```json
{
  "session_id": "2026-09-21-docs-reference-dashboard-troubleshooting",
  "date": "2026-09-21",
  "agent": "claude-code",
  "repo": "Black-Server (apps/docs)",
  "brief_summary": "Build the remaining docs stubs: CLI reference, SDK reference, reference tables, Dashboard Guide, Troubleshooting. CLI/SDK/tables generated from source where possible, dashboard and troubleshooting hand-written; verified/sources frontmatter; check:fresh green.",
  "status": "completed",
  "summary": "All five sections got real treatment (17 stub pages became real; 2 stay stubs: changelog and cli/configuration, neither in the brief). Built apps/docs/scripts/generate.mjs: marker-delimited blocks (`{/* generated:begin NAME */}`) inside hand-written pages, rewritten by `pnpm --filter @vhyxvoid/docs generate` and verified by `generate:check`, which check:fresh now runs. Sources: the built CLI's --help output (identical to published agent 1.0.19), the TypeScript compiler API over the SDK barrel (fails on an unclaimed/removed export), PLAN_LIMITS and protocol constants evaluated from the real .ts files through content-config/enforced-limits.json (fails on an unclassified limit), ApiScope through scopes.json, env vars through env-vars.json cross-checked by a grep of the four packages, and the hub's timeout bounds read out of tunnelTimeout.ts. All five failure modes were exercised by hand. Dashboard pages were written from the current apps/web components (VhyxUI, not MUI) plus the API use cases behind them (roles, grace period, invitation rules). Troubleshooting was written from real runs: the published agent 1.0.19 against a live hub with a bogus key, against a stand-in hub for INVALID_SIGNATURE/SCOPE_MISSING/AUTH_FAILED/AGENT_LIMIT_REACHED, and against slow local servers for the timeout behavior; sdk 1.1.0 from npm for the client behavior. Existing pages that said the hub gives 30 s (Limitations, Quickstart, Webhooks) were corrected, and the four pages check:fresh flagged were re-read and re-verified. Committed a47747d plus 0ba974d (Quickstart API-keys step), no attribution per the brief.",
  "decisions_made": [
    "Generated blocks live inside hand-written pages between MDX comment markers, not as separate _generated pages; every mapping fails loudly instead of guessing",
    "Per-plan rate limit is NOT listed as enforced (deviates from the brief, which said confirmed enforced): re-reading shows it is not reliably enforced anywhere",
    "The one enforced agent limit is documented as flat 5 for every plan, in its own table, not as per-plan values",
    "SDK reference generated from source with per-symbol description overrides where the JSDoc is wrong or internal, and a published-version note where source and 1.1.0 differ (TunnelClient timeout)",
    "Timeout documented by where the wait ends (agent 28 s, hub 120 s, SDK 30 s), because the published agent's 28 s cap fires first and gives a 502, not a 504",
    "WebSocket support documented as partly working with the specific failing cases, fixes described as source-only until an agent is published",
    "Dashboard documented from code reading, with the two gaps found (personal account absent from sidebar; PAST_DUE blocks agent registration) stated as found"
  ],
  "bugs_found_fixed": [
    "Limitations, Quickstart and Webhooks said a slow server gives a 504 after 30 s; with agent 1.0.19 it is a 502 at 28 s, and it was already so before the hub timeout change",
    "Quickstart told readers to open 'your account's API Keys page' without noting the sidebar lists organizations only"
  ],
  "bugs_found_unfixed": [
    "Per-minute rate limit effectively unenforced: HubAuthService.authenticateAgent hardcodes rateLimitPerMinute -1; public tunnel HTTP checks no key; TunnelClient limit reverts to unlimited when the 5-minute cache entry expires (rowToCache -1). Contradicts the brief's premise and internal-tools/api Known Risk #4",
    "Agent 1.0.19 retries once a second forever on INVALID_SIGNATURE and SCOPE_MISSING (only AUTH_FAILED/VERSION_UNSUPPORTED stop it); the backoff resets each attempt",
    "The hub only accepts agents for accounts with status ACTIVE, so a PAST_DUE account is refused during the 7-day 'grace period' (read from code, not tested with a real overdue account)",
    "Billing upgrade dialog hardcodes prices and feature bullets ('5 team members', '50 active tunnels') that match neither PLAN_LIMITS nor anything enforced",
    "Sidebar lists ORGANIZATION accounts only; a user with only a personal account has no sidebar link to API keys/tunnels",
    "Published agent 1.0.19 still has the 28 s local-call cap and the batching WS relay; the 120 s change and the WS Phase 1 fixes are unreleased",
    "sdk 1.1.0 TunnelClient still defaults to 30 s; source says 120 s (unreleased)",
    "ClientConfig.accountSlug JSDoc says 'found in your dashboard' (false); several JSDoc comments mention internal notes (worked around by overrides)",
    "Whether the production hub has the 120 s timeout or the WS Phase 1 fixes deployed could not be established from the repo"
  ],
  "files_changed": [
    "apps/docs/scripts/generate.mjs (new), apps/docs/scripts/check-fresh.mjs, apps/docs/package.json, apps/docs/content-config/{env-vars,enforced-limits,scopes,sdk-notes}.json (new)",
    "apps/docs/content/docs/{cli/reference,sdk/{overview,http-client,websocket-client,errors},reference/{plans-and-limits,environment-variables,scopes,http-status-codes},dashboard/*,troubleshooting/{index,faq}}.mdx (stubs -> real)",
    "apps/docs/content/docs/{limitations,getting-started/{quickstart,concepts},index,integrations/{nextjs,standalone-cli,webhooks}}.mdx (30 s claims, WS section, flag table -> link, re-verified)",
    "internal-tools/{docs,shared,user-frontend}/{context,decision,backlog}.md, internal-tools/docs/session_update.md"
  ],
  "gate_results": {
    "check:fresh": "ok, 27 pages, 2 stubs skipped (includes generate --check)",
    "generator failure modes exercised": "hand-edited generated block, env var missing from manifest, unclassified plan limit, stale SDK note key, unmapped scope: each exits 1 with a specific message",
    "cli help": "repo build of packages/agent identical to npm @vhyxvoid/agent@1.0.19 for --help, start --help, init --help",
    "docs typecheck + build": "pass (32 static pages)",
    "turbo typecheck+build --filter=!web": "pass 18/18",
    "root pnpm test": "pass 32 files / 203 tests",
    "docs crawl (next start :4002)": "29 pages 200; 455 internal links and anchors resolve; no stub callout except changelog and cli/configuration; no raw pipes or marker comments in rendered HTML",
    "live checks": "hub.vhyxvoid.com reachable via Cloudflare (cert notAfter Nov 27 2026); published agent 1.0.19 with a bogus key prints 'Fatal error: API key not found' and stops",
    "not run": "dashboard in a browser (code read only); agent with a REAL key on the live hub; account-status and PAST_DUE behavior with a real account; Vite/socket.io/Next HMR through a real tunnel; middleware/next timeout behavior (only the agent and sdk were run)"
  },
  "open_items_for_next_session": [
    "Publish the agent (28 s cap fix + WS Phase 1) and sdk, then re-verify Troubleshooting timeout table and WS section, and the sdk-notes.json TunnelClientConfig.timeout note",
    "Product decision: should a PAST_DUE account's agents be refused? Should the rate limit be enforced, or the plan copy changed?",
    "Fix ClientConfig.accountSlug JSDoc at source and drop the description overrides that become unnecessary",
    "Walk the dashboard in a browser against the local dev backend and correct anything the code read got wrong",
    "cli/configuration and changelog stubs; put check:fresh in CI (needs fetch-depth 0 and a built agent for the CLI block)"
  ],
  "context_md_updates_needed": [
    "internal-tools/api/context.md Known Risk #4 ('rate limiting enforced end-to-end') is wrong, see shared/backlog",
    "internal-tools/shared/context.md Known Risk #2: hub cert is valid again (notAfter Nov 27 2026, checked 2026-09-21)"
  ]
}
```

---

```json
{
  "session_id": "2026-09-21-docs-after-agent-1.0.20-publish",
  "date": "2026-09-21",
  "agent": "claude-code",
  "repo": "Black-Server (apps/docs)",
  "brief_summary": "Re-verify the published agent 1.0.20 / next 1.0.5 / middleware 1.0.5 and update apps/docs to match; close out the deliberately red check:fresh.",
  "status": "completed",
  "summary": "Installed the three packages from npm into scratch dirs and ran the stand-in-hub harness on each (all three pass: 33 s request answered 200 with a 60 s hub budget, 6/6 burst frames as top-level messages with close after the last, backend socket closed on link drop). Greps of the published bundle: toSendableCloseCode 3, batcher.add(frame) 0, msg.timeoutMs 1; wrappers install no ws/axios/better-sqlite3; CLI --help output byte-identical to the docs block. Hub source confirmed timeoutMs = configured - 2000 (old hub 30000 - 2000). A 5 s hub budget against the published agent gave 'timeout of 5000ms exceeded'. Bumped verified.packages on all pages (agent 1.0.20, middleware/next 1.0.5), rewrote the 28 s wording (Limitations, Quickstart, Webhooks, FAQ, Troubleshooting, HTTP status codes, Environment variables) and the WS 'not in any released agent' wording (Limitations, Troubleshooting), repointed verified.commit to 377c924 on the seven pages whose sources the bump commit touched (package.json only). check:fresh green, docs build passes.",
  "decisions_made": [
    "docs/decision.md 2026-09-21: Docs after agent 1.0.20 / next+middleware 1.0.5 went live"
  ],
  "bugs_found_fixed": [],
  "bugs_found_unfixed": [],
  "files_changed": [
    "apps/docs/content/docs/** (23 pages: frontmatter versions; prose in limitations, troubleshooting/index, troubleshooting/faq, getting-started/quickstart, reference/http-status-codes, reference/environment-variables, integrations/webhooks, cli/reference)",
    "internal-tools/docs/backlog.md",
    "internal-tools/docs/decision.md"
  ],
  "gate_results": {
    "verify_agent_packed_cli_npm": "pass",
    "verify_agent_packed_next_npm": "pass",
    "verify_agent_packed_middleware_npm": "pass",
    "check_fresh": "ok (27 pages, 2 stubs)",
    "docs_build": "pass"
  },
  "open_items_for_next_session": [
    "Not run against the production hub: whether it runs the hub half of WS Phase 1 and the configurable timeout is unconfirmed, so the docs hedge on it",
    "Backlog: after the next sdk release, drop the sdk-notes.json 1.1.0-vs-source note and re-verify the TunnelClient 30 s figures"
  ],
  "context_md_updates_needed": []
}
```
