# CA-0013: subdomainRegistryRace test flaked under CPU load

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | hub (apps/hub) |
| Type | Test fix (flake) |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/hub/backlog.md (found 2026-09-22) |
| Commit | `96e9c69` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

"operations on different labels are not serialized" asserted `elapsed < 35` ms on two 20 ms operations; it failed at 43 ms and 79 ms under load.

## Root cause

Wall-clock assertion.

## Fix

The fake Redis `SET` now waits until both operations are in flight (with a 1 s fallback); the test asserts `maxInFlight === 2`. If the labels were serialized, only one could ever be in flight.

## Files changed

- `tests/e2e/subdomainRegistryRace.test.ts`

## Tests

- Same test, rewritten

## Verification

Ran 3 times in a row plus the full suite.

## Follow-ups / not done

None.
