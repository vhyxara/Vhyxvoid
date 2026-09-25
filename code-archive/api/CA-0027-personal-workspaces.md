# CA-0027: Personal workspaces: Billing shown, members refused

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | api (apps/api) |
| Type | Product decision |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/user-frontend/backlog.md (2026-09-21); decided 2026-09-25 by the user |
| Commit | `4a3131f` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

A FREE personal user was told "Upgrade to Pro" but had no Billing link; Members had no defined meaning (a PRO personal account's maxMembers of 10 would have allowed invites).

## Root cause

No product rule for personal accounts.

## Fix

- `InviteMemberUseCase` refuses invites to a personal workspace with 403 "Personal workspaces can't have members. Create an organization to work with a team.", on every plan.
- apps/web sidebar shows Billing to the owner of a personal workspace (checkout already worked for any account type).
- While there: the upgrade dialog's bullets ("5 team members", "50 active tunnels", which matched nothing) now come from `billingPlans.ts`, checked against `PLAN_LIMITS` by a test; `planFeatures(plan, personal)` can leave out team members; price labels are env-configurable.

## Files changed

- `apps/api/src/modules/identity/application/use-cases/account/InviteMember.usecase.ts`
- `apps/web/src/libs/layout/vhyxui/DashboardSidebarNav.tsx (+ its test)`
- `apps/web/src/views/org/billing/{BillingView.tsx,billingPlans.ts}`

## Tests

- tests/e2e/inviteMemberPlanLimit.test.ts: personal workspace on PRO is refused with 403 and no invitation is created
- tests/e2e/billingPlansMatchLimits.test.ts (new)
- apps/web DashboardSidebarNav.test.tsx updated (can't run here: sibling repos missing)

## Verification

Root suite green; apps/web tsc error set unchanged.

## Follow-ups / not done

Resolves the user-frontend BillingView hardcoded-prices item too. The Members page for a personal account is still reachable by URL (read-only; invites now fail with a clear 403).
