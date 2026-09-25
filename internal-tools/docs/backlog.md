# Backlog — apps/docs

Small, already-diagnosed, non-urgent items — not the big architectural questions tracked in context.md's Open Questions. When an item here is fixed, move it (original text unchanged) to
`internal-tools/archive/docs-backlog.md` with a `Resolved <date>, <commit/session>,
<one-line fix>` line; don't check it off here and don't delete it outright.

**Scope: apps/docs.**

## Backlog

- [ ] Once `DOCS_ORIGIN` is set in production and verified: delete `apps/web`'s `[locale]/(public-pages)/docs/page.tsx` placeholder and the `/^\/docs/` LANDING entry in `src/proxy.ts` (kept now only as the unset-origin fallback). `/pricing` and `/support` are equally stubs. Found 2026-09-19.
- [ ] Reserve `docs` (and `api`, `hub`, `admin`, `app`, `www`) against account-slug collisions if slug validation permits bare-hostname forms. Found 2026-09-19.
- [ ] `check:fresh` is not in CI: it needs full git history (`actions/checkout` with `fetch-depth: 0`) because it runs `git log <verified.commit>..HEAD`, and, since 2026-09-21, a built agent (`pnpm --filter @vhyxvoid/agent build`) because it runs `generate --check`, whose CLI blocks execute `packages/agent/dist/cli.js`. Add a job once that's acceptable. Found 2026-09-19.
- [ ] Re-run the quickstart end to end against a live hub/API with a REAL key: register, create key, `npx @vhyxvoid/agent init`, connect, curl the URL, SDK call. The hub's cert is valid again (notAfter 2026-11-27, checked 2026-09-21) and a bogus-key connect to the live hub was run, but no real-key run has been done. Dashboard steps come from reading `apps/web`, not a browser walk-through. Found 2026-09-19.
- [ ] `sync-tokens` copies (`src/styles/vhyxui-tokens.css`, `vhyxui-brand-override.css`) have no drift check; re-run `pnpm --filter @vhyxvoid/docs sync-tokens` whenever apps/web's linked VhyxUI or brand override changes. Found 2026-09-19.
- [ ] Share the theme preference with apps/web (same origin) if a light mode ever exists; today docs is dark-only. Found 2026-09-19.
- [ ] No `lint` script/ESLint config for apps/docs (web/admin have their own); add when the docs app grows real code. Found 2026-09-19.
- [ ] Unproven root cause: `RootProvider theme={{ attribute: ['class','data-theme'] }}` froze the page renderer. Avoided, not diagnosed — reproduce in isolation before anyone tries to add `data-theme` syncing. Found 2026-09-19.
- [ ] Fumadocs features from the template deliberately dropped for v1: `llms.txt` routes, per-page OG images, "copy as markdown"/view-options buttons. Reconsider after content exists. Found 2026-09-19.
- [ ] Two stub pages remain in the sidebar and search index: `changelog` and `cli/configuration`. Fill them (configuration is mostly covered by "Any stack (CLI)") or hide `stub: true` pages before public launch. Found 2026-09-19, updated 2026-09-21.
- [ ] Untested for the Integrations pages: Windows/Linux, Node versions other than 24, Next versions other than 16.1.1, real-hub WebSocket/HMR through the tunnel, `.env.local` write-back timing on a first Next run. Found 2026-09-19.
- [ ] The Next.js webhook handler was verified with an HMAC over `req.text()`, not with Stripe's `constructEvent` in a Next route; Express and Fastify handlers were verified with the real `stripe` package. Low risk; close by running the Next one too. Found 2026-09-19.
- [ ] Webhooks page has Stripe as the only worked provider; add GitHub (`X-Hub-Signature-256`) and one more once someone can verify them. Found 2026-09-19.
- [ ] Next dev registered the same label twice in one run against the stand-in hub once (2026-09-19, agent 1.0.18-era build) and once only in later runs, including the npm 1.0.4 run; unconfirmed on a real hub. If it happens, add a Next.js note or fix in `@vhyxvoid/next`. Found 2026-09-19.
- [ ] The Quickstart still shows a trimmed console block (just the "Tunnel active" part); the real output also has a dotenv tip line, the version banner and two `[agent]` status lines (mentioned in prose). If dotenv `quiet: true` and the `[agent]` info lines are cleaned up in a future agent release, trim the sentence. Found 2026-09-19.
- [ ] Fix `ClientConfig.accountSlug`'s JSDoc in `packages/sdk/src/client.ts` ("found in your dashboard": the dashboard never shows the slug) and the internal-note JSDoc on `TunnelResponse.body`/`TunnelClientConfig.timeout`; then delete the matching `descriptions` overrides in `apps/docs/content-config/sdk-notes.json`. Found 2026-09-21.
- [ ] After the next sdk release (1.1.0 -> whatever ships the 120 s `TunnelClient` default): drop the 1.1.0-vs-source note in `sdk-notes.json` and re-verify the `TunnelClient` 30 s figures in Troubleshooting's timeout table, Environment variables' timeout bullets and the FAQ. `check:fresh` will flag the pages on the version bump. Found 2026-09-21; agent half closed 2026-09-21.
- [ ] Dashboard guide is from code, not a browser: walk it against the local dev backend (`LOCAL_DEV_BACKEND.md`) and fix column order, labels and the PAST_DUE statement if they differ. Found 2026-09-21.
- [ ] The scopes page says only `tunnel:connect` is checked. If any other scope gains a check, move it in `content-config/scopes.json` (`checked` column). The generator already fails if the dashboard's `AVAILABLE_SCOPES` and `inDashboard` disagree. Found 2026-09-21.
- [ ] Code-sample typechecking (Part 4C) still not built; the SDK/CLI samples in the new pages were run by hand (sdk 1.1.0) but are not checked by a script. Found 2026-09-21.
- [ ] Found 2026-09-22 (E1-E7 investigation, `internal-tools/shared/decision.md`): the docs' 7-day grace-period wording, `context.md`'s "`GracePeriodWorker` suspends hourly", and the plans/limits pages describe the code's intent, not its behavior, until sessions S1 (webhook sets `graceEndsAt`; shipped in source 2026-09-22, `c8b98e6`, not deployed), S3 (hub applies the real plan's agent limit) and S4 (PAST_DUE connectable, live eviction) ship. Re-verify (`check:fresh`) after each; nothing changed in `apps/docs` this session.
