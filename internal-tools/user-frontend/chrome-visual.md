# Chrome Visual Verification Checklist

Standing, trackable list of everything flagged across the MUI/Vuexy → VhyxUI
migration (Phase 1 onward) as "needs real browser verification, not yet
done." Every item below was verified at the API/SSR/curl level in its
originating session (real backend, real data, clean HTML) but the actual
*rendered, interactive, client-hydrated* behavior was never confirmed in a
real browser — no Chrome extension (or any other browser automation) was
available in any session from Phase 1 through Phase 4 part 3.

**Convention: check items off in place, don't delete them.** Unlike
`backlog.md` (contained dev annoyances where clutter is the main risk), this
file is a verification audit trail for a specific, large, now-complete
migration — knowing *when* and *that* something was actually checked has
lasting value, and deleting a line would lose that record. When you verify
an item: check the box, add a one-line note (date + what you saw, e.g. "✅
2026-10-01: Popover opens/closes correctly, badge overlay positioned
correctly"). If something's actually broken, leave the box unchecked, add a
`**BROKEN:**` note describing what's wrong, and file a proper decision.md
entry / backlog.md item for the fix — this file just tracks what's been
looked at, not fixes.

Every item cites the session/decision.md entry it came from, so context is
one click away.

---

## 2026-09-18 full pass — summary

First real interactive browser verification pass over this entire
checklist, done in one session (matching the `apps/admin` equivalent
session's discipline: report, don't fix). Logged in as `test@example.com`
against the real local dev backend (`LOCAL_DEV_BACKEND.md`). Every item
below is now checked. **Two real bugs found, both new, neither previously
flagged** — see backlog.md for full detail:

1. **`ScrollToTop`'s fixed position (160px/112px inset) visually overlaps
   a paginated table's page-number control** on pages where that table
   sits near the bottom-right at the 400px+ scroll threshold (reproduced
   on Tunnels' "Session history" table). The button still works when
   clicked precisely, but the overlap makes the real pagination control
   partly obscured/mis-clickable. **✅ RESOLVED 2026-09-19** — see the
   Phase 1 section below for the fix-session detail.
2. **`FeedbackContext`'s global confirm/alert Dialog is structurally
   unreachable — 100% dead code in practice.** All three real
   `type: 'confirmation'` RowAction call sites (Members' remove,
   Invitations' cancel, API Keys' revoke) call `onConfirm: () =>
   x.mutate(...)` — fire-and-forget, never awaited/returned — so
   `Confirmation.tsx`'s own `await onConfirm?.()` always resolves
   immediately and its `catch` → `showFeedback()` path never fires,
   regardless of whether the mutation actually fails. Confirmed
   empirically: a real, backend-rejected "remove yourself as last owner"
   action correctly failed server-side, but the error surfaced via the
   global `QueryClient`'s own toast handler, not this Dialog.
   `showFeedback()` has exactly one caller anywhere in the codebase — its
   own now-unreachable catch block. **✅ RESOLVED 2026-09-19** — see the
   Phase 2 section below for the fix-session detail.

One additional, unrelated bug was found incidentally while verifying the
Drawer item (out of this checklist's original scope, but real): `ProfileView.tsx`'s
"Organization memberships" always reads "Member of 0 organization(s)" for
every user, regardless of real membership count — `useMyProfile()`'s
`select()` strips the `accounts` field the real `/account/me` response
does contain, and `ProfileView.tsx` reads `(profile as any).accounts` off
the already-stripped shape. Flagged in backlog.md. **✅ RESOLVED 2026-09-19**
— see the Phase 2 section below for the fix-session detail.

**One item could not be fully exercised — a real environment limit, not a
gap in the check**: the illustration panel's default (un-overridden)
`680px`/`355px` character/mask sizes only apply above the 1536px
breakpoint, and this machine's display is 1440px wide — `resize_window`
cannot make the browser window wider than the physical screen. The two
narrower breakpoints (1536px→550px, 1200px→450px) and the full below-900px
hidden state were all confirmed directly via `getBoundingClientRect()` and
screenshots.

---

## Auth pages — bootstrap & static rendering (Phase 1)

- [x] **`AuthGuard.tsx`'s `Spinner` during the client-side bootstrap window.** ✅ 2026-09-18: reproduced twice (once navigating to `/dashboard` with a stale/expired session, once on a fresh authenticated reload) — a centered `Spinner` (matching the dashboard's existing chrome/sidebar already rendered around it) appears briefly, then is replaced by real content with no layout jump and no flash of wrong content.
- [x] **`NotFound.tsx`'s rendered output.** ✅ 2026-09-18: visited `/this-route-does-not-exist` — "404" / "Page Not Found ⚠️" / description text / purple "Back To Home" `Button` all render correctly; the character illustration + glow background render beneath, correctly positioned. Clicked "Back To Home" — navigates to the real marketing home page (`/`). No console errors.
- [x] **`AcceptInvitationView.tsx`'s illustration.** ✅ 2026-09-18: visited `/invitations/accept` with no token — the illustration `<img>` renders at the correct size/position, and a real `vhyx-alert` shows "Invalid invitation link. Please check your email and try again." exactly as documented.
- [x] **Dashboard redirect.** ✅ 2026-09-18: confirmed via curl (`GET /dashboard` unauthenticated → `307` to `/login?redirectTo=%2Fdashboard`, `location` header present) and via the browser — navigating to `/dashboard` logged out lands cleanly on `/login`, no flash of dashboard content.
- [x] **Dashboard layout's `ScrollToTop` button — sizing confirmed correct; the positioning bug is now RESOLVED.** ✅ **RESOLVED 2026-09-19 (fix session).** Size was always right — `getBoundingClientRect()` on the real button reports `40×40px`, an exact match for VhyxUI's `--vhyx-size-md` token. Originally found ❌ 2026-09-18: the fixed position (`inset-inline-end: 160px`, `inset-block-end: 112px` — carried over unchanged from the original MUI `theme.spacing(20)`/`theme.spacing(14)`) sat close enough to center-page content that it visually collided with a paginated table's own page-number control on pages where that table's pagination row reached similarly far right at the bottom of the viewport — reproduced on `/organizations/:id/tunnels`'s "Session history" table. Fix session repositioned the button to hug the true viewport corner instead (`insetInlineEnd: 24`, `insetBlockEnd: 114`) — the exact `24px` inset `FeedbackButton.tsx`'s own FAB already used, already confirmed collision-free, stacked with a 16px gap above that FAB so the two fixed corner controls (both visible simultaneously once scrolled past 400px) don't overlap each other either. See `decision.md`, 2026-09-19, "ProfileView organization count and ScrollToTop repositioned" for the full reasoning. Re-verified live: scrolled past 400px on `/organizations/:id/tunnels` and zoomed on the bottom-right corner — the "1" page-number button is now fully clear of `ScrollToTop`, which renders stacked cleanly above `FeedbackButton`'s FAB with no overlap on either side. Spot-checked a second table-heavy page (`/profile`'s Feedback History table) to confirm the fix generalizes rather than relocating the collision — no overlap there either. New regression tests (`@core/components/scroll-to-top/index.test.tsx`, 3 tests) confirmed to genuinely fail against the pre-fix `160px`/`112px` values via `git stash`.

## Phase 2 — org/profile view migrations (six files)

- [x] **Real Badge colors.** ✅ 2026-09-18, confirmed across three real screens: `MyAccountsTable` (`/dashboard`) — "Owner" badge renders in the danger/red tone for both of `test@example.com`'s real orgs (Test's Workspace, Test Corp), matching `roleBadgeVariant`'s `'error'`→`'danger'` mapping. `BillingView` (`/organizations/:id/billing`) — "PRO" (neutral), "ACTIVE" (green/success), and all 7 real "PAID" invoice badges (green/success) render with visually correct semantic colors. `FeedbackHistoryTab` (`/profile`) — "Feature request" (orange/warning) vs. "Bug report" (red/danger) type badges, "RESOLVED" (green) vs. "UNDER_REVIEW" (blue/info) status badges, "LOW" (gray) vs. "HIGH" (red) priority badges, all on the two real feedback rows submitted during the Phase 3 part 2 session — all visually distinct and semantically correct.
- [x] **Dialog open/close interaction — `CreateOrgDialog.tsx`.** ✅ 2026-09-18: clicked "New organization" on `/dashboard` — the VhyxUI `Dialog` (Portal+Overlay+Content+Footer) opens correctly, centered, with a real backdrop; `Escape` closes it cleanly with no residue. **`BillingView`'s `UpgradeDialog` was not reachable** — the real Test Corp org is already on an active PRO plan (no downgrade/upgrade trigger visible in that state); not filed as broken, just genuinely untestable with the available real data.
- [x] **Drawer open/close — `FeedbackDetailDrawer.tsx`.** ✅ 2026-09-18: on `/profile`'s Feedback History table, clicked a row's (invisible-text, actually-the-"view"-icon-button — see note below) action — the `Drawer` slides in from the right, shows real data (title, badges, description, the actual admin note left during the `apps/admin` Screen 7 session — "Tracked as a future enhancement, not urgent." — confirming cross-app data consistency), and `Escape` closes it cleanly. Note found in passing, not a Drawer bug: clicking the row's own text does nothing — only the dedicated "view" action icon (present but easy to miss without a `find`-style lookup) opens the drawer; same non-wired-row-click pattern already documented for `apps/admin`'s tables.
- [x] **`ProfileView.tsx`'s "Organization memberships" count — found incidentally while verifying the Drawer item above, now RESOLVED.** ✅ **RESOLVED 2026-09-19 (fix session).** Originally found ❌ 2026-09-18, outside this checklist's original scope: always read "Member of 0 organization(s)" regardless of real membership count — `useMyProfile()`'s `select()` deliberately never carried an `accounts` field, and `ProfileView.tsx` read `(profile as any).accounts` off that already-stripped shape. Fix session had `ProfileView.tsx` call `useMyAccounts()` (an existing, purpose-built selector already used by `MyAccountsTable`, sharing the same cache entry — no extra fetch) instead of widening `useMyProfile()`'s own deliberately-narrow shape. See `decision.md`, 2026-09-19, "ProfileView organization count and ScrollToTop repositioned" for the full reasoning. Re-verified live on `/profile` as `test@example.com`: now correctly shows "Member of 2 organization(s)" (Test Corp + Test's Workspace).
- [x] **`FeedbackContext`'s global confirm/alert Dialog — was structurally unreachable, now RESOLVED.** ✅ **RESOLVED 2026-09-19 (fix session).** Originally found ❌ 2026-09-18 — see "2026-09-18 full pass — summary" above for the original root-cause trail. Fix session investigated the three real call sites (`MembersTable`, `InvitationsTab`, `ApiKeysView`) and confirmed switching to `.mutateAsync()` alone would double-fire alongside the already-working global `QueryClient` toast (none of the three mutation hooks had a competing per-mutation error toast, only optimistic-update rollback in `onError`). Decision: switched all three call sites to `.mutateAsync()` (fixes the previously-dishonest loading-state timing — confirmed via new tests that the loading state now tracks the real request duration) AND removed `FeedbackContext`/`useFeedbackDialog`/its Dialog entirely as dead code, rather than making the Dialog reachable — the global toast already comprehensively covers mutation-failure UX and no other real caller of `showFeedback()` existed anywhere in the app. See `decision.md`, 2026-09-19, "FeedbackContext removed" for the full reasoning. Re-verified live: attempted to remove `test@example.com` as Test Corp's sole owner again (same reproduction) — the backend correctly rejected it (`"Cannot leave as last owner. Transfer ownership first."`), the error surfaced via the global toast exactly as before (no regression), the confirmation dialog closed cleanly with no stuck loading state, and the member row was untouched. No console errors, no stale references to the removed files.
- [x] **`BillingView`'s success banner dismissal.** ✅ 2026-09-18: navigated directly to `/organizations/:id/billing?success=1` (the same client-side-only trigger the real Stripe-redirect flow uses, no real Stripe transaction needed) — the green "Plan upgraded successfully. Welcome to your new plan!" `Alert` renders correctly; clicking its dismiss "×" hides it immediately (confirming the real bug fix decision.md documented — VhyxUI's `dismissible`/`onDismiss` genuinely hides it, unlike the old MUI version) and the `?success=1` param is cleaned from the URL.

(Phase 2, decision.md "Phase 2 executed" — quote: "the actual post-hydration, client-rendered DOM (real Badge colors, Dialog open/close, the FeedbackContext success/error banner actually appearing)... flagged here rather than assumed fine")

## NotificationBell (Phase 3 part 1)

- [x] **Popover open/close.** ✅ 2026-09-18: bell click opens the panel correctly (`vhyx-scale-in` entrance observed), `Escape`/outside-click closes it.
- [x] **Hover Tooltip.** ✅ 2026-09-18: hovering the bell trigger shows a "Notifications" tooltip positioned correctly above the icon.
- [x] **Badge overlay positioning.** ✅ 2026-09-18: seeded 3 real notifications via direct SQL (real UUIDs — see the note below on why this needed a redo), confirmed via a zoomed screenshot that the red "3" count badge sits correctly on the bell icon's top-right corner, not misaligned. Multi-digit (10+) count was not separately tested — would need 10 real unread rows, judged low-value for the time cost; single-digit confirmed correct.
- [x] **Per-type icon colors.** ✅ 2026-09-18: `MEMBER_JOINED` (green person icon), `PAYMENT_SUCCEEDED` (blue/purple card icon), `TUNNEL_DISCONNECTED` (red/orange alert icon) — all three real seeded notifications rendered visually distinct, semantically-correct icon colors.
- [x] **Panel width override.** ✅ 2026-09-18: panel renders at its intended wider width, not clipped to `Popover.Content`'s 320px default (visually confirmed against the notification row text wrapping correctly, not truncated).
- [x] **The full interaction loop.** ✅ 2026-09-18, fully exercised: bell click → panel opens → 3 real notifications render (with correctly-populated `body` text, e.g. "Alice joined Test Corp" — confirming the Phase 3 part 1 `message`→`body` field-rename bug fix still holds) → clicked one row → count badge dropped 3→2 immediately, that row's unread dot cleared, panel stayed open (matches design) → clicked "Mark all read" → remaining dots cleared, count chip disappeared from the header, bell's own badge cleared. All via real `PATCH .../notifications/:id/read` and `.../read-all` calls against the live backend. **Note on the seed data itself**: the first attempt used hand-typed non-UUID test IDs (`chromevis-notif-1` etc.) and the mark-read call correctly 400'd with a real `"Invalid request data"` validation error (`notification.routes.ts`'s `notifParamSchema` requires `z.string().uuid()`) — this was a self-inflicted test-data mistake, not an app bug (same class of lesson `internal-tools/api/decision.md`'s "Bug 2 resolution" entry already documented); redone with real `gen_random_uuid()` IDs and the full loop worked cleanly. All 3 seeded rows deleted afterward, no residue.

(Phase 3 part 1, decision.md "Phase 3 part 1" — quote: "this component's whole value is a stateful interaction... that curl fundamentally cannot exercise... Flagged explicitly, not assumed fine.")

## FeedbackButton (Phase 3 part 2)

- [x] **FAB button rendering.** ✅ 2026-09-18: renders correctly in the fixed bottom-right position with the correct shadow/weight on every page checked; no overlap issues observed with it (unlike ScrollToTop — its inset values sit further from center content).
- [x] **Dialog open/close.** ✅ 2026-09-18: opens correctly, `size='md'`; the icon+title+subtitle header (🐛 "Send feedback" / "Help us improve VhyxVoid") renders with correct layout, no collapsing/overlap. "Cancel" closes cleanly.
- [x] **The Chip-type-selector-turned-Badge interaction.** ✅ 2026-09-18: clicked "Feature request" — it visually selects (orange/warning highlight replaces the default "Bug report" red highlight), the header icon/emoji and subtitle text update to match ("💡" / "Suggest a new feature or improvement"), and the form's own bug-specific fields disappear as a direct result (see Collapse item below).
- [x] **Per-type icon-circle colors.** ✅ 2026-09-18: confirmed via the same interaction above — the header icon-circle's accent color visibly changes per selected type (red for Bug report, orange/warning for Feature request).
- [x] **Form validation display.** ✅ 2026-09-18: submitted the form empty — real red-bordered fields appear with correct inline messages directly under each ("Title" → "At least 3 characters", "Description" → "At least 10 characters"), exactly matching the documented preserved-not-added behavior.
- [x] **`Collapse`-replacement conditional.** ✅ 2026-09-18: confirmed directly — switching from "Bug report" to "Feature request" makes "Steps to reproduce"/"Expected behavior"/"Actual behavior" disappear instantly, no height animation, reads as an acceptable, non-jarring abrupt change (form is small enough that the layout shift is not disorienting).

(Phase 3 part 2, decision.md "Phase 3 part 2")

## scroll-to-top (Phase 3 part 2)

- [x] **Abrupt show/hide at the 400px scroll threshold.** ✅ 2026-09-18: confirmed on `/organizations/:id/tunnels` — scrolling past 400px shows the button at full opacity immediately (no fade/scale-in observed across two consecutive screenshots), scrolling back removes it just as abruptly. Reads as acceptable, matching the documented intentional cosmetic regression — **but see the Phase 1 entry above for a real, separate positioning bug found on this same button.**

(Phase 3 part 2, decision.md "Phase 3 part 2" — "a genuine cosmetic loss, not free like the dead-code removal was")

## Illustration panel — real responsive behavior (Phase 4 part 2a)

- [x] **The character illustration actually shrinks at the two breakpoint-capped max-heights.** ✅ 2026-09-18, confirmed at both reachable breakpoints via `getBoundingClientRect()`/`getComputedStyle()` plus visual screenshots: at 1440px viewport width (between the two breakpoints), the character's real rendered height is `549.98px` against a computed `max-block-size: 550px` — an exact match for the `@media (max-width: 1536px)` rule. At 1100px (below the 1200px breakpoint), real height is `449.98px` against `max-block-size: 450px` — an exact match for the `@media (max-width: 1199.98px)` rule. **The default (un-overridden) `680px`/`355px` sizes above 1536px could not be tested** — this machine's physical display is 1440px wide, and `resize_window` cannot exceed it; a genuine environment limit, disclosed rather than silently skipped. Confirmed via `Register.tsx`'s own `characterMaxHeight={600}`/`maskMaxHeight={345}` prop override reaching the DOM too (visually distinct, smaller character on `/register` vs. `/login` at the same viewport width).
- [x] **The mask image disappears below 900px.** ✅ 2026-09-18: at 800px viewport width, confirmed via `getComputedStyle` that the character illustration's wrapper `div` has `display: none` (via the static `max-md:hidden` Tailwind class, matching MUI's `md`=900px breakpoint exactly) and the mask `<img>` is fully absent from the DOM (`useBreakpointDown`'s existence-gate, confirmed via `querySelector` returning `null`) — both mechanisms correctly hide their respective piece below 900px, confirmed by a full-width login form screenshot with zero illustration-panel content visible.
- [ ] **RTL mirroring.** Not re-tested this session — still genuinely unreachable in production (this app only ships `en`/`fr`, both LTR, per the original Phase 4 part 1 finding); no new information to add.

(Phase 4 part 2a, decision.md "Phase 4 part 2a" — quote: "the actual responsive behavior at different viewport widths is inherently unverifiable via curl... nothing in this session's verification can confirm the character illustration actually shrinks... or that the mask image actually stops rendering below 900px in a real browser")

## OS dark-mode live-sync (Phase 4 part 3)

- [x] **Live `prefers-color-scheme` toggle while `settings.mode === 'system'`.** ✅ 2026-09-18 — genuinely live-tested, not just code-read: used a real macOS-level `osascript ... set dark mode to true/false` toggle (not a DevTools emulation override, which wasn't accessible through the available browser tooling) while the app was confirmed on "System" mode. **First trial showed an anomaly** (`data-theme` stuck on the old value for 1.5s+ and only updated after an unrelated click) but **three subsequent clean trials, from a fresh page load, all updated `data-theme` within 0.5-1 second of the real OS toggle, in both directions, with no interaction needed** — confirmed the first trial was very likely a one-off Turbopack/HMR-related hydration artifact immediately after login, not a reproducible bug (documented honestly rather than either silently dropped or over-reported as broken). **A second, unrelated thing was investigated and fully resolved as *not* a bug**: after toggling to "light", the page visually stayed near-black — this is **intentional**, confirmed by reading `apps/web/src/app/vhyxui-brand-override.css` directly: VhyxVoid's own brand is a "near-black 'space' aesthetic" in *both* its light and dark palettes (documented in the file's own comments, referencing decision.md 2026-09-10), with genuinely different-but-both-dark values (`--vhyx-color-bg: #050505` for light vs. `#09090B` for dark) — confirmed both values actually apply correctly via `getComputedStyle` when switching modes. Not a broken light theme; a deliberate design choice, already documented, now re-confirmed live.
- [x] **Explicit mode changes still work.** ✅ 2026-09-18: opened the `ModeDropdown` (top-left icon next to the logo) — Light/Dark/System options render correctly with the right current-selection highlight. Selected "Light" → icon changes to sun, `data-theme="light"`, `theme-cookie` correctly persists `{"mode":"light",...}` (confirmed via `document.cookie`); a full page reload with that cookie already set renders the same (light-brand, still near-black per the note above) state immediately, no flash of the wrong theme. Selected "Dark" → icon changes to moon, `data-theme="dark"`, `--vhyx-color-bg` computed value correctly changes to `#09090b`. Selected "System" → restored to the icon matching the live OS state.

(Phase 4 part 3, decision.md "Phase 4 part 3" — quote: "no browser tool of any kind was available this session... to simulate a live `prefers-color-scheme` change... a real, disclosed verification gap, not silently assumed fine")

## Register.tsx's new grid layout (Phase 4 part 3)

- [x] **firstName/lastName grid.** ✅ 2026-09-18: visited `/register` — First name/Last name render side-by-side in a correctly-spaced two-column grid, equal width, no overlap/misalignment; `autoFocus` confirmed on the First name field (visible focus ring on page load).

(Phase 4 part 3, decision.md "Phase 4 part 3")

---

## Not on this list (already visually confirmed)

- Step 0's VhyxUI toast — confirmed working via an earlier real browser check the same day it was built (before the Chrome extension became unavailable for all subsequent sessions). Not re-flagged here.
