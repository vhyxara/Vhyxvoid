# Product roadmap: value order

Owner asked (2026-10-06) to build features "in your order of value" and to
launch free, charging later, with every limit and price controlled from the
admin panel. This file is the order used and what comes next. Update it when
an item ships (move it to *Shipped* with its commits) or the order changes
(say why, with the date).

## How items are ranked

1. **Does it make someone pick VhyxVoid over ngrok / Cloudflare Tunnel today?**
   Daily-use developer pain first (seeing and replaying traffic, not losing
   webhooks), then things teams need to use it in production (domains, alerts).
2. **Can the operator turn it on/off and limit it per plan from the console?**
   Every feature ships with a `features.*` switch and a plan limit, so the
   free launch can be generous and paid plans can be shaped later with no deploy.
3. **Does it compound?** Prefer features that create data or hooks other
   features reuse (inspector capture -> replay -> inbox; minute stats -> alerts -> charts).
4. **Cost and risk to run.** Cheap to operate and fail-closed beats clever.

## Shipped (branch `claude/upbeat-cannon-dwqaj0`)

| # | Item | Why at this position | Commits |
| --- | --- | --- | --- |
| 0 | Production pass: admin panel (users, accounts, keys, tunnels, billing, logs, settings, CMS), hub hardening, redesign, docs | Prerequisite: operators must run the product without a developer | f967f8a..d83c422 |
| 1 | Billing from the console: free launch mode, default plan, Stripe prices | Owner's explicit ask; unblocks launching free and charging later | 2112350, b40230c |
| 2 | Request inspector and replay | Most-used daily feature of any tunnel tool; base for replay and inbox | 63eeae4, 98dd3ce |
| 3 | Tunnel access rules (password, IP allowlist, expiring share links) | Sharing a local app safely is the #1 reason teams need more than a raw URL | 320c1fd, ed140a1 |
| 4 | Webhook inbox (hold while offline, deliver in order on reconnect) | Unique vs. competitors; fixes the biggest pain of webhook development | 00aae30, 48439cc |
| 5 | Custom domains with automatic HTTPS | Needed for staging/demo/production use; the main reason to pay | 0ad047c, 9d3beac, 8b4f728 |
| 6 | Alerts (offline, error rate, usage, inbox failures, domain changes) | Teams rely on tunnels once they have domains; they must know when one breaks | 0ad047c, 9d3beac, 8b4f728 |

## Next, in order

1. **Usage and traffic charts** on the Tunnels page and the account overview,
   from `tunnel_minute_stats` (already collected) with `@vhyxchart/react`.
   Small, data exists, makes the value visible; supports upgrade decisions.
2. **Trial-ending and quota-reached alerts/emails** (USAGE at 100 %, trial
   ends in 3 days). Needed the moment paid mode is switched on; reuses the alert engine.
3. **Team activity feed** (who created keys, rules, domains; agent
   connects/disconnects) from the existing audit log. Low cost, needed by teams.
4. **GitHub Action for preview environments** (start an agent in CI, post the
   URL on the pull request, tear down on close). Growth channel: every PR shows the product.
5. **CLI `vhyxvoid doctor`** (checks token, connectivity, local port, DNS of
   custom domains). Cuts support load before user numbers grow.
6. **Pricing shape for when paid mode starts**: annual prices, usage-based
   overage (requests over the plan) through Stripe metered billing. Only once
   there are enough users to price against; the console already holds plans and prices.

Later / on demand: traffic policies and mock responses (rewrite headers,
inject latency/errors, offline mocks), Slack-formatted alert channel,
per-account opt-out of inspector capture, multi-hub (pub/sub invalidation of
policy and domain caches), WebSocket frame capture.

## Before launch (not features, but block going live)

- Deploy per `apps/docs/content/docs/operators/deployment.mdx`: images, env,
  `seed`, Cloudflare Access for the admin host, `ACME_EMAIL`, the
  `edge.vhyxvoid.com` record (DNS only) and the **Custom domain target** setting.
- Re-verify the stale user docs pages (`internal-tools/docs/backlog.md`).
- api backlog: absolute session lifetime + pruning (M23), CMS optimistic lock.
