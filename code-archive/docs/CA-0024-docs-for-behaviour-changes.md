# CA-0024: Docs updated for this session's behaviour changes

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Component | docs (apps/docs) |
| Type | Addition |
| Severity | n/a |
| Status | Done |
| Source | claude.md rule: public surface of packages/{agent,sdk,middleware,next} changed |
| Commit | `fccf1dd` (branch `backlog`) |
| Session | `2026-09-25-backlog-sweep` |

## Problem

Troubleshooting said the agent prints INVALID_SIGNATURE/SCOPE_MISSING/AGENT_LIMIT_REACHED "over and over"; Express, Next.js and Limitations did not describe the new signal, CI and cache behaviour.

## Root cause

Source changed in this session.

## Fix

Added "changed in source 2026-09-25, not released yet" notes to troubleshooting/index.mdx (3 rows), integrations/express.mdx (Stopping), integrations/nextjs.mdx (CI) and limitations.mdx (Cached responses), in the docs' existing style.

## Files changed

- `apps/docs/content/docs/troubleshooting/index.mdx`
- `apps/docs/content/docs/integrations/express.mdx`
- `apps/docs/content/docs/integrations/nextjs.mdx`
- `apps/docs/content/docs/limitations.mdx`

## Tests

- n/a

## Verification

`@vhyxvoid/docs` build: 32/32 pages. `check:fresh` flags only pre-existing staleness from the `1013714` version bump, plus pages it can't check in this shallow clone.

## Follow-ups / not done

Update these notes once agent/middleware/next are published.
