# Chrome Visual Verification — apps/admin

First real interactive browser verification pass over `apps/admin`, all 7
screens — never visually confirmed until this session (2026-09-18). Every
prior build session (Screens 1-7, all 2026-09-17) verified via curl against
the real local dev backend, the app's own test suite, and SSR/bundle
inspection, but explicitly deferred real click-through interaction, batched
to happen once after every screen was built (see backlog.md's prior entry,
now resolved by this pass).

**Convention, matching `internal-tools/user-frontend/chrome-visual.md`:**
check items off in place, don't delete them. If something's actually
broken, leave the box unchecked, add a `**BROKEN:**` note, and file it in
backlog.md (or context.md's Known Risks for anything big/systemic) — this
file just tracks what's been looked at.

**Environment**: local dev backend (`apps/api` on :9000, `DATABASE_URL`
overridden to the local `Black-server` Postgres per `LOCAL_DEV_BACKEND.md`
— already running at session start) + `apps/admin` dev server on :4001
(`pnpm dev`, Turbopack). Logged in as the seeded super admin,
`admin@company.local` / `Admin@12345678`.

---

## HEADLINE FINDING — every icon-only button in the app renders completely invisible (zero visible pixels), app-wide

**Severity: High.** Root-caused, not just observed. `apps/admin`'s copied
`RowAction.tsx`/`Confirmation.tsx`/`GenericServerTable.tsx` (copied verbatim
from `apps/web` per the founding scoping session's "copy, not extract"
decision — see context.md Part 3.4) render icons as `<i
className='tabler-eye' />` / `icon: 'tabler-trash'` etc. — the Tabler
icon-font class-name convention. This requires a generated icon-font CSS
file to actually define what each `tabler-*` class looks like.

**`apps/web`** imports this file in its root layout
(`apps/web/src/app/layout.tsx:38`, `import
'@assets/iconify-icons/generated-icons.css'`), backed by a real
`apps/web/src/assets/iconify-icons/` directory (`generated-icons.css` +
`bundle-icons-css.ts`).

**`apps/admin` has neither.** `apps/admin/src/app/layout.tsx` imports
`globals.css`, `@vhyxui/tokens`, and `@vhyxui/react/style.css` — no icon-font
CSS at all, confirmed by reading the file directly. `apps/admin/src/assets/`
doesn't exist. The `tabler-*` classNames render as literal empty elements
with no visible glyph — the buttons are fully real, wired, clickable `
<button>` elements (confirmed via `read_page`'s accessibility tree and by
clicking them via element ref every time below), just **zero pixels
visible** to a real user. No console error — this is a pure missing-CSS gap,
silent at runtime.

**Every occurrence found this session** (all confirmed via `read_page` +
zoomed screenshot showing genuinely nothing, then a successful functional
click via element ref proving the button works despite being invisible):
- Admin Users list: "view"/"Disable"/"Enable" row actions — invisible.
- Admin User detail: the role-badge "Revoke" button — invisible.
- Roles list: "view" row action — invisible.
- Role detail: the ability-badge "Revoke" button — invisible.
- Abilities list: "Delete ability" row action — invisible (only found via
  `find`, not by looking at the screenshot).
- Feedback list: "view" row action — invisible.

**Also found in passing**: clicking directly on a row's name/title text
(e.g. "Testy Admin", "Admin" role, "Screen 7 verify: dashboard chart
flickers") does **not** navigate to the detail page — only the invisible
"view" action button does. A user with no way to see that button (i.e.
every real user, since it's invisible) has **no way to reach any detail
page in this app at all** through normal interaction — this compounds the
icon bug into a full navigation dead-end, not just a cosmetic gap.

**Not fixed this session** — this is a verification pass, not a fix
session, per the brief. Flagged in backlog.md as the top-priority item.

**✅ RESOLVED 2026-09-18 (fix session).** Copied
`apps/web/src/assets/iconify-icons/generated-icons.css` into
`apps/admin/src/assets/iconify-icons/generated-icons.css`, added the
`@assets/*` path alias to `apps/admin/tsconfig.json` (apps/web already had
it; apps/admin didn't), and added the identical
`import '@assets/iconify-icons/generated-icons.css'` to
`apps/admin/src/app/layout.tsx`. Did not copy `bundle-icons-css.ts` (the
dev-time generation script) or its `@iconify/*`/`tsx` devDependencies —
out of scope for this fix, since the actual runtime artifact (the
generated CSS) is a complete, self-sufficient file needing no build step;
flagged for whoever next needs to add a new icon to this app.
**Re-verified in a real browser, on 4 screens, not just the one it was
first found on**: Admin Users (view/Disable icons now visible on both
rows, search icon, sort arrows), Roles (view icon, "+" on Create role,
sort arrows), Feedback (view icon), Abilities (the trash/delete icon
specifically — previously only locatable via `find`, now directly visible
in a screenshot). The role-assignment detail page's back-arrow and
revoke-badge "×" icons were also confirmed visible in passing. **The
navigation dead-end is resolved as a direct consequence** — row-name/title
text still isn't clickable (confirmed apps/web's own `MembersTable.tsx`
has the identical non-wired pattern, so this is this app-family's
established, intentional convention, not a bug), but the "view" action
icon is now visible and clickable, giving users a real way to reach every
detail page again. New regression test:
`src/app/layout.icons.test.ts` (17 tests — asserts the import exists in
`layout.tsx`'s source, the copied CSS file is non-trivial, and every real
`tabler-*` class this app's own source references has a defined rule in
the file). See `internal-tools/admin-frontend/decision.md`, 2026-09-18,
"Fixing the two chrome-visual bugs" for the full fix session record.

---

## Screen 1 — Login

- [x] **Form renders correctly.** `admin@company.local` placeholder in the
  Email field, masked Password field with a visibility-toggle eye icon
  (which itself rendered fine — it's an SVG via VhyxUI's `TextField`, not a
  `tabler-*` class), "Sign in" button. ✅ 2026-09-18.
- [x] **Bad credentials show a real, distinct error.** Submitted
  `admin@company.local` / `WrongPassword123` → a red toast, top-right,
  reading "Invalid credentials" with an X icon (this icon rendered fine —
  toast icons aren't part of the broken `tabler-*` path). Form fields stayed
  populated, no crash. ✅ 2026-09-18.
- [x] **Good credentials redirect to dashboard.** Submitted
  `admin@company.local` / `Admin@12345678` → real `POST .../auth/login`,
  redirected cleanly to `/dashboard`, no flash of wrong content. ✅
  2026-09-18.
- [x] **Logout works and redirects to login.** Clicked "Log out" (top
  right) from the Feedback detail page — cleared session, landed cleanly on
  `/login` with empty fields. ✅ 2026-09-18.
- [x] **Route protection**: visited `/dashboard` directly, logged out — a
  brief spinner (correct `AuthGuard`-style loading state), then a clean
  redirect to `/login`. No flash of dashboard content first. ✅ 2026-09-18.

## Screen 2 — Dashboard shell

- [x] **All 6 nav links work**: Dashboard, Admin Users, Roles, Abilities,
  Audit Log, Feedback — clicked each from the nav bar, each rendered its
  real view (not a stub) with correct content. ✅ 2026-09-18.
- [x] **Layout renders correctly.** Top nav bar with the 6 links, current
  admin email + "Log out" button top-right, minimal single-card content
  area for the dashboard itself ("Signed in as admin@company.local",
  "Super admin — bypasses all ability checks."). No layout breakage at
  1440px width. ✅ 2026-09-18.

## Screen 3 — Admin Users

- [x] **Table renders real data.** 2 real rows (Testy Admin / Super Admin),
  correct columns (Name/Email/Role/Status/Last login/Actions), correct
  Role/Status badge colors (Super Admin = blue, Admin = gray, Active =
  green). ✅ 2026-09-18.
- [x] **Search actually filters** when typed (not just proven via the pure
  `paginateAdminUsers` unit test) — typed "Testy", table narrowed to 1 row,
  "Total: 1" badge updated live. ✅ 2026-09-18.
- [x] **Sort actually works when a column header is clicked** — clicked
  "Name", rows re-ordered alphabetically (Super Admin before Testy Admin).
  ✅ 2026-09-18.
- [x] **Status filter actually works when selected** — "Disabled" correctly
  showed 0 records ("No records found"), "All"/"Active" restored the 2 real
  rows. ✅ 2026-09-18.
- [x] **Row actions fire and update the UI, but are invisible** — see
  HEADLINE FINDING. Clicked "view"/"Disable"/"Enable" via element ref
  (since nothing is visible to click normally): view navigates to detail
  correctly; Disable/Enable both open a correct `Confirmation` dialog,
  confirming updates the Status badge live (Active ↔ Disabled) without a
  page reload. Tested a full disable→enable round-trip on "Testy Admin",
  restored to Active afterward. **BROKEN (invisible only, not
  non-functional)**: see HEADLINE FINDING.
- [x] **BROKEN, real regression, not previously flagged**: the "Disable"
  row action for the **Super Admin's own row** (the currently-logged-in
  super admin, `admin@company.local`) is present and NOT disabled in the
  DOM (`read_page`'s accessibility tree shows a plain enabled `button
  "Disable"`, no `disabled` attribute) — contradicting context.md's Screen
  3 record ("hidden/disabled for the currently-logged-in admin's own row
  and for super admins"). **Not clicked** (would have disabled the only
  super admin login and locked this session out — too risky to actually
  execute as part of a verification pass). Flagged in backlog.md,
  high-priority, needs a fix-session follow-up to confirm whether the
  backend itself also guards this (matching `AdminUser.disable()`'s
  documented super-admin-reject) or whether only the UI-level guard is
  missing.
  **✅ RESOLVED 2026-09-18 (fix session).** Investigated the backend first,
  per the fix brief's instruction: `AdminUser.disable()`
  (`apps/api/.../AdminUser.entities.ts`) already throws
  `UnauthorizedError('Cannot disable super admin account')` when
  `this.props.isSuperAdmin` is true — confirmed both by reading the entity
  directly and live via curl (`POST /admin/identity/users/:id/disable`
  against the real super admin's own id → real `401 UNAUTHORIZED`,
  `"Cannot disable super admin account"`; a follow-up `GET /me` confirmed
  `status: true` unchanged). **So this was purely a UI-level bug, not a
  backend gap** — the real root cause: `AdminUsersTable.tsx` already
  computed the correct guard (`disabled: () => admin.isSuperAdmin ||
  isSelf`), but `RowAction.tsx`'s `type: 'confirmation'` branch never
  forwarded `action.disabled?.(row)` to `<Confirmation>`, and
  `Confirmation.tsx` had no `disabled` prop at all to receive it even if it
  had — so the correctly-computed guard was silently discarded for every
  `confirmation`-type row action in the app, not just this one. Fixed by
  adding `disabled?: boolean` to `ConfirmationProps` (wired to both trigger
  `Button` variants) and passing `disabled={action.disabled?.(row)}`
  through in `RowAction.tsx`'s confirmation branch; also had to exclude
  `disabled` from `ConfirmationProps` in `type.ts`'s `ConfirmationAction<T>`
  intersection (it was colliding with `BaseAction<T>`'s own `disabled?:
  (row: T) => boolean`, producing an unsatisfiable type). **Verified via
  direct DOM inspection (`button.disabled`), never by clicking the real
  super admin's own Disable button**, matching the same risk-aware judgment
  used when this was first found: `admin@company.local`'s own row shows
  `disabled: true` for its "Disable" action (both from its own logged-in
  view and from `test-admin@company.local`'s view of it); a regular admin
  row (`test-admin@company.local`, temporarily assigned the "Admin" RBAC
  role to gain `admin.read`/`admin.disable` abilities for this check, then
  reverted back to zero roles afterward) shows `disabled: false` when
  viewed by the super admin but `disabled: true` when viewing **its own**
  row while logged in as itself — confirming both disjuncts of the guard
  (`isSuperAdmin` and `isSelf`) independently work. New regression tests:
  `src/libs/table/RowAction.test.tsx` (5 tests — a `confirmation`-type
  action's trigger button is disabled when `action.disabled` returns true,
  stays enabled when false, a disabled trigger can't open the dialog even
  when clicked, an enabled one can, and an action with no `disabled`
  callback at all doesn't crash and stays enabled). Both new test files
  confirmed to genuinely fail against the pre-fix code via a targeted `git
  stash`/re-run/`git stash pop` cycle before being trusted. See
  `internal-tools/admin-frontend/decision.md`, 2026-09-18, "Fixing the two
  chrome-visual bugs" for the full fix session record.
- [x] **Detail page's role-assignment Select works.** Navigated to "Testy
  Admin"'s detail (via the invisible view button, element ref). "Add a
  role..." `Select` opened, listed all 6 real roles (Super Admin, Admin,
  Moderator, Operator, Support Agent, Screen4 Verify Role). Selected
  "Moderator", clicked "Add role" — badge appeared immediately, "No roles
  assigned" warning text disappeared. ✅ 2026-09-18.
- [x] **Role-badge revoke `Confirmation` flow works, but the badge's own
  revoke control is invisible** — see HEADLINE FINDING (same class as row
  actions). Found via `read_page` (a `button "Revoke"` exists but isn't
  visible), clicked via element ref: dialog opened correctly ("Revoke role
  — Revoke the "Moderator" role from Testy Admin?"), confirmed, badge and
  warning text reverted correctly, no page reload needed. Restored "Testy
  Admin" to its original zero-roles state afterward. ✅ (functionally) /
  **BROKEN** (invisible) 2026-09-18.

## Screen 4 — Admin Roles

- [x] **Table renders real data.** 6 rows at session start (4 system + 2
  disposable custom from prior sessions), correct Type badges (System =
  blue, Custom = gray). ✅ 2026-09-18.
- [x] **Create Role dialog opens/submits/closes correctly.** Clicked
  "Create role", dialog opened with Name (required) + Description
  (optional) fields, submitted "Chrome Verify Role" / "created via
  chrome-visual verification pass" — dialog closed, list updated to 7 rows
  with the new row visible immediately (no reload). ✅ 2026-09-18. **New
  standing test data** — see backlog.md (no delete endpoint for roles,
  matching the two pre-existing disposable roles' situation).
- [x] **Detail/edit view's isSystem-disabled state genuinely renders as
  disabled, not just logically blocked.** Opened the "Admin" system role's
  detail (via the invisible view action, element ref). Name/Description
  fields render visually greyed with their placeholder-style value text;
  clicked into the Name field and typed "x" — **no character was
  accepted**, confirming a real `disabled` attribute, not just a visual
  style. ✅ 2026-09-18.
- [x] **The two Alert messages render, but are not visually distinct from
  each other** — both the edit-blocked alert ("System roles cannot be
  renamed or redescribed...") and the ability-assignment-allowed alert
  ("Unlike name/description, ability assignment has no system-role
  restriction...") use the identical blue "info" `Alert` variant. Both are
  individually correct and legible; context.md's Screen 4 record describes
  them as rendering "distinctly and correctly" — the *text* is distinct and
  correct, but the *visual treatment* is not (a case could be made for a
  warning/neutral variant on the restriction message vs. info on the
  allowed message). **Not filed as broken** — a defensible design choice,
  not a functional bug — but noted since it doesn't fully match the prior
  session's own description. 2026-09-18.
- [x] **Ability-assignment sub-view's Select + revoke-badge Confirmation
  flow works.** "Add an ability..." Select opened, listed only unassigned
  abilities (confirmed — no already-assigned ability action appeared in the
  list), selected "abilities.ability.create", clicked "Add ability" — badge
  appeared immediately among the existing ~19 badges. Revoked it via the
  badge's (invisible — see HEADLINE FINDING) "Revoke" button, found via
  element ref: `Confirmation` dialog opened correctly ("Revoke
  "abilities.ability.create" from Admin?"), confirmed, badge disappeared.
  Confirms the system-role-has-no-ability-restriction asymmetry the prior
  session documented actually holds in the real UI, not just via curl. ✅
  2026-09-18.

## Screen 5 — Admin Abilities

- [x] **Table renders real data.** 23 real seeded abilities, paginated (10
  per page, 3 pages), correct Type badges. ✅ 2026-09-18.
- [x] **Create Ability dialog works.** Opened, filled Action
  (`chrome.verify`) + Category (`chrome-verify`), submitted — dialog
  closed, list updated to 24 total. ✅ 2026-09-18.
- [x] **Delete Confirmation shows the cascade warning text correctly, and
  the delete action itself works.** Found the invisible "Delete ability"
  action via `find` (not visible in the screenshot at all — confirmed via
  `read_page`), clicked via element ref: dialog text read exactly `Delete
  "chrome.verify"? This permanently deletes the ability and removes it from
  every role it's currently assigned to. This cannot be undone.` — matches
  context.md's documented cascade warning precisely. Confirmed delete — row
  removed immediately, "No records found" for the filtered search, total
  back to 23. **No cleanup debt left** — this test ability was created and
  deleted within the same check, unlike Roles' standing disposable rows. ✅
  2026-09-18.

## Screen 6 — Audit Log

- [x] **Purpose-built pager (not `GenericServerTable`) actually works.**
  Page 1: "Previous" correctly rendered disabled/greyed, "Next" enabled.
  Clicked "Next" → page 2 loaded new real rows, "Previous" became enabled.
  Confirmed against real data generated by this very session's own actions
  (Ability deleted/created, Role revoked/assigned, Admin disabled/enabled,
  etc. all appeared at the top of page 1 exactly as expected). ✅
  2026-09-18.
- [x] **Filter-by dropdown switches correctly between None/Admin/Action/
  Target.** All 4 options render. Selected "By action" — a text input
  appeared, typed `role.created` — table narrowed to exactly the 3 real
  `role.created` rows in the DB (2 pre-existing + this session's new
  "Chrome Verify Role"), each with its own expand row still working.
  Selected "By admin" — a real `Select` populated with both real admin
  emails (`admin@company.local`, `test-admin@company.local`) appeared in
  place of the text input, confirming the dropdown correctly swaps its
  second control's type per filter kind. ✅ 2026-09-18.
- [x] **Expandable rows actually expand and show formatted JSON correctly.**
  Expanded an "Ability deleted" row (has `metadata`, no `changes`) — showed
  a "Request metadata" block (IP/Status/User agent) correctly, no `Before/
  After` block rendered (correctly honors the independently-nullable
  `changes`/`metadata` fields). Expanded a "Role created" row (has
  `changes`, no `metadata`) — showed a two-column `Before`/`After` block,
  `Before: (none)`, `After: { "name": "Screen4 Verify Role", "description":
  "..." }`, properly formatted/indented JSON. Row toggles back to "Hide" →
  clicking again collapses cleanly. ✅ 2026-09-18.

## Screen 7 — Feedback Triage

- [x] **Table renders with real pagination/meta/counts badge.** 2 real
  feedback rows, correct Type/Status/Priority badge colors, the 4-badge
  counts row (Open: 0, Under review: 1, In progress: 0, Resolved: 1)
  rendered and matched the actual table contents exactly. ✅ 2026-09-18.
- [x] **Status/type/priority filters actually combine correctly when
  multiple are selected.** Selected Status=Under review alone → narrowed to
  1 row, counts badges unaffected (still reflect the *unfiltered* total, as
  designed). Added Type=Bug report → still 1 row (correct, since the 1
  matching row is a bug report). Added Priority=Critical → correctly
  produced 0 rows ("No records found"), proving the three filters are
  genuinely ANDed together against the real matching data (the row's real
  priority is High, not Critical). ✅ 2026-09-18.
- [x] **Detail view's SelectField-driven triage form actually works** — the
  specific concern flagged as a real prop-shape mismatch fixed at the type
  level but never visually confirmed. Opened a real feedback item's detail
  (via the invisible "view" action, element ref) — Report section rendered
  correctly (description, steps to reproduce, expected/actual behavior,
  raw `userId` under "Submitted by" — correctly not enriched, matching the
  documented detail-endpoint gap). Triage form: Status `SelectField`
  opened, listed all 6 real status values (Open/Under review/In
  progress/Resolved/Closed/Won't fix — confirms the "no transition-graph
  restriction" finding holds visually too), selected "In progress", clicked
  "Save changes" — no visible confirmation/toast on the detail page itself,
  but navigating back to the list confirmed the Status badge updated to "IN
  PROGRESS" and the counts badges updated live (Under review: 0, In
  progress: 1). Reverted back to "Under review" afterward to restore
  original state. ✅ 2026-09-18.
- [ ] **Minor, not filed as broken**: no visible success toast/confirmation
  appears on the detail page itself after "Save changes" — the only
  confirmation is the value staying selected in the form and the list page
  reflecting it on navigation back. Not necessarily wrong (many apps treat
  "the form still shows the new value" as sufficient feedback), but worth a
  second look if a future session is already touching this form — not
  filed as a backlog item on its own since it's a minor UX polish question,
  not a defect.

---

## Cross-cutting notes

- **No console errors were observed anywhere in this session** — the
  invisible-icon bug (HEADLINE FINDING) is a pure missing-CSS gap with no
  runtime error signal, which is exactly why it survived 7 build sessions'
  worth of curl/test-suite verification without being caught.
- **All disruptive test actions were reverted** to restore original state:
  Testy Admin's disable/enable and Moderator role assignment/revocation,
  the Admin role's temporary ability assignment/revocation, the feedback
  item's status change. **Not reverted** (no delete/undo path exists at the
  API level): the new "Chrome Verify Role" custom role (Screen 4) and the
  Screen 5 test ability were the only truly disposable creates — the
  ability was cleanly deleted within the same check, the role remains as a
  third standing disposable row (see backlog.md).


---

## Create Admin and Edit Profile — 2026-09-22

**Environment:** local dev API on :9000 (`DATABASE_URL` = local `Black-server`, confirmed from the process env), `apps/admin` dev server on :4001. The **login, the password fields, and the final Create admin submit were done by the user** (browser rules do not allow entering passwords or creating accounts); everything else below was driven directly. New standing test password convention: `Admin@123` for admins created from here on.

- [x] **1. Login** — done by the user (super admin). PASS.
- [x] **2. Create Admin dialog** — opened from the new "Create admin" button (Admin Users toolbar). Empty submit: blocked, five inline errors (First name/Last name/Email required, Password min 8, Confirm the password), dialog stays open. Filled name/email: their errors cleared live. The password-mismatch step and the final submit were done by the user (mismatch message **not witnessed by me**; the user reported it). Success outcome witnessed: the app landed on the new admin's detail page `/admin-users/04c91c21-…` ("Ada Verify", "No roles assigned — this admin can log in but every ability check will fail until a role is added", Edit profile card with Save disabled). PASS (mismatch step user-reported).
- [x] **3. List** — Total 3 → 4; "Ada Verify / ada.verify@company.local / Active / Never" present after in-app navigation, no manual reload. PASS.
- [x] **4. Assign a role** — role picker on the admin detail page (the existing Screen 3 role UI): picked "Support Agent" → Add role → spinner → badge "Support Agent ×", warning gone; DB shows the role row. API check: Ada logs in with the shared password; `GET /audit-logs` 200 (Support Agent holds `audit.read`), `/users` and `/roles` 403. PASS.
- [x] **5. Edit a profile** — Ada's first name → "Adaline" by real typing; Save was disabled while pristine and enabled on change; "Profile updated" toast, heading "Adaline Verify", Save disabled again, role badge intact; DB `Adaline Verify`; list shows "Adaline Verify". PASS.
- [~] **6. Edit own name** — super admin's own page: first name → "Root": toast, heading "Root Admin", and the persisted session store's `fullName` changed "Super Admin" → "Root Admin" immediately (read via sessionStorage, `fullName` only). **The header did not visibly change: `DashboardShell.tsx:64` renders only `admin.email`, and no component displays the signed-in admin's name.** So the store sync works but the "header updates" outcome is not observable. Name restored to "Super" afterwards (DB: `Super Admin`). PARTIAL — see backlog.md.
- [x] **7. Blank-name rejection** — cleared First name on the super admin's page, clicked Save: inline "First name is required", no toast, heading unchanged; DB `updatedAt` unchanged (`…19:52:46.986`) and no `PUT` in the dev-server log, i.e. nothing reached the backend's silent-no-op. PASS.

**Also seen (not caused by this change):** a hard load of `/admin-users` while signed in ends on `/dashboard` (in-app navigation works) — filed in backlog.md.
