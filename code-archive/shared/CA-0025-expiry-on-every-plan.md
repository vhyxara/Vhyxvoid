# CA-0025: API-key expiry allowed on every plan

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | shared (packages/*, nginx, monorepo tooling) |
| Type | Product decision |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/user-frontend/backlog.md (2026-09-21); decided 2026-09-25 by the user |
| Commit | `4a3131f` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

`PLAN_LIMITS.FREE.expiryAllowed` was `false`, yet nothing enforced it, the dashboard offered the expiry field on every plan and the docs promised it.

## Root cause

The flag was written as a paid feature and never wired up.

## Fix

`expiryAllowed: true` on FREE (all plans now). Expiry limits the damage of a leaked key, so it is not gated behind payment. `enforced-limits.json` explains why there is nothing to enforce.

## Files changed

- `packages/shared/src/planLimits.ts`
- `apps/docs/content-config/enforced-limits.json`

## Tests

- Docs generator's classification check (`generate --check`) passes

## Verification

Full suite and typecheck green.

## Follow-ups / not done

None.
