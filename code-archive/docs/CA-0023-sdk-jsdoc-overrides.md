# CA-0023: Wrong/internal SDK JSDoc papered over by docs overrides

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | docs (apps/docs) |
| Type | Docs source fix |
| Severity | Low |
| Status | Fixed |
| Source | internal-tools/docs/backlog.md (found 2026-09-21) |
| Commit | `d61f681` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

`ClientConfig.accountSlug` said the slug is "found in your dashboard" (it is not shown there); `TunnelResponse.body` referred to internal notes; `TunnelClientConfig.hubUrl/timeout/localDiscovery` used a placeholder host, an internal constant name and an unmeasured latency claim. `sdk-notes.json` overrode all five.

## Root cause

JSDoc written for maintainers, not users.

## Fix

Rewrote the five source comments with the user-facing text (single line each: the generator copies JSDoc into a table cell, and a newline breaks the table) and deleted the five overrides.

## Files changed

- `packages/sdk/src/client.ts`
- `packages/sdk/src/types.ts`
- `apps/docs/content-config/sdk-notes.json`

## Tests

- `node scripts/generate.mjs --check`: generated blocks up to date (the generated pages did not change)

## Verification

generate:check and the docs build green.

## Follow-ups / not done

The 1.1.0-vs-source timeout note stays until the next SDK release.
