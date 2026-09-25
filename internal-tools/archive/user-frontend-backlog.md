# Backlog archive — user-frontend

Resolved items from `internal-tools/user-frontend/backlog.md`, moved here instead of
being deleted. Append-only, oldest first. Each entry keeps the original item
text and adds one line:

`Resolved <YYYY-MM-DD>, <commit(s) or session_id>, <one-line fix description>`

Items deleted from the backlog before this archive existed (2026-09-24) are
not reconstructed here, except where a session had the original text on hand.

**Scope: apps/web.**

## Archive

- [ ] `libs/components/Confirmation.tsx`'s `ConfirmationProps` has no
  `disabled` prop, and `libs/table/RowAction.tsx`'s `type: 'confirmation'`
  branch never forwards `action.disabled?.(row)` to it — unlike the
  `click`/`dialog` action types, which both do. Found 2026-09-18 while
  fixing the equivalent, actively-exercised bug in `apps/admin` (its copy
  of these same two files — see `internal-tools/admin-frontend/backlog.md`'s
  fix history and `decision.md`, 2026-09-18): confirmed via grep that no
  `apps/web` call site currently sets `disabled` on a `confirmation`-type
  row action, so this is a latent gap here, not an active bug — nothing in
  `apps/web` needs the fix today. Not fixed in this repo (out of scope for
  the apps/admin session that found it); if a future `apps/web` screen ever
  needs a guarded confirmation-type row action, add `disabled?: boolean` to
  `ConfirmationProps` and pass it through in `RowAction.tsx`, matching the
  fix already applied in `apps/admin`.
  Resolved 2026-09-25, fc9612c (session 2026-09-25-backlog-sweep), Confirmation gains disabled and RowAction passes it. Not latent after all: MembersTable's Remove and ApiKeysView's Revoke set disabled and it was being ignored; code-archive/user-frontend/CA-0021.
- [ ] `CreateApiKeyDialog` offers an expiry date to every plan although `expiryAllowed` is false on FREE and nothing enforces it; either enforce it in the API or hide the field on FREE. Found 2026-09-21. **Update 2026-09-25 (session 2026-09-25-backlog-sweep):** left open as a product call. `PLAN_LIMITS.FREE.expiryAllowed` is `false`, but `apps/docs` (`dashboard/api-keys.mdx`, `getting-started/concepts.mdx`) tells every plan it can set an expiry, so enforcing it removes a documented feature from FREE and hiding it needs the docs changed too.
  Resolved 2026-09-25, 4a3131f (session 2026-09-25-decisions-and-e2e), decided: expiry is allowed on every plan (PLAN_LIMITS.FREE.expiryAllowed = true); code-archive/shared/CA-0025.
- [ ] Personal account, pages that are reachable but not offered in the sidebar: `PATCH /account/organizations/:id` on a PERSONAL account throws `Cannot rename a personal account` from the domain entity and comes back as a **500 INTERNAL_ERROR** (should be a 4xx), and `OrgSettingsView`'s rename form would surface it if someone opens `/organizations/<personalId>/settings` by URL. Members (invite a second person into a personal account?) and Billing (can a personal account subscribe? the API's FREE-tier error says "Upgrade to Pro", so a FREE personal user has no Billing link to act on) have no agreed product meaning, so the sidebar deliberately omits them. Needs a product answer, then either guard the routes/UI or offer them. Found 2026-09-21. **Update 2026-09-25 (session 2026-09-25-backlog-sweep, b9c9f67):** the rename now answers 403 `Cannot rename a personal account` (not a 500; code-archive/api/CA-0007). The product question about Members/Billing for personal accounts is still open.
  Resolved 2026-09-25, 4a3131f (session 2026-09-25-decisions-and-e2e), decided: personal workspaces show Billing and refuse invites with a 403 on every plan (rename already 403 since b9c9f67); code-archive/api/CA-0027.
- [ ] `BillingView.tsx`'s upgrade dialog hardcodes prices (`$29 / month`, `$99 / month`) and feature bullets ("5 team members", "50 active tunnels", "Unlimited tunnels", "Custom SLA") that match neither `PLAN_LIMITS` (Pro: 10 members, 5 agents) nor anything enforced. Read the real price/limits from the API or drop the bullets. The docs do not repeat them. Found 2026-09-21.
  Resolved 2026-09-25, 4a3131f (session 2026-09-25-decisions-and-e2e), bullets now come from billingPlans.ts, checked against PLAN_LIMITS by tests/e2e/billingPlansMatchLimits.test.ts; price labels env-configurable; code-archive/api/CA-0027.
