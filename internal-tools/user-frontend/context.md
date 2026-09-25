# Project Context — apps/web

**Scope:** apps/web, the consumer-facing dashboard (`@vhyxvoid/web`, Next.js 16 / React 19). See `internal-tools/shared/context.md` for the monorepo-wide Architecture diagram and cross-cutting flows — not duplicated here (apps/web talks to apps/api over normal HTTP, not part of the tunnel protocol, so it's not part of that diagram anyway).

Migrated 2026-09-17 from the monorepo's single `.claude/context.md`.

## Tech Stack

- **Frontend (apps/web, `@vhyxvoid/web`)**: Next.js 16 / React 19, moved into this monorepo 2026-09-09 from a standalone repo (was `vhyx-void`). Runs on port **4000** (not the default 3000). Deliberately kept OUT of the root TS project-reference graph (own `tsc --noEmit` script instead) and OUT of the root ESLint flat config (own ESLint 8 config) — see `decision.md` for both. **MUI/Vuexy removal is complete as of 2026-09-16** (Phase 4 part 3 — see Directory Structure and decision.md's per-phase entries): `ThemeProvider`/`CssBaseline` and the entire `@core/theme`/`libs/theme` construction machinery that gated them are deleted; zero real `@mui` imports remain in any live, reachable file (two files carry only harmless pre-existing comments naming MUI) — a separate, pre-existing pile of ~37 unreachable dead `.jsx`/`.js` files (`libs/ui/`, `libs/card-statistics/`, `libs/styles/`, most of `libs/components/*.jsx`) still has real `@mui` imports but is out of scope (see backlog.md). VhyxUI is now the app's only UI/theme library, kept in a **separate** sibling repo and consumed via pnpm `link:` — see Configuration & Environment for the linking convention. `@emotion/styled`/`@emotion/react`/`@emotion/cache` remain in `package.json` (still genuinely used directly by `libs/layout/shared/Logo.tsx`, independent of MUI); the now-fully-unused `@mui/*` packages themselves have **not** been removed from `package.json` yet — a small, deliberately-deferred, separate cleanup (see backlog.md).

## Directory Structure

```
apps/
  web/            Consumer-facing dashboard (`@vhyxvoid/web`). Next.js 16 / React 19,
                  moved into the monorepo 2026-09-09. Talks to apps/api over normal HTTP —
                  not part of the tunnel protocol, so not shown in the Architecture diagram
                  above. **VhyxUI migration complete as of 2026-09-14** (Steps 1-5: public
                  marketing pages, auth-flow pages, dashboard shell/nav, simple content
                  pages, and all three GenericServerTable list+CRUD screens). MUI remains
                  present only where explicitly deferred (blank-layout-pages' illustration
                  panels, NotificationBell/FeedbackButton) — see decision.md's per-step
                  entries. Step 6 ("admin-only screens"), the last step in the originally
                  planned sequence, turned out to have no real scope to migrate — see the
                  "No admin frontend exists" item below and decision.md, 2026-09-14.
                  **Committed as a clean baseline 2026-09-16** (was uncommitted since the
                  2026-09-09 move, per decision.md's same-day entry). archived/ (gitignored,
                  local only — same convention as apps/api/archived/) holds confirmed-unused
                  Vuexy template material moved out of the tracked tree, plus older,
                  unrelated pre-existing content (a pre-migration route-group structure)
                  — see decision.md, 2026-09-16.
                  **MUI/Vuexy holdout list corrected 2026-09-16** (fresh audit): "only
                  explicitly deferred: blank-layout-pages illustration +
                  NotificationBell/FeedbackButton" (above) is stale — also live:
                  views/org/{CreateOrgDialog,MyAccountsTable,billing/BillingView,
                  AcceptInvitationView}.tsx, views/profile/FeedbackHistoryTab.tsx +
                  views/feedback/FeedbackDetailDrawer.tsx, contexts/FeedbackContext.tsx
                  (a global confirm/alert Dialog), views/pages/NotFound.tsx. Full inventory
                  and phased removal plan: decision.md, 2026-09-16 ("Fresh MUI/Vuexy
                  dependency audit").
                  **Phase 0 of that plan executed 2026-09-16**: the orphaned pre-Step-3
                  dashboard-shell generation (most of libs/layout/vertical/,
                  libs/layout/shared/{ModeDropdown,UserDropdown}.tsx,
                  @layouts/VerticalLayout.tsx and its subtree), the dead @menu vertical-menu
                  *rendering* subsystem (@menu/vertical-menu/, most of
                  @menu/components|styles|svg|utils/, @core/styles/vertical/*), and ~13
                  standalone dead files (3 of the 4 @core/components/mui/* wrappers,
                  members.columns.tsx, generic unused Vuexy boilerplate) are gone —
                  superseded by libs/layout/vhyxui/* and confirmed zero-importer, per
                  decision.md, 2026-09-16 ("Phase 0 executed"). `@mui` import surface
                  dropped 94→71 files, 209→147 lines.
                  **Phase 1 executed 2026-09-16**: NotFound.tsx (Button/Typography, not its
                  theme-coupled illustration), AuthGuard.tsx (CircularProgress→Spinner),
                  AcceptInvitationView.tsx (its one, genuinely-untheme-coupled
                  styled('img')), and the dashboard layout's ScrollToTop button all
                  migrated to VhyxUI. `@mui` surface now 68 files/142 lines. Hit and fixed a
                  real Turbopack SSR build break: importing `@vhyxui/react`'s `Button`
                  directly into `(dashboard)/layout.tsx` (a genuine Server/Client
                  boundary-crossing file, no `'use client'` of its own) broke `/profile`'s
                  production build — fixed by extracting to a dedicated client component,
                  `@core/components/scroll-to-top/ScrollToTopButton.tsx`. See decision.md,
                  2026-09-16 ("Phase 1 executed").
                  **Phase 2 executed 2026-09-16**: `views/org/{CreateOrgDialog,MyAccountsTable,
                  billing/BillingView}.tsx`, `contexts/FeedbackContext.tsx` (the global
                  confirm/alert Dialog), and `views/profile/FeedbackHistoryTab.tsx` +
                  `views/feedback/FeedbackDetailDrawer.tsx` all migrated to VhyxUI — six
                  files, the full "org/profile view migrations" bucket from the audit's
                  plan. **Phase 2 vs Phase 3 scope question resolved**: FeedbackHistoryTab/
                  FeedbackDetailDrawer have zero import/dependency relationship with
                  FeedbackButton.tsx (confirmed by grep — separate read-only views over
                  feedback data vs. the submission form itself), so they belonged in Phase 2
                  with the other independent views, not deferred to Phase 3's
                  FeedbackButton rebuild as one earlier decision.md entry had assumed.
                  `@mui` surface: 69 files/142 lines (re-confirmed via `git stash` diff,
                  correcting Phase 1's own "68/142" note as an off-by-one) → **63 files/105
                  lines**. See decision.md, 2026-09-16 ("Phase 2 executed").
                  **Phase 3 part 1 executed 2026-09-16**: `views/notification/
                  NotificationBell.tsx` migrated to VhyxUI (`Popover`, matching
                  `ModeDropdown`/`UserDropdown`'s established pattern; `Tooltip` — confirmed
                  available in VhyxUI despite `ModeDropdown`'s stale "no equivalent"
                  comment, see decision.md). Found and fixed a real, pre-existing bug via
                  functional testing: `AppNotification.message` never matched the real
                  API's field name (`body`) — every notification body has rendered blank
                  since this feature shipped, MUI version included. `@mui` surface: 63
                  files/105 lines → **62 files/90 lines**. `FeedbackButton.tsx`'s full
                  migration plan was produced but not executed — its own follow-up
                  session, see decision.md, 2026-09-16 ("Phase 3 part 1") for the complete
                  plan (VhyxUI has no `Fab`/`Collapse` equivalent; `TextareaField` needed
                  for 4 of its 6 form fields, not `TextField`). Also found, not yet
                  scheduled: `@core/components/scroll-to-top/index.tsx` (the
                  `ScrollToTopButton` wrapper) is itself still MUI (`Zoom`+`useScrollTrigger`)
                  — missed by the original audit.
                  **Phase 3 part 2 executed 2026-09-16**: `views/feedback/
                  FeedbackButton.tsx` migrated to VhyxUI directly from Phase 3 part 1's
                  plan (`Button iconOnly` for the FAB, hand-built `Badge`-in-button for the
                  type selector, `TextareaField` for 4 of 6 form fields, plain conditional
                  replacing `Collapse`, dead `Zoom` wrapper dropped, no `<form>`/manual
                  `onClick` submission preserved). `@core/components/scroll-to-top/
                  index.tsx` also migrated (plain scroll-position state replaces
                  `Zoom`+`useScrollTrigger`+`styled`). `@mui` surface: 62 files/90 lines →
                  **60 files/74 lines**. See decision.md, 2026-09-16 ("Phase 3 part 2").
                  **MUI/Vuexy removal now complete except Phase 4** — the blank-layout-pages
                  illustration/responsive-layout code (`Login`/`Register`/
                  `ForgotPasswordView`/`ResetPasswordView`/`VerifyEmailView`/
                  `VerifyEmailSentView`/`NotFound`'s illustration wrappers, plus the
                  `@core/theme/*` MUI theme-construction machinery those still depend on)
                  is the only phase remaining open.
                  **Phase 4 part 1 (design) done 2026-09-16**: full CSS-only design
                  produced — no implementation yet. Corrected the audit's own framing:
                  `VerifyEmailView`/`VerifyEmailSentView` have zero real theme coupling
                  (same trivial `styled('img')` shape as `AcceptInvitationView`, Phase 1)
                  and were never part of the hard problem; only `Login`/`Register`/
                  `ForgotPasswordView`/`ResetPasswordView`/`NotFound` are. Proposed: a
                  shared `AuthIllustrationPanel` component + a new `useBreakpointDown`
                  hook (replaces `useMediaQuery(theme.breakpoints.down(...))`) +
                  Tailwind's built-in `rtl:` variant (replaces `theme.direction`, keyed
                  off the already-existing, MUI-independent `<html dir>` attribute) + one
                  small CSS Module for the two real breakpoint-capped max-heights
                  (Tailwind's own `--breakpoint-*` values already match MUI's exactly).
                  **Also found — solving the illustration panel alone does NOT fully
                  unlock `ThemeProvider`/`CssBaseline` removal**: `Register.tsx`'s MUI
                  `Grid`, and `useImageVariant.ts`/`useLayoutInit.ts`/`ModeChanger.tsx`'s
                  real `useColorScheme()`/`setMode()` calls (the latter two used by
                  *both* route groups, not just blank-layout-pages) also gate it. Full
                  sequencing plan and the complete design: decision.md, 2026-09-16
                  ("Phase 4 part 1"). `@core/components/mui/TextField.tsx` is now fully
                  dead (zero importers) and can be deleted independently.
                  **Phase 4 part 2a executed 2026-09-16**: the design above implemented
                  directly, no re-investigation needed. `useBreakpointDown` (new hook),
                  `AuthIllustrationPanel` + `AuthMaskImage` (new shared components), and
                  the CSS Module all built exactly per the design; `Login`/`Register`/
                  `ForgotPasswordView`/`ResetPasswordView`/`NotFound` converted to use
                  them; `VerifyEmailView`/`VerifyEmailSentView` got the trivial
                  `styled('img')`→plain-`<img>` fix. `Register.tsx`'s MUI `Grid` was
                  deliberately left untouched, per the brief — see the still-open item
                  below. `@mui` surface: 60 files/74 lines → **54 files/62 lines**.
                  `views/auth/` now has zero `@mui` imports outside `Register.tsx`'s
                  `Grid`. See decision.md, 2026-09-16 ("Phase 4 part 2a"). **Still open,
                  explicitly not attempted this session**: `Register.tsx`'s `Grid` →
                  plain grid, and `useImageVariant.ts`/`useLayoutInit.ts`/
                  `ModeChanger.tsx`'s real `useColorScheme()`/`setMode()` calls — both
                  required before `ThemeProvider`/`CssBaseline` can actually come off
                  (see Phase 4 part 1's Part 3 finding above; neither is "the
                  illustration panel," both need their own session).
                  **Phase 4 part 2b (design) done 2026-09-16**: full, concrete design
                  (exact code) for both remaining blockers — no implementation yet. New
                  `useResolvedMode()` hook (wraps `react-use`'s already-established
                  `useMedia`, not a new `matchMedia` listener) replaces `useColorScheme()`
                  in `useImageVariant.ts`; `useLayoutInit.ts`/`ModeChanger.tsx` drop their
                  MUI calls, with a real dependency-array bug fixed in `ModeChanger.tsx`
                  along the way (a live OS dark-mode toggle while `settings.mode ===
                  'system'` has never updated `data-theme` — only MUI's `setMode()` ever
                  caught that case). `Register.tsx`'s `Grid` → the same `grid grid-cols-2
                  gap-4` pattern `ProfileView.tsx` already uses for the identical
                  firstName/lastName layout. **Exhaustive final `ThemeProvider`/
                  `CssBaseline`/`useTheme()`/`useColorScheme()` grep found two genuinely
                  new items** no prior phase had named: `app/layout.tsx`'s
                  `InitColorSchemeScript` (a real MUI import in the root layout, mounted
                  on every route — delete-only fix, no replacement needed) and
                  `libs/layout/shared/Logo.tsx`'s direct `@emotion/styled` usage
                  (confirmed harmless — its styled callback never reads `theme`, so it's
                  not a `ThemeProvider` blocker, just invisible to every prior `@mui`-only
                  grep). Full design and the complete final dependency list: decision.md,
                  2026-09-16 ("Phase 4 part 2b") — ready for direct execution.
                  **Phase 4 part 3 (final) executed 2026-09-16 — MUI/Vuexy removal now
                  fully complete.** The Phase 4 part 2b design implemented directly:
                  `Register.tsx`'s `Grid` → `grid grid-cols-2 gap-4` (matching
                  `ProfileView.tsx`'s shipped precedent exactly); new `useResolvedMode()`
                  hook (wraps `react-use`'s `useMedia`) replaces `useColorScheme()` in
                  `useImageVariant.ts`/`useLayoutInit.ts`/`ModeChanger.tsx`, closing the
                  live OS-dark-mode `data-theme` sync bug as a byproduct; `app/layout.tsx`'s
                  `InitColorSchemeScript` deleted outright (the existing `data-theme`
                  attribute already covers it). With all five blockers cleared, a final
                  exhaustive `ThemeProvider`/`CssBaseline`/`useTheme()`/`useColorScheme()`/
                  `InitColorSchemeScript` grep confirmed nothing new and nothing missed,
                  then `ThemeProvider`/`CssBaseline` were removed from `Providers.tsx` and
                  the entire `@core/theme/` directory (43 files) plus `libs/theme/index.tsx`/
                  `mergedTheme.ts`/`types.ts`/`userTheme.ts` were deleted (`ModeChanger.tsx`
                  is now the sole file left in `libs/theme/`). `@core/components/mui/
                  TextField.tsx` (dead since Phase 3 part 1) and its one newly-orphaned
                  dependent, `@core/components/custom-inputs/types.ts`, were also removed,
                  both archived to `apps/web/archived/` per the established convention.
                  `@mui` surface: **zero real imports left in any live, reachable file**
                  (two files carry only harmless pre-existing comments naming MUI). A
                  wider final grep (across `.jsx`/`.js`, not just `.tsx`/`.ts`) also found
                  37 more files with real, uncommented `@mui` imports — all confirmed
                  unreachable dead code in the pre-existing `libs/ui/`/`libs/card-statistics/`/
                  `libs/styles/`/`libs/components/*.jsx` pile (zero importers anywhere,
                  same category as the 4 dead files found earlier this session, just a
                  larger slice of it); see backlog.md and decision.md's correction. Full execution
                  detail, the real dependency-array bug fix, the empirical `Logo.tsx`/Emotion
                  verification (SSR HTML confirmed to still carry the correct Emotion class
                  + `<style>` tag without `AppRouterCacheProvider`), the lint-delta
                  explanation, and the disclosed live-OS-toggle verification gap (no browser
                  tool available to simulate a live `prefers-color-scheme` change): decision.md,
                  2026-09-16 ("Phase 4 part 3"). **This closes the entire MUI/Vuexy removal
                  plan (Phases 0-4).**

```

## SDK Client Strategy

apps/web does not consume `packages/sdk` (it talks to apps/api over plain HTTP) — see `internal-tools/shared/context.md` for the SDK Client Strategy, relevant to Agent-embedding consumers, not this app.

## Configuration & Environment

**Project convention — VhyxUI linking.** `apps/web` consumes `@vhyxui/react` and `@vhyxui/tokens` from a **separate** repo (VhyxUI, not part of this monorepo) via pnpm's `link:` protocol, using **relative** paths (`link:../../../VhyxUI/packages/react`, `link:../../../VhyxUI/packages/tokens`), not absolute ones. This assumes VhyxUI is checked out as a **sibling directory** to this repo on disk — any contributor building `apps/web` needs both repos checked out side by side at that relative depth, or the link needs updating. This is the established pattern for any future workspace that consumes VhyxUI too, not a one-off for `apps/web` — don't rediscover this per-session. `apps/web/next.config.ts` also widens `turbopack.root` to the common parent of both repos (required for Turbopack to resolve a `link:` target outside its own root) and any VhyxUI component must be rendered from a `'use client'` boundary (VhyxUI's components aren't RSC-safe). See `apps/web/README.md` for the full setup and `decision.md`'s 2026-09-09 "VhyxUI stays a separate repo" entry for why this topology was chosen over vendoring or publishing.

**Same pattern, second sibling repo, added 2026-09-15**: `apps/web` also consumes `@vhyx/api-kit` (shared `createHttpClient`/`createQueryKeys`/`createQueryClient` conventions extracted per `TABLE_API_ARCHITECTURE_COMPARISON.md`'s Phase 1) from `link:../../../vhyx-api-kit` — a separate, single-package sibling repo at `/Users/tanveer/Documents/tanveer/vhyx-api-kit`, with its own fresh git history. No further `next.config.ts` change was needed since `turbopack.root` was already widened to the common parent directory, which already covers this new sibling too. See context.md item 44 and decision.md, 2026-09-15.

The rest of the Configuration table (DATABASE_URL, Redis, JWT, etc.) lives in `internal-tools/shared/context.md` — apps/web doesn't read any of it directly (it talks to apps/api over HTTP).

## Missing Features (not bugs — unbuilt surfaces, discovered 2026-09-14)

**No admin frontend exists, despite a complete, working admin backend.** Investigated while scoping the VhyxUI migration's originally-planned Step 6 ("admin-only screens") — the premise that admin screens existed and needed restyling turned out to be false. What's actually there:

- **Backend (real, functional, unaffected by this finding)**: `apps/api`'s Admin RBAC system is fully built — `POST /api/v1/admin/identity/auth/login` (separate admin login, own JWT/session via `AdminSession`, not the regular-user `/auth/login`), `POST /admin/auth/refresh`, `POST /admin/auth/logout`; admin-user CRUD (`POST/GET /admin/users`, `GET/PUT /admin/users/:id`, `POST /admin/users/:id/disable`|`/enable`); role CRUD + assignment (`POST/GET/PUT /admin/roles`, `POST /admin/users/:adminId/roles`, `DELETE /admin/users/:adminId/roles/:roleId`); ability CRUD + role-assignment (`POST/GET/DELETE /admin/abilities`, `POST/DELETE /admin/roles/:roleId/abilities`); `GET /admin/audit-logs` (filterable by adminId/action/targetId); `GET /admin/me`, `GET /admin/me/abilities`. Every mutating route is gated by `requireAbility('<resource>.<action>')` (e.g. `admin.create`, `role.assign`, `ability.delete`); `requireSuperAdmin` exists as a stricter gate (checks `request.admin.isSuperAdmin`) but no route in `admin.routes.ts` currently uses it — only `requireAbility`/`adminAuthGuard`. Every mutation writes an immutable `AdminAuditLog` row (action, targetType/targetId, before/after diff, ip/userAgent/statusCode).
- **Frontend (apps/web): nothing.** No admin login page, no admin API client/service/hooks, no route under `app/` gated for admin access, no middleware admin guard. `apps/web/src/views/admin/` existed (6 files: AdminUsersTables, AdminForm, RoleTable, RoleDialog, AbilityTables, AbilityDialog) but was confirmed 100% commented-out mock scaffolding — zero real lines, zero route wired, zero importers anywhere in the app — and was deleted 2026-09-14 as abandoned dead code (see decision.md). Building a real admin frontend is unstarted, net-new feature work, not a migration/restyling task — the backend is ready and waiting for it whenever it's prioritized.
- **Consequence for VhyxUI migration tracking**: the original gap-analysis report's one flagged Autocomplete/multi-select usage lived only inside this now-deleted dead scaffold (an admin ability-category creatable-select, never wired). There is currently **zero live Autocomplete/multi-select usage anywhere in the app** — VhyxUI's missing-Autocomplete gap (still confirmed missing as of the linked 0.3.1-alpha, no Combobox/multi-select primitive in `packages/react/src/components`) is moot for this codebase as it stands today. If/when a real admin frontend is built, this gap will need revisiting then (role/ability-assignment UI is a plausible place a multi-select would actually be needed).

## Known Risks / Gaps

Numbering is preserved from the original unified context.md so cross-references (`decision.md` entries, other component context.md files) keep working across files.

34. **OPEN — `GenericServerTable`'s internal query key is disjoint from the semantic query-key factories mutation hooks invalidate.** Discovered during the VhyxUI frontend migration (Step 5c, `decision.md` 2026-09-11): `GenericServerTable` runs its own `useQuery` keyed by `[tableKey, params]` (an ad hoc template-string convention each screen sets independently), completely separate from e.g. `memberKeys.list(...)`/`apiKeyKeys.lists(...)` query-key factories that mutation hooks call `invalidateQueries` against — so a successful mutation can return 200 and correctly persist, while the visible table silently never refreshes until a full page reload. Point-fixed for Members and API Keys (both screens' mutation hooks now also invalidate the table's literal `tableKey` string alongside their semantic key). **Tunnels is unaffected only because it has no mutations at all** — not because it avoids the pattern. The design gap itself, in `GenericServerTable` (`apps/web`), is unfixed and will recur on any future list screen that adds a mutation without remembering this convention. Suggested direction already on record: an exported `tableQueryKey(tableKey)` helper so mutation hooks can invalidate it directly.
42. **FIXED (2026-09-15) — `apps/web`'s client-side HMAC request signing removed; it protected nothing.** Surfaced by `TABLE_API_ARCHITECTURE_COMPARISON.md`'s convergence point #6 (the `NEXT_PUBLIC_SECRET_KEY`-in-browser-bundle finding, shared across VhyxVoid/kautilyan-admin/kautilyan-frontend). Investigated directly before removing anything: `apps/web/src/api/wrapper/http.ts`'s `coreFetch()` signed every request (nonce/timestamp/HMAC-SHA256 signature via `NEXT_PUBLIC_SECRET_KEY`/`NEXT_PUBLIC_API_KEY`) — but `apps/api`'s only signature-checking code, `signatureVerification` (`core/utils/auth.util.ts`), was **never registered as a preHandler on any route** (zero importers anywhere outside its own definition file), and even if it had been, its one hardcoded client (`getClientSecret`'s `client_123` → `CLIENT_123_SECRET`, a placeholder value in `.env`) doesn't match `apps/web`'s real `NEXT_PUBLIC_API_KEY` (`blackserver-api-key-12345`) anyway. These headers were generated and sent on every dashboard request and verified by literally nothing. Real protection was, and remains, `userAuthGuard`'s Bearer-JWT check (see the corrected Core Flows §5 above) — confirmed via direct investigation that no endpoint relied on the HMAC signature as its only or even partial protection, so removing it changed nothing about what actually authenticates dashboard requests. Also confirmed CSRF and rate-limiting were already adequate without the signing layer, so neither needed new work: the only cookie in the auth flow (the refresh token) is already `sameSite: 'strict'`, and `@fastify/rate-limit` is already registered globally in `register.plugin.ts` (`{max: 100, timeWindow: '1 minute'}`), covering every route including session-authenticated ones. **Removed**: `coreFetch`'s signing block and the ~130 lines of dead commented-out draft implementations at the bottom of `http.ts` (302 → ~150 lines); `api/hooks/signer.ts` (now-dead, deleted along with the now-empty `api/hooks/` directory); `NEXT_PUBLIC_SECRET_KEY`/`NEXT_PUBLIC_API_KEY` from `apps/web/.env`. **Also fixed in the same pass** (directly adjacent, already fully diagnosed): `Confirmation.tsx`'s dead dual-path default action (an `apiUrl`/`method`/`payloadData` shorthand routing through a second, independently-implemented HTTP client, `utils/fetchData.ts` — its own from-scratch HMAC signing, a hardcoded `'x-api-key': 'livein-key'` header that didn't even read the real key env var, and a stray `console.log` of the secret) — confirmed zero live callers (`grep -rn "apiUrl="` across `apps/web/src` → empty) and deleted, along with `utils/fetchData.ts` and `utils/convertFormdataInObject.ts` (both fully dead once `fetchData.ts`/`signer.ts` were gone) and the now-unused `crypto-js` dependency. **A real, independent bug found and fixed while rewriting `Confirmation.tsx`'s `handleConfirm`**: `onSuccessCallback` was previously only invoked from the now-deleted default-action path — meaning it silently never fired for any real (`onConfirm`-based) usage, including `TableAction.tsx`'s bulk-action `clearSelection()` after a successful confirm. Now called after a successful `onConfirm()` unconditionally. **New, separate finding, not fixed this session (out of scope — backend, not `apps/web`)**: `signatureVerification` and a second dead cookie-based JWT guard, `core/middleware/auth.middleware.ts`'s `authenticate` (zero importers, superseded by `userAuthGuard`), are both confirmed-dead backend code, along with the placeholder `CLIENT_123_SECRET` env var — flagged for a future backend dead-code cleanup pass. **Verified against the real local dev backend** (not just reasoned about): a real login returns `accessToken` with zero signature headers sent; a protected route (`GET /account/me`) returns `200` with only `Authorization: Bearer <token>` and no signature headers; the same route returns `401` with no token at all; a disallowed `Origin` is still rejected by CORS. New test: `tests/e2e/userAuthGuard.test.ts` (5 tests, calling the guard plugin directly against a real `RS256JwtService`/RSA keypair rather than booting a real Fastify server — `fastify` itself isn't resolvable from a bare import under `tests/e2e/` given this repo's pnpm-isolated `node_modules` layout). See decision.md, 2026-09-15, "NEXT_PUBLIC_SECRET_KEY removal".
44. **FIXED (2026-09-15) — Phase 1 of `TABLE_API_ARCHITECTURE_COMPARISON.md`'s recommendation implemented: a new shared package extracted, adopted in VhyxVoid.** A new, separate sibling repo, `vhyx-api-kit` (`/Users/tanveer/Documents/tanveer/vhyx-api-kit`, package name `@vhyx/api-kit`), was created following the exact same repo-topology/pnpm-`link:` convention as VhyxUI (see decision.md, 2026-09-09, "VhyxUI stays a separate repo") — its own fresh git history, committed from the start (31 tests across the query-key factory, HTTP client, and QueryClient factory), ships compiled `dist/` output like VhyxUI does. It exports `createQueryKeys(base)` (extracted from VhyxVoid's own `utils/utility.ts`, confirmed byte-for-byte identical to kautilyan-admin's copy), `createHttpClient(config)` (a configurable factory — the shared piece is signing/envelope-unwrapping/error-typing; auth-header attachment and unauthorized-handling are injected per project via `getAuthHeaders`/`onUnauthorized`, deliberately not hardcoded to VhyxVoid's own refresh-queue model), and `createQueryClient(config)` (a configurable reconstruction of kautilyan-admin's documented onError/toast/retry/session-death pattern — this session didn't have kautilyan-admin's actual source, so it's a faithful behavioral port with the ambiguous specifics — e.g. exact retry count — left as documented, overridable defaults, not claimed as a verbatim copy).
45. **FIXED (2026-09-15) — Phase 2 pilot of `TABLE_API_ARCHITECTURE_COMPARISON.md`'s recommendation: `GenericServerTable` converted to a props-based data contract, proven on Members.** `libs/table/GenericServerTable.tsx` no longer runs its own internal `useQuery` — it now takes `data`/`isLoading`/`error`/`total`/`extra` as props, plus `serverTable` (a `useServerTable(tableKey)` instance the caller now owns, since the caller needs the same page/limit/search/sortBy/sortOrder/filters state to drive its own query). `useServerTable` itself is unchanged — only the data-fetching responsibility moved out of `GenericServerTable`, exactly as the report's Phase 2 section specified.
46. **FIXED (2026-09-15) — Phase 2: API Keys converted to the props-based table pattern proven on Members.** Second table converted after the Members pilot (item 45), same approach. `views/org/api-keys/ApiKeysView.tsx` now owns `useServerTable('api-keys-${accountId}')` and a new `useApiKeysTableList(accountId, params)` hook (`api/application/hooks/useApiKeys.ts`), keyed through `apiKeyKeys.list(accountId, params)` — `apiKeyKeys` (a hand-written factory, not built on `@vhyx/api-kit`'s `createQueryKeys`) already accepted full query params before this change, so no generic-type widening was needed here (unlike `memberKeys`).
47. **FIXED (2026-09-15) — Phase 2: Invitations converted to the props-based table pattern; structurally different from Members/API Keys, investigated rather than assumed.** `InvitationsTab.tsx` (embedded inside `OrgSettingsView`'s Tabs, not a standalone route — mounted only when the "Invitations" tab is clicked) was on the `useSelfFetchingServerTable` compat shim since the Members pilot. Investigated its backend before converting: `GET .../invitations` (`apps/api`'s `account.routes.ts`, `listInvitationsQuerySchema`) accepts only an optional `status` filter — **no** page/limit/search/sortBy at all, it's a fixed `orderBy: createdAt desc, take: 100` server-side. This means Invitations has no query-key factory at all (`useInvitations`/`useCancelInvitation` in `useOrg.ts` use a single plain key, `['invitations', accountId]`) and pagination/search/sort must stay entirely client-side — a genuinely different shape than Members (`memberKeys`, `createQueryKeys`-based, object-subset matching) or API Keys (`apiKeyKeys`, hand-written, array-prefix matching).
48. **FIXED (2026-09-16) — Phase 2 closed out: Tunnels, My Organizations, My Feedback converted; a genuinely new bug class found and fixed along the way, `useSelfFetchingServerTable` deleted as fully dead.** This was the fourth Phase 2 session (following Members, API Keys, Invitations) and closes out every remaining `GenericServerTable` consumer — after this session, **zero** tables are on the compat shim and the shim itself (`libs/table/useSelfFetchingServerTable.ts`) has been deleted (confirmed zero real importers by grep before deleting, only doc-comment mentions remained).
49. **FIXED (2026-09-19) — `contexts/FeedbackContext.tsx`/`hooks/useFeedbackDialog.ts` (the global confirm/alert Dialog referenced throughout the Phase 2 entries above) deleted entirely; its only real call site was the fire-and-forget `.mutate()` bug that made it structurally unreachable (found 2026-09-18, chrome-visual.md full pass).** The three real `type: 'confirmation'` RowAction callers (`MembersTable`, `InvitationsTab`, `ApiKeysView`) now use `.mutateAsync()`, fixing a real, separate loading-state honesty bug (the dialog's loading spinner previously cleared instantly instead of tracking the real request). Rather than making `FeedbackContext`'s Dialog reachable, it was removed: the global `QueryClient`'s own `MutationCache.onError` → `toast.error(...)` pipeline (`api/wrapper/queryClient.ts`) already fires on every mutation failure regardless of `.mutate()` vs `.mutateAsync()`, so wiring the Dialog to also fire would have double-notified on every failure with no added coverage — confirmed no real caller anywhere in the app needed it. `FeedbackButton.tsx`'s `FeedbackType` import was migrated off `useFeedbackDialog.ts`'s dangling barrel re-export (a pre-existing, unrelated code smell found as a fix prerequisite) onto the real domain type (`api/domain/feedback/feedback.types.ts`) directly. Archived (not bare-deleted, both were substantial) to `apps/web/archived/src/{contexts,hooks}/`. See `decision.md`, 2026-09-19, "FeedbackContext removed" for the full investigation and decision.

56. **FIXED (2026-09-21) — a user with only a personal account had no sidebar link to API Keys or Tunnels; residual product questions recorded.** Every user gets exactly one `PERSONAL` account (OWNER, ACTIVE, with a slug, named `<First name>'s Workspace`) when they verify their email; no organization is created and there is no choice. The API layer never distinguishes account types for API keys, tunnels, members or billing reads (verified 2026-09-21: `POST/GET /apikeys/organizations/:personalId/api-keys` 201/200, tunnels and members 200); only `Account.rename` refuses a personal account. The sidebar filtered to `ORGANIZATION` (inherited from the pre-Step-3 `VerticalMenu`, which had a commented-out `personalAccount` line), so 20 of the 25 accounts in the local dev DB (personal-only users) had no way in. Now `DashboardSidebarNav` has a "Personal workspace" section (API Keys and Tunnels only) and `MyAccountsTable`'s arrow opens API Keys for a personal row. **Still open:** what Members, Billing and Settings should mean for a personal account, and the rename 500 — see `backlog.md`. `decision.md` 2026-09-21, "Personal accounts get a sidebar entry".

## Open Questions

None currently open that are specific to apps/web — see `internal-tools/shared/context.md`'s Open Questions for cross-cutting items.

**Auth refresh across tabs (2026-09-25, `cf0c3c4`, audit H10):** `authService.refresh()` runs under `navigator.locks` (`vhyxvoid:auth-refresh`, `crossTabLock.ts`), so the 401 handler (`api/wrapper/http.ts`) and the page-load bootstrap (`bootstrapSession.ts`) in different tabs refresh one after another instead of sending the same cookie at once; the per-tab `isRefreshing` queue is unchanged. The api also returns the same successor for a re-presented token within 30 s (`api/context.md` #64), which covers browsers without the Web Locks API.
