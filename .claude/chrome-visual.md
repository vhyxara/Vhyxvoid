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

## Auth pages — bootstrap & static rendering (Phase 1)

- [ ] **`AuthGuard.tsx`'s `Spinner` during the client-side bootstrap window.** The loading state is driven by a client-only Zustand store (`isAuthenticated`) and is only ever true for a brief moment before hydration resolves — structurally unobservable via curl/SSR. Check: load `/dashboard` (or any authenticated route) with a real session and watch for the `Spinner` (`size='lg'`) appearing briefly before content replaces it, with no layout jump or flash of wrong content. (Phase 1, decision.md "Phase 1 executed")
- [ ] **`NotFound.tsx`'s rendered output** — `Button`/`Typography` (VhyxUI) plus the untouched MUI illustration (`MaskImg`, still theme-coupled, left alone deliberately). Lower priority: curl already confirmed the `vhyx-button` class and correct text render server-side. Check: visit a nonexistent route, confirm "Page Not Found" + "Back To Home" render with correct VhyxUI button styling and the illustration displays correctly. (Phase 1, decision.md "Phase 1 executed")
- [ ] **`AcceptInvitationView.tsx`'s illustration** (`styled('img')` → plain `<img>` with Tailwind classes) actually renders at the right size or with no MUI `styled()` behind it. Lower priority: curl confirmed the `<img>` tag renders with correct classes. Check: visit `/invitations/accept` (with and without a token) and confirm the illustration displays at the same size/position as before the conversion. (Phase 1, decision.md "Phase 1 executed")
- [ ] **Dashboard redirect** (`/dashboard` unauthenticated → 307 to `/login?redirectTo=...`) actually lands cleanly in the browser with no flash of dashboard content first. Lower priority: curl already confirmed the 307 itself. Check: visit `/dashboard` logged out, confirm a clean redirect to `/login` with the `redirectTo` param preserved, no flicker. (Phase 1, decision.md "Phase 1 executed")
- [ ] **Dashboard layout's `ScrollToTop` button** (`Button iconOnly`, replacing MUI's inline `contained` button) — confirm it renders as a correctly-sized (40px) circular icon button in the bottom-right corner, matching the pre-migration size exactly (the `--vhyx-size-md` token was assumed to match `is-10 bs-10` without a visual check). (Phase 1, decision.md "Phase 1 executed")

## Phase 2 — org/profile view migrations (six files)

