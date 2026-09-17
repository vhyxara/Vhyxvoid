# VhyxUI shims — TEMPORARY

These components exist because VhyxUI doesn't yet ship a `Typography` or
`Skeleton` component (confirmed absent in the migration gap-analysis report,
`VHYXUI-MIGRATION-GAP-ANALYSIS.md` (apps/web repo root) — both are cheap to
hand-roll and listed there as MISSING). They are NOT VhyxUI components and NOT permanent parts of
this app.

**TODO: delete this directory and switch call sites to the real
`@vhyxui/react` exports once VhyxUI ships `Typography`/`Skeleton`. See
`decision.md`, 2026-09-10, "Temporary Typography/Skeleton shims" for the
tracking entry — check there before extending these further.**

Rules for anyone touching this directory:
- Don't add props/variants beyond what's needed to unblock the current
  migration step. If a page needs something these don't support, that's a
  signal to either widen VhyxUI's real component or file the gap — not to
  grow the shim into a permanent parallel design system.
- Values consumed here come from `@vhyxui/tokens`' `[data-brand="vhyxvoid"]`
  override (added in VhyxUI's `packages/tokens/src/themes/vhyxvoid.css`,
  2026-09-10) — don't hardcode new values here that aren't already tokens.
