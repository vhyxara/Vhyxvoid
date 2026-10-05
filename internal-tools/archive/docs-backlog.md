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