- [ ] **Real Badge colors** across `MyAccountsTable.tsx` (`roleBadgeVariant`), `BillingView.tsx` (`billingBadgeVariant`), and `FeedbackHistoryTab.tsx`/`FeedbackDetailDrawer.tsx` (`feedbackBadgeVariant`) — confirm each status/role/type maps to the visually-correct color (danger/warning/info/success/etc.), not just that the mapping function compiles. Check: an org with a mix of roles, a subscription in each real billing state (active/past-due/canceled if reachable), and feedback items across all types/statuses.
- [ ] **Dialog open/close interaction** — `CreateOrgDialog.tsx`, `BillingView.tsx`'s `UpgradeDialog`. Confirm the VhyxUI `Dialog` (Portal+Overlay+Content+Footer) opens/closes smoothly, traps focus, and closes on Escape/overlay-click as expected.
- [ ] **Drawer open/close** — `FeedbackDetailDrawer.tsx` (VhyxUI `Drawer`, same compound API as the mobile nav drawer). Confirm it slides in/out correctly and that the header is *not* sticky while the body scrolls underneath (a known, accepted cosmetic regression from the migration — confirm it's merely non-sticky, not visually broken).
- [ ] **`FeedbackContext`'s global confirm/alert Dialog actually appearing** — triggered by `Confirmation.tsx`'s `showFeedback()` (e.g. a failed invitation-delete). Confirm the dialog renders centered, with the footer's `justify-content: center` override actually winning (an inline-style override was used specifically to guarantee this against CSS-module/Tailwind specificity ties).
- [ ] **`BillingView`'s success banner dismissal** — confirm the `justUpgraded` success `Alert` now actually hides on click (a real bug fix this session made: MUI's version never actually dismissed, only ran the `onClose` callback; VhyxUI's `dismissible`/`onDismiss` should now correctly hide it).

(Phase 2, decision.md "Phase 2 executed" — quote: "the actual post-hydration, client-rendered DOM (real Badge colors, Dialog open/close, the FeedbackContext success/error banner actually appearing)... flagged here rather than assumed fine")

## NotificationBell (Phase 3 part 1)

- [ ] **Popover open/close** — bell icon click opens the notification panel (`Popover`, `side='bottom' align='end'`), closes on outside-click/Escape, and its `vhyx-scale-in` entrance animation plays correctly.
- [ ] **Hover Tooltip** on the bell trigger (`content='Notifications'`) and on "Mark all read" — confirm both actually show on hover with correct positioning/timing.
- [ ] **Badge overlay positioning** — the hand-built absolutely-positioned unread-count `Badge` on the bell icon (VhyxUI's `Badge` has no built-in overlay/corner mode, so this was hand-positioned). Confirm it sits correctly on the bell icon corner, not misaligned, at different count digit-lengths (1 vs. 10+).
- [ ] **Per-type icon colors** in the notification list (`MEMBER_JOINED`/`PAYMENT_SUCCEEDED`/`TUNNEL_DISCONNECTED`/etc.) — confirm each renders its correct semantic color.
- [ ] **Panel width override** (`width: 380px` via inline style, overriding `Popover.Content`'s default 320px max-width) — confirm the panel actually renders at 380px, not clipped to 320px.
- [ ] **The full interaction loop**: bell click → panel opens → real notification list renders → click a row → optimistic mark-read updates the badge count immediately → panel closes or stays per design.

(Phase 3 part 1, decision.md "Phase 3 part 1" — quote: "this component's whole value is a stateful interaction... that curl fundamentally cannot exercise... Flagged explicitly, not assumed fine.")

## FeedbackButton (Phase 3 part 2)

- [ ] **FAB button rendering** — `Button iconOnly size='lg'` with fixed bottom-right positioning (inline `bottom`/`right`/`zIndex`/`boxShadow`), confirm it sits in the correct position with the correct shadow, matching the pre-migration FAB's visual weight (no more `Zoom` entrance animation — confirm this is an acceptable, intentional loss, not jarring).
- [ ] **Dialog open/close** — the feedback submission `Dialog` (`size='md'`), confirm it opens/closes correctly and the icon+title+subtitle header (built from nested `<span>`s inside `Dialog.Title`'s `<h2>`) renders with correct layout, not collapsed/overlapping.
- [ ] **The Chip-type-selector-turned-Badge interaction** — 4 feedback-type pills, each a plain `<button>` wrapping a `Badge`, driven by RHF `Controller.onChange`. Confirm clicking a pill visually selects it (correct active/selected styling) and updates form state.
- [ ] **Per-type icon-circle colors** in the dialog header (mapped from MUI palette names to `var(--vhyx-color-*)`/`-subtle` tokens) — confirm each feedback type shows the correct accent color.
- [ ] **Form validation display** — `TextField`/`TextareaField`'s `error` prop (string message) on all 6 fields (title + 4 multiline `TextareaField`s + one more). Confirm validation messages actually appear under the right field when submitting invalid/incomplete data (this was preserved-not-added since the original MUI version already wired it up).
- [ ] **`Collapse`-replacement conditional** — the bug-specific fields now pop in/out abruptly (`{isBug && (...)}`, no height animation) instead of sliding. Confirm this is acceptable, not jarring/confusing to a real user.

(Phase 3 part 2, decision.md "Phase 3 part 2")

## scroll-to-top (Phase 3 part 2)

- [ ] **Abrupt show/hide at the 400px scroll threshold** — confirmed real, intentional cosmetic regression (no more `Zoom` fade+scale entrance/exit). Check: scroll past 400px on any dashboard page, confirm the button appears/disappears instantly rather than animating, and that this reads as acceptable rather than glitchy.

(Phase 3 part 2, decision.md "Phase 3 part 2" — "a genuine cosmetic loss, not free like the dead-code removal was")

## Illustration panel — real responsive behavior (Phase 4 part 2a)

- [ ] **The character illustration actually shrinks at the two breakpoint-capped max-heights** (`--character-max-h: 680px` default, `600px` override on `Register.tsx`) at real viewport widths (1536px/1200px breakpoints via the CSS Module's `@media` rules). This is the core point of Phase 4 part 2a's whole design and has never been visually confirmed — curl only proved the correct classes/inline custom property reach the DOM, not that they actually produce the right visual sizing in a real viewport.
- [ ] **The mask image disappears below 900px** (`useBreakpointDown`-gated) on `Login`/`Register`/`ForgotPasswordView`/`ResetPasswordView`/`NotFound`. Check at a real narrow viewport width.
- [ ] **RTL mirroring** (`rtl:scale-x-[-1]` on the mask image) — currently unreachable in production (this app only ships `en`/`fr`, both LTR — confirmed dead-in-practice per decision.md's Part 2 finding), but if a real RTL locale is ever added, confirm the mirror actually looks correct, not just present in the class list.

(Phase 4 part 2a, decision.md "Phase 4 part 2a" — quote: "the actual responsive behavior at different viewport widths is inherently unverifiable via curl... nothing in this session's verification can confirm the character illustration actually shrinks... or that the mask image actually stops rendering below 900px in a real browser")

## OS dark-mode live-sync (Phase 4 part 3)

- [ ] **Live `prefers-color-scheme` toggle while `settings.mode === 'system'`.** This is the actual bug fix from Phase 4 part 3 (`ModeChanger.tsx`'s dependency array extended to `[settings.mode, isDark]`) and has never been exercised in a real browser across six consecutive sessions. Check: set the in-app mode dropdown to "System", then toggle the OS/devtools `prefers-color-scheme` (Chrome DevTools → Rendering tab → "Emulate CSS media feature prefers-color-scheme", or a real OS-level light/dark toggle) and confirm `data-theme` on `<html>` updates live, with the whole UI actually re-themeing, with no page reload.
- [ ] **Explicit mode changes still work** (`ModeDropdown.tsx`'s light/dark/system selection) — confirm choosing each option updates `data-theme` immediately and persists across a reload (via the `settingsCookieName` cookie).

(Phase 4 part 3, decision.md "Phase 4 part 3" — quote: "no browser tool of any kind was available this session... to simulate a live `prefers-color-scheme` change... a real, disclosed verification gap, not silently assumed fine")

## Register.tsx's new grid layout (Phase 4 part 3)

- [ ] **firstName/lastName grid** (`grid grid-cols-2 gap-4`, replacing MUI's `Grid`/`size={6}`) — curl already confirmed the correct HTML/classes render server-side with `autoFocus` on the first field, but the actual rendered layout (equal-width two-column split, correct gap spacing, responsive behavior — MUI's original had none, so none is expected here either) has not been visually confirmed. Check: visit `/register`, confirm the two fields sit side-by-side with visually correct spacing, no overlap/misalignment.

(Phase 4 part 3, decision.md "Phase 4 part 3")

---

## Not on this list (already visually confirmed)

- Step 0's VhyxUI toast — confirmed working via an earlier real browser check the same day it was built (before the Chrome extension became unavailable for all subsequent sessions). Not re-flagged here.
