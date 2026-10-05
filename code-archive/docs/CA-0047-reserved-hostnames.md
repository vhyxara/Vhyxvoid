# CA-0047: Could an account slug collide with docs./api./hub./admin./app./www.?

| Field | Value |
| --- | --- |
| Date | 2026-10-05 |
| Component | docs |
| Type | Test fix (verification) |
| Severity | n/a |
| Status | Done |
| Source | internal-tools/docs/backlog.md (found 2026-09-19) |
| Commit | uncommitted (branch `backlog`; not committed at the user's request) |
| Session | `2026-10-05-backlog-sweep` |

## Problem

Open question whether an account slug could take a bare service hostname.

## Root cause

n/a

## Fix

No code change needed: a tunnel host is always `<slug>--<label>` (the hub rejects a host without `--`), every generated slug carries `-<8 random chars>` (audit H11), and nginx's exact `server_name`s for api./hub. take precedence over the wildcard. Added a regression test.

## Files changed

- `tests/e2e/apiBacklogFixes20261005.test.ts`

## Tests

- tests/e2e/apiBacklogFixes20261005.test.ts: "a workspace named after a service host still gets a suffixed slug"

## Verification

Read `HttpTunnelHandler.parseSubdomain`, `slug.util.ts`, `nginx.conf`.

## Follow-ups / not done

None.
