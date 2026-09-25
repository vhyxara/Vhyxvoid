# CA-0029: End-to-end journey script and an isolated local stack

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Tooling |
| Severity | n/a |
| Status | Done |
| Source | new (user request: test the whole application from zero) |
| Commit | `c415239` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

There was no way to exercise the whole product (api + hub + agent + SDK + billing + admin) end to end, and local `.env` files point at production Neon/Upstash (LOCAL_DEV_BACKEND.md), so live checks risked production data.

## Root cause

No isolated local stack; the email transport required a real Resend account.

## Fix

- `scripts/e2e-journey.mjs`: 53 steps against a running api + hub with real processes: register, verify from the emailed link, the pre-verification takeover scenario, login, personal/org rules, invites and plan limits, API keys, the agent CLI, tunnel HTTP (query, headers, 5 MB body, binary, gzip, cookies, status codes, SSRF guard), WebSocket echo, SSE streaming, cancellation, dashboard tunnels, both SDK clients, usage counters, rate limit (429), revoke eviction (agent exits 1), billing via signed Stripe webhooks, invite accept, member permissions, grace period, cancel, the admin API (roles, abilities, feedback triage in the audit log, disable, logout), refresh, password reset, logout. Env-driven; optional sections for Stripe and admin.
- Local stack used: Postgres 16 and Redis 7 from apt, a ~70-line Upstash REST stand-in over Redis (strings base64, pipelines, multi-exec), no `.env` files, ports 9100/9101, `HUB_DOMAIN=vv.test`.
- `ConsoleEmailService` (see CA-0030's commit) lets the script read verification, reset and invitation links.

## Files changed

- `scripts/e2e-journey.mjs`

## Tests

- The script is the test; each fix below was found by it and got its own unit test

## Verification

scripts/e2e-journey.mjs (full run: 53/53 steps, local stack)

## Follow-ups / not done

Wire it into CI against disposable Postgres/Redis containers; point it at staging after each deploy (post-deploy smoke test, audit part2 A9).
