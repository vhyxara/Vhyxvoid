# Product roadmap: value order

Latest handoff: `internal-tools/HANDOFF-2026-10-06.md`.

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

## Shipped (branch `claude/vhyxvoid-production-stable-zfjdqv`, 2026-10-06)

| # | Item | Notes | Commits |
| --- | --- | --- | --- |
| 7 | Usage and traffic charts (Tunnels page, overview, console dashboard) | Plain SVG chart in apps/web: @vhyxchart is a diagram library with no data charts. Palette validated for the dark surface | 349ff83 |
| 8 | Usage 80/100 % and trial-ending notices (in-app + email, exactly once) | No rule needed; console switches `billing.usageNotices`, `billing.trialNoticeDays` | 349ff83 |
| 9 | Team activity feed + CSV export | Platform mutations recorded by one route table; tunnel connects/disconnects merged in | 349ff83 |
| 10 | GitHub Action for preview environments (`actions/tunnel`) | Must move to a public repo to be usable by customers (shared backlog) | d28cd42 |
| 11 | CLI `vhyxvoid doctor` | Ships with the next agent publish | 4ef82d9 |
| 12 | Traffic rules: mocks, injected errors and latency, redirects, path rewrites, header changes, offline answers; inspector "Mock this response" | Plan limit `maxTrafficRules`, switch `features.trafficRules` | 8b8435e, f57a494 |
| 13 | Agent fleet view (health, version, uptime, in-flight, key, stop; console-set recommended/minimum agent version enforced at the hub) | Settings `tunnels.recommendedAgentVersion`, `tunnels.minimumAgentVersion` | 51d08e7 |
| — | Launch backlog: absolute session lifetime + pruning (M23), admin lockout, CMS optimistic lock, weighted usage mean, tunnel-password guessing limit, per-workspace inspector opt-out | | 349ff83, ce7ff76, 49499c7 |

## Next, in order (re-ranked 2026-10-06 after items 1-5 shipped)

1. **Publish and distribute** (not code, but the growth step the last two
   features need): agent release with `doctor`, `actions/tunnel` in a public
   repo + Marketplace listing, changelog entry. Without it the Action is
   unusable by customers.
2. ~~Traffic policies and mock responses~~ shipped 2026-10-06 (#12 above).
   Follow-ups if customers ask: rules for WebSocket upgrades, response-body
   rewriting, rule hit counters on the Rules page.
3. ~~Agent fleet view~~ shipped 2026-10-06 (#13 above). Not done: rotating a
   key from the fleet card (it links to API keys, which has rotation).
4. **Per-key usage and traffic CSV** (F13 remainder) and a workspace switcher
   on the overview. Small; supports upgrade decisions.
5. **Account and user deletion (GDPR/DPDP, api backlog G10/F15).** Not a
   feature users choose us for, but a legal requirement before EU marketing.
6. **Pricing shape for when paid mode starts**: annual prices, usage-based
   overage through Stripe metered billing. Still only once there are enough
   users to price against.

Reason for the new order: items 2-3 compound on data and caches built this
month; deletion (5) moves up from "later" because launch marketing will
reach the EU; pricing (6) stays last per the owner's free-first launch.

Later / on demand: Slack-formatted alert channel, multi-hub (pub/sub
invalidation of policy, domain and inspector caches; shared password-guess and
abuse counters), WebSocket frame capture, Terraform provider / API tokens
(api backlog F17).

## Before launch (not features, but block going live)

- Deploy per `apps/docs/content/docs/operators/deployment.mdx`: images, env,
  `seed`, Cloudflare Access for the admin host, `ACME_EMAIL`, the
  `edge.vhyxvoid.com` record (DNS only) and the **Custom domain target** setting.
- Re-verify the stale user docs pages (`internal-tools/docs/backlog.md`).
- Apply this branch's three migrations with the deploy (shared backlog deploy note).
- ~~api backlog: absolute session lifetime + pruning (M23), CMS optimistic lock~~ done 2026-10-06.
