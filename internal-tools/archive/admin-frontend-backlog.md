# Backlog archive — admin-frontend

Resolved items from `internal-tools/admin-frontend/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: apps/admin.**

## Archive

- [ ] `apps/api` has no `trustProxy`, and its only limiter is a global `max 100 / 1 min` (`register.plugin.ts:45`), so behind nginx all clients likely share one bucket (inferred from config, not tested live). Set `trustProxy` for the nginx/Cloudflare hop and add a tighter per-IP limit on `POST /admin/identity/auth/login` (and the user login).
Resolved 2026-09-24, 5e255b0, trustProxy limited to loopback/private-network peers (nginx), limiter registered first, per-IP login limits (user 10/min, admin 5/min); audit H1.
