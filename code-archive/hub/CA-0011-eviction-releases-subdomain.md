# CA-0011: Evicted agents left their tunnel:sub:* Redis entry behind

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | hub (apps/hub) |
| Type | Bug fix (leak) |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/hub/backlog.md (seen live 2026-09-24, H3 session) |
| Commit | `96e9c69` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

After a heartbeat eviction or an account/key sweep eviction, the agent's `tunnel:sub:<slug>--<label>` key stayed in Redis until a public request found no live agent and cleaned it up.

## Root cause

Both evictions remove the session from `AgentRegistry` before closing the socket, so `Message.router`'s `onAgentClose` finds no session and skips `subdomainRegistry.unregister`.

## Fix

New `utils/releaseSubdomain.ts`: looks up the account slug and calls `SubdomainRegistry.unregister(label, slug, agentId)` (a compare-and-delete, so a fresh reconnect is left alone). `HeartbeatService.evict` and `AccountStatusSweepService.evict` call it fire-and-forget; `HubServer` wires the dependency into both.

## Files changed

- `apps/hub/src/utils/releaseSubdomain.ts (new)`
- `apps/hub/src/services/Heartbeat.service.ts`
- `apps/hub/src/services/AccountStatusSweep.service.ts`
- `apps/hub/src/HubServer.ts`

## Tests

- tests/e2e/evictionReleasesSubdomain.test.ts (new): helper unregisters under the account slug; no-op without a slug; never throws; a heartbeat eviction calls unregister

## Verification

New tests plus existing heartbeat (3) and sweep (12) tests green.

## Follow-ups / not done

Subdomain keys still have no TTL (shared backlog, item (d)); a crashed hub's keys survive until it restarts.
