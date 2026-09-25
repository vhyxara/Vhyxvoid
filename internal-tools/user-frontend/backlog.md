# Backlog — apps/web

Small, already-diagnosed, non-urgent items — not the big architectural
questions tracked in context.md's Known Risks/Gaps (numbered items). When an item here is fixed, move it (original text unchanged) to
`internal-tools/archive/user-frontend-backlog.md` with a `Resolved <date>, <commit/session>,
<one-line fix>` line; don't check it off here and don't delete it outright.

**Scope: apps/web (consumer dashboard, @vhyxvoid/web).**

## Backlog

- [ ] apps/web's `@tanstack/react-query` is pinned to an exact version
  (`5.102.8`, no caret) instead of a range, to force-match the
  separately-linked `vhyx-api-kit` sibling repo's own independently
  locked devDependency version and avoid a duplicate-package-instance TS
  private-field mismatch on `QueryClient`. Fragile: if either repo's
  locked version drifts again, the mismatch can recur. Real fix would be
  making `vhyx-api-kit` not carry its own separately-resolved copy of a
  package it also declares as a peerDependency (workspace-linking it
  into the same node_modules, or a pnpm `overrides` entry pinning it
  repo-wide) — deferred as more invasive than this session's scope.
  Found 2026-09-16 (decision.md, "Phase 4 part 4: dead-.jsx-pile
  archiving + @mui package.json cleanup").
- [ ] `Register.tsx`'s new `grid grid-cols-2 gap-4` (matching
  `ProfileView.tsx`'s already-shipped precedent) doesn't match this app's
  own `theme.spacing(N)` → Tailwind-`N` mapping: MUI's `Grid spacing={2}`
  would map to `gap-2` by that convention, but both real usages use
  `gap-4` instead. Not resolved — matched the existing precedent for
  consistency per explicit instruction, but the spacing-unit-math
  discrepancy itself is unexplained and worth a small design-system
  cleanup pass later (either the mapping convention or these two
  components is wrong). Found 2026-09-16, Phase 4 part 3 session
  (decision.md, "Phase 4 part 3").
- [ ] `BillingView.tsx`'s upgrade dialog hardcodes prices (`$29 / month`, `$99 / month`) and feature bullets ("5 team members", "50 active tunnels", "Unlimited tunnels", "Custom SLA") that match neither `PLAN_LIMITS` (Pro: 10 members, 5 agents) nor anything enforced. Read the real price/limits from the API or drop the bullets. The docs do not repeat them. Found 2026-09-21.
- [ ] `CreateApiKeyDialog` offers an expiry date to every plan although `expiryAllowed` is false on FREE and nothing enforces it; either enforce it in the API or hide the field on FREE. Found 2026-09-21. **Update 2026-09-25 (session 2026-09-25-backlog-sweep):** left open as a product call. `PLAN_LIMITS.FREE.expiryAllowed` is `false`, but `apps/docs` (`dashboard/api-keys.mdx`, `getting-started/concepts.mdx`) tells every plan it can set an expiry, so enforcing it removes a documented feature from FREE and hiding it needs the docs changed too.
- [ ] Personal account, pages that are reachable but not offered in the sidebar: `PATCH /account/organizations/:id` on a PERSONAL account throws `Cannot rename a personal account` from the domain entity and comes back as a **500 INTERNAL_ERROR** (should be a 4xx), and `OrgSettingsView`'s rename form would surface it if someone opens `/organizations/<personalId>/settings` by URL. Members (invite a second person into a personal account?) and Billing (can a personal account subscribe? the API's FREE-tier error says "Upgrade to Pro", so a FREE personal user has no Billing link to act on) have no agreed product meaning, so the sidebar deliberately omits them. Needs a product answer, then either guard the routes/UI or offer them. Found 2026-09-21. **Update 2026-09-25 (session 2026-09-25-backlog-sweep, b9c9f67):** the rename now answers 403 `Cannot rename a personal account` (not a 500; code-archive/api/CA-0007). The product question about Members/Billing for personal accounts is still open.
- [ ] Route segment and dashboard copy still say "organizations" for personal accounts: URLs are `/organizations/<accountId>/api-keys` and the API prefix is `/apikeys/organizations/...` even for a PERSONAL account, and the dashboard table's title is "My organizations" with an "Organization" column header while it lists the personal account too. Cosmetic; renaming routes is a wider change. Found 2026-09-21.
- [ ] `pnpm turbo run typecheck`/`build` fail on `@vhyxvoid/web` with 23 `TS7006` implicit-any errors (e.g. `src/libs/components/Confirmation.tsx:181`, `TablePaginationComponent.tsx:41`, `layout/vhyxui/DashboardSidebar.tsx:97`, `table/GenericServerTable.tsx:125`), all callback parameters whose types normally come from `@vhyxui/react`. Reproduced on a clean `99ca4e4` checkout, so not caused by any recent commit here; most likely the linked sibling `../VhyxUI` checkout's current state (it has uncommitted changes and an untracked `packages/visual-runtime/`) no longer provides those types. Every other workspace passes. Found 2026-09-24, usage-drain fix session; not investigated further. **Root cause found 2026-09-24 (audit H8/H9/H11 session):** the sibling `../VhyxUI` checkout has no `node_modules` at all, so every link inside `VhyxUI/packages/react/node_modules` (e.g. `react -> ../../../node_modules/.pnpm/react@19.2.6/…`) dangles and `@vhyxui/react`'s own types don't resolve. Fix is in that repo (`pnpm install` in `../VhyxUI`, which also has uncommitted work of its own), not here. `apps/admin` has the same failure (admin-frontend backlog); it only looked green because turbo had its typecheck cached. **Also (2026-09-25):** apps/web's own vitest run has 3 files that fail to load (`useMe`, `useTunnels`, `account.keys` tests) because `../vhyx-api-kit/dist/queryClient.js` can't resolve `@tanstack/react-query`: the same sibling-repo class of problem; identical with and without the H10 change.
- [ ] **Feature proposals (audit part2), dashboard side:** F7 agent fleet view (version, uptime, last pong, in-flight, outdated-agent banner, disconnect/rotate buttons), F13 per-key and per-tunnel usage charts + CSV export (needs the api H4-remainder backlog item first), F14 account audit-log UI and export (`AuditLog` table exists). See `shared/audit-2026-09-24-part2.md` section 5. Filed 2026-09-25 from audit part2 (session 2026-09-25-audit-part2-fixes).
- [ ] **Member removal: offer a choice for the removed person's API keys.** Since `8babfbc` (audit part2 G9) removal always revokes the member's active keys in the organization. A dialog option "rotate and transfer to me" (new secret shown to the remover) would let a team keep a key's integrations running; plain reassignment is not safe (the removed member still holds the old secret). Needs a small api parameter too. Found 2026-09-25, session 2026-09-25-audit-part2-fixes.
