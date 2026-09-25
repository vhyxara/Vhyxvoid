# CA-0037: Two wasted Redis commands per tunnelled request

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | hub (apps/hub) |
| Type | Performance |
| Severity | Medium |
| Status | Fixed |
| Source | new finding (audit part2 A5 area) |
| Commit | `3c66040` (branch `backlog`) |
| Session | `2026-09-25-decisions-and-e2e` |

## Problem

Every tunnelled request did `SET hub:pending:<id>` and a later `DEL`, billed per command on Upstash.

## Root cause

Written for a multi-hub design that doesn't exist; nothing reads the key.

## Fix

PendingRegistry is in-memory only (constructor keeps an unused optional Redis parameter so callers don't change).

## Files changed

- `apps/hub/src/registry/Pending.registry.ts`

## Tests

- Full suite; e2e run leaves zero `hub:pending:*` keys

## Verification

Local Redis scan after a 53-step run: 0 keys (was one per in-flight request).

## Follow-ups / not done

The per-request `tunnel:sub:*` GET could be cached in-process for the single-hub deployment.
