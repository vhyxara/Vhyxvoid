# Backlog archive — docs

Resolved items from `internal-tools/docs/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: apps/docs.**

## Archive

- [ ] Fix `ClientConfig.accountSlug`'s JSDoc in `packages/sdk/src/client.ts` ("found in your dashboard": the dashboard never shows the slug) and the internal-note JSDoc on `TunnelResponse.body`/`TunnelClientConfig.timeout`; then delete the matching `descriptions` overrides in `apps/docs/content-config/sdk-notes.json`. Found 2026-09-21.
  Resolved 2026-09-25, d61f681 (session 2026-09-25-backlog-sweep), rewrote the JSDoc (accountSlug, TunnelClientConfig.hubUrl/timeout/localDiscovery, TunnelResponse.body) and deleted the five overrides; code-archive/docs/CA-0023.
- [ ] Reserve `docs` (and `api`, `hub`, `admin`, `app`, `www`) against account-slug collisions if slug validation permits bare-hostname forms. Found 2026-09-19.
  Resolved 2026-10-05, uncommitted (session 2026-10-05-backlog-sweep), verified not possible: tunnel hosts are always <slug>--<label> and every slug has a random suffix (H11); regression test added; code-archive/docs/CA-0047.
- [ ] `check:fresh` fails on 27 pre-existing user pages (58 findings): package versions moved (agent 1.1.0, middleware 2.0.0, next 1.1.0) and sources changed in this and earlier sessions. Re-verify page by page and bump `verified`. The new `operators/*` pages pass. Found 2026-10-05, session upbeat-cannon.
  Resolved 2026-10-06, review commit after 77c2542 (session upbeat-cannon), every stale page re-read against source and the published npm tarballs (agent 1.0.20, middleware/next 1.0.5, sdk 1.1.0); content fixed where wrong, pins moved to the repo versions with published-vs-source notes; `check:fresh` ok for all 44 pages.
- [ ] `dashboard/billing.mdx` predates the 2026-10-05 billing changes beyond cancellation (upgrade sends a plan name, trial note, checkout switch, personal-workspace billing link). Re-verify with the page above. Found 2026-10-05, session upbeat-cannon.
  Resolved 2026-10-06 (session upbeat-cannon), billing page now covers free mode, the Billing link for personal workspaces, paused upgrades, trial length in the dialog and usage/trial notices.
- [ ] `reference/plans-and-limits` is pinned to `@vhyxvoid/agent@1.0.20`; check its "agent prints the limit and keeps retrying" sentence against 1.1.0 and bump the pin. Found 2026-10-06, session upbeat-cannon (review pass).
  Resolved 2026-10-06 (session upbeat-cannon), AGENT_LIMIT_REACHED is still not fatal in 1.1.0 (keeps retrying, backoff up to 5 min); sentence updated, pin bumped; 'Not listed here' no longer claims custom domains are unenforced or that there is no usage warning.
- [ ] `check:fresh` is not in CI: it needs full git history (`actions/checkout` with `fetch-depth: 0`) because it runs `git log <verified.commit>..HEAD`, and, since 2026-09-21, a built agent (`pnpm --filter @vhyxvoid/agent build`) because it runs `generate --check`, whose CLI blocks execute `packages/agent/dist/cli.js`. Add a job once that's acceptable. Found 2026-09-19.
  Resolved 2026-10-06, session upbeat-cannon: .github/workflows/ci.yml `docs` job (fetch-depth 0, agent build, check:fresh, docs build, check:links), simulated end to end in a clean clone. check-fresh no longer counts a page's own file among its sources (the changelog lists only itself and could never pass).
- [ ] `check:links` (apps/docs/scripts/check-links.mjs, after `next build`) is not in CI. It caught 18 `/docs/...` links rendering as `/docs/docs/...` (404) on 16 pages written 2026-10-05/06. Add it to the docs CI job next to `check:fresh`. Found 2026-10-06, session upbeat-cannon.
  Resolved 2026-10-06, session upbeat-cannon: same `docs` CI job.
