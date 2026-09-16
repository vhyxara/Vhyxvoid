# VhyxVoid Frontend → VhyxUI Migration: Gap Analysis

Investigation only — no migration code was written or edited in this pass. Codebases examined:
`/Users/tanveer/Documents/tanveer/frontend` (VhyxVoid's frontend, `package.json` name `vhyx-void@5.0.1`) and
`/Users/tanveer/Documents/tanveer/VhyxUI` (`@vhyxui/react@0.3.1-alpha`).

---

## Part 1 — VhyxVoid Frontend Inventory (MUI + Vuexy Usage)

**App shape**: Single Next.js 16 / React 19 / MUI 7 app, confirmed only frontend in the repo. 19 pages across 3 route groups: `(blank-layout-pages)` — 7 auth-flow pages (login, register, forgot/reset password, verify-email ×2, accept-invitation), no persistent nav chrome; `(dashboard)` — 7 pages (dashboard, profile, and 5 `organizations/[accountId]/*` screens: tunnels, api-keys, members, billing, settings), full app-shell chrome; `(public-pages)` — 4 marketing pages. 222 `.tsx`/`.jsx` files, 80 client components.

**MUI import census**: Uses Vuexy's deep-import style (`@mui/material/Button`, not barrel), 427 deep imports + 24 barrel imports. `@mui/icons-material`: **zero uses** — icons are Iconify. `@mui/lab`: only `LoadingButton`. No `@mui/x-data-grid`, no `@mui/x-date-pickers` installed. Component frequency (files containing the tag):

| Component | Files | Component | Files |
|---|---|---|---|
| Typography | 44 | Avatar | 5 |
| Button | 30 | Tooltip | 5 |
| Box | 20 | CircularProgress | 5 |
| DialogContent | 16 | Paper | 5 |
| DialogActions | 16 | ClickAwayListener | 5 |
| DialogTitle | 15 | Skeleton | 5 |
| Dialog | 14 | Fade | 3 |
| Alert | 13 | Tab | 2 |
| IconButton | 12 | Stack | 2 |
| Chip | 11 | Select | 1 |
| MenuItem | 11 | FormControlLabel | 1 |
| Divider | 10 | Badge | 1 |
| Card / CardContent | 8 / 6 | Checkbox | 8 |
| Grid | 7 | InputAdornment | 6 |

Raw `TextField`/`Autocomplete`/`Tabs`/`Radio`/`Pagination`/`Switch`/`Drawer` JSX: **0** — all routed through custom wrappers in `src/@core/components/mui/`, so real usage is higher than this table shows (undercounted by the wrapper layer).

**Vuexy structural chrome (load-bearing, not componentry)**: 36 separate MUI theme-override files (`src/@core/theme/overrides/*`), MUI v7 CSS-variable `colorSchemes`, RTL via `stylis-plugin-rtl`, a runtime "Customizer" (mode/skin/layout/navbar/footer variants, cookie-persisted), and `@menu/vertical-menu` + `@layouts` powering the dashboard's sidebar/topbar/footer. Full custom palette, shadow scale, spacing scale, and typography scale — this is an in-house design system expressed as MUI theme code.

**Usage patterns**:
- **Buttons**: contained/outlined, color=primary/secondary/error, `size='small'`; async-submit uses `@mui/lab`'s `LoadingButton`; icon buttons use `IconButton` + Iconify markup.
- **Data tables**: one generic, reusable `GenericServerTable` wiring headless `@tanstack/react-table` to a **plain HTML `<table>`** — not MUI `Table`, not a DataGrid. Server-side page/sort/search/filter state, optional row selection + bulk toolbar, `TableSkeleton` loading state. Every list screen (tunnels, api-keys, members) is a thin config on top of this one component.
- **Forms**: `react-hook-form` + `@hookform/resolvers/yup` (yup, not zod), `Controller` wrapping a custom `CustomTextField` (also used with a `select` prop + `MenuItem` children instead of a separate Select). Multi-select for API-key scopes is a **hand-built Chip-array toggle**, not MUI `Autocomplete`. No date-picker anywhere — expiry dates use native `<input type='date'>`.
- **Autocomplete**: real usage found in exactly one admin-only screen.
- **Dialogs**: all simple form-in-a-modal (`Dialog`+`DialogTitle`+`DialogContent`+`DialogActions`) — no stepper dialogs in real use; the template's `stepper-dot` component has **zero call sites** (dead code).
- **Notifications**: MUI `Snackbar` — **zero uses**. Two toast libraries coexist live: `react-toastify` (8 files) and `react-hot-toast` (5 files) — unresolved duplication. MUI `Alert` is only inline static banners, never a toast.
- **Status badges**: `Chip` + a custom `variant='tonal'` (added by the theme override, not stock MUI) mapping domain states to color.
- **Charts**: two unreconciled wrapper libraries (ApexCharts, Recharts) — out of scope for a MUI-component migration but worth noting.

**Dead code found (exclude from migration scope)**: `src/libs/ui/*.jsx` — an abandoned shadcn/Tailwind `Button`/`Card`/`Input`/`Form` experiment with zero import sites anywhere. `src/libs/stepper-dot/` — zero call sites.

**Scope**: 19 pages, ~17-19 non-trivial (form or data-table) screens vs. 4 static marketing pages, 222 files, 80 client components.

---

## Part 2 — VhyxUI Inventory (Actual Current Surface)

**Repo shape**: pnpm/turbo monorepo. `packages/react` (`@vhyxui/react@0.3.1-alpha`) is the component library; `packages/tokens` (`@vhyxui/tokens@0.1.3-alpha`) is a pure-CSS design-token package; `packages/core` is contracts/types; `packages/visual-runtime` is unrelated/unimplemented. `apps/docs` and `apps/playground` exist but **pin stale versions** of `@vhyxui/react`/`@vhyxui/tokens` rather than `workspace:*` — the docs site may not reflect the current source.

**Component count**: **25 actually exported**, not 22 — Button, Input, Textarea, Select, Checkbox, RadioGroup/RadioItem, Switch, Form/Field, TextField, SelectField, TextareaField, Toast/ToastProvider/toast(), Alert, Badge, Progress, Spinner, Dialog, Drawer, Tooltip, Popover, Card, Separator, Tabs, Breadcrumb, Pagination. The docs site only has pages for 22 (TextField/SelectField/TextareaField are exported and tested but undocumented). **Confirmed absent**: DataGrid/Table, Menu/Dropdown, Avatar, Chip (delete/avatar affordances), Accordion, Skeleton, DatePicker, Stepper, Autocomplete/Combobox, **any layout primitive (no Box/Grid/Stack/Container)**.

**Key API notes** (full prop-level detail was captured during investigation; summarized here):
- **Button**: variant (primary/secondary/outline/ghost/destructive/link), size (xs–lg), built-in `loading`, `iconOnly`, single `icon`+`iconPosition` slot (not independent start/end icons), `asChild` polymorphism, `forwardRef`.
- **Input/Textarea**: size, `icon`+`iconPosition`, `prefix`/`suffix`, `clearable`, boolean-only `error` (no message prop on the input itself — message display is `Field`'s job).
- **Select**: compound (`Trigger/Content/Item/Group/Label/Separator`), **single-select only**, controlled string value — no multi-select, no async, no search/combobox.
- **Checkbox/Switch/RadioGroup**: rendered as `<button role="checkbox|switch">`, **not a native `<input>`** — requires RHF `Controller`, not `register()`.
- **Form/Field**: genuinely strong — `<Form form={useForm()}>` context + `<Field name="...">` auto-reads validation errors; `layout`/`size`/`disabled` cascade via context. Cleaner than typical MUI+RHF boilerplate.
- **Toast**: full imperative API (`toast()`, `.success/.danger/.warning/.info()`, description/action/duration/dismissible) — near drop-in for `react-hot-toast`'s shape.
- **Dialog/Drawer/Popover**: compound, focus trap + scroll lock built in, controlled `open`/`onOpenChange` supported. No built-in stepper primitive.
- **Card**: compound (Header/Body/Footer/Image), variant (default/outline/ghost/elevated), padding scale.
- **Pagination**: page-index driven (`page`/`pageCount`/`onPageChange`) — fetch-strategy agnostic, fits server-side pagination naturally.
- Nearly every component accepts a `contract?: Partial<ComponentContract>` prop (an "agent-ready" a11y/manifest system) — irrelevant to this migration but a real, consistent feature.

**Theming**: Pure **CSS Modules** per component + `@vhyxui/tokens`'s generated CSS custom-properties (`--vhyx-primitive-*` → `--vhyx-color-*`, genuinely consumed, not dead). Dark mode = `[data-theme="dark"]` attribute swap. **No JS theme object, no React context carrying palette values, no `sx`-prop equivalent for inline overrides.** `VhyxUIProvider` exists but its job is the Toast region, an a11y skip-link, and the agent-contract registry — **not** a `ThemeProvider` analogue.

**Test/doc coverage**: All 25 components have ≥1 `.test.tsx`. **No Storybook at all** (no config, no `.stories.tsx` anywhere). Docs site covers 22/25.

**Bugs & red flags (not gaps — genuine defects against VhyxUI's own stated API)**:
1. Component-count mismatch: barrel comment claims "22 Tier 1 components," 25 are actually exported.
2. `forwardRef` inconsistency: `TextField`, `SelectField`, `TextareaField`, `Tooltip`, `Toast` (component), `Form`/`Field` don't forward refs while the other 21 components do — `<Tooltip ref>` and `<Toast ref>` genuinely can't be used.
3. `apps/docs`/`apps/playground` pin stale `@vhyxui/react`/`@vhyxui/tokens` versions instead of `workspace:*` — the published docs may describe an older API than what's in `packages/react/src` today; verify against source, not docs, during migration.
4. Labeling accuracy: "~22 production-ready" implies drop-in parity; in practice Checkbox/Switch/RadioGroup's button-role rendering and Select's single-value-only design require the consuming app to change its integration pattern, not just swap imports.

---

## Part 3 — Gap Map

### Component-level

| VhyxVoid pattern | Usage volume | Verdict | Detail |
|---|---|---|---|
| Typography | 44 files | **MISSING** | No Typography component in VhyxUI at all. |
| Button (variants/color/loading/icon) | 30 | **PARTIAL** | Good match; VhyxUI's built-in `loading` is arguably cleaner than MUI+`LoadingButton`. Gap: single `icon`+`iconPosition` slot vs. MUI's independent start/end icons. |
| Box / Grid / Stack (layout) | 20+7+2=29 | **STRUCTURAL** | No layout primitives exist in VhyxUI at all — see Structural section. |
| Dialog family | 14-16 each | **READY** | Compound API with controlled `open`/`onOpenChange`, focus trap/scroll lock built in. Matches actual usage (simple forms-in-modal); no stepper needed since `stepper-dot` is dead code. |
| Alert | 13 | **READY** | Inline, non-imperative, variant set matches usage (static banners). |
| IconButton | 12 | **PARTIAL** | Covered by Button's `iconOnly`; confirm accessible-label convention during migration. |
| Chip (status badges, tonal) | 11 | **PARTIAL** | VhyxUI's Badge covers plain status-label usage (no delete/avatar chip usage exists in VhyxVoid today), but has no built-in "tonal" color-mapping variant — would need custom CSS per status. |
| MenuItem / Select-via-TextField | 11 / 1 | **PARTIAL** | VhyxUI Select is compound, not the MUI `select`-prop-on-TextField pattern — requires refactoring `CustomTextField`'s dropdown mode. Single-select-only is fine (no multi-select found in real usage). |
| Divider | 10 | **READY** | Covered by `Separator`. |
| Card / CardContent | 8/6 | **READY** | Compound Card (Header/Body/Footer/Image) matches usage. |
| Checkbox | 8 | **PARTIAL** | Functionally fine since forms already use RHF `Controller` (not `register()`), but note button-role (not native `<input>`) semantics for anything assuming native checkbox behavior. |
| InputAdornment | 6 | **READY** | Input's native `prefix`/`suffix`/`icon` props are a cleaner equivalent. |
| Avatar | 5 | **MISSING** | No equivalent in VhyxUI. |
| Tooltip | 5 | **READY**\* | Functionally fine; \*flagged bug — no `forwardRef`. |
| CircularProgress | 5 | **READY** | Covered by `Spinner` (standalone) and Button's built-in `loading` (inline case). |
| Paper | 5 | **PARTIAL** | No direct equivalent; Card (`variant='elevated'`) likely substitutes for most "surface" use, but Paper's more generic role may need plain-div+token-CSS in some spots. |
| ClickAwayListener | 5 | **READY** | Subsumed — VhyxUI's compound Popover/Select/Dialog have outside-click handling built in; this becomes unnecessary once custom dropdown-like UI moves onto those primitives. |
| Skeleton (TableSkeleton) | 5 | **MISSING** | No equivalent in VhyxUI. |
| Fade | 3 | **MISSING** | No standalone transition primitive; likely low effort to replace with CSS transitions directly. |
| Tabs | 2 | **READY** | Compound Tabs, variant set covers usage. |
| FormControlLabel | 1 | **READY** | Superseded by `Field`'s built-in label handling. |
| Badge (MUI overlay-on-icon usage) | 1 | **PARTIAL** | VhyxUI's "Badge" reads as a standalone label/tag, not confirmed to support MUI Badge's corner-overlay-on-a-child positioning — verify before relying on it for the one existing usage. |
| Autocomplete | 1 (admin-only) | **MISSING** | No Autocomplete/Combobox in VhyxUI; lowest priority given single, low-traffic usage site. |
| DatePicker | 0 (native `<input type=date>` used today) | **N/A** | No current usage to migrate; note for the record that VhyxUI also has no DatePicker if one is ever needed. |
| Data table (`GenericServerTable`) | 3 screens share it | **STRUCTURAL, not a component gap** | Already MUI-independent (raw HTML `<table>` + headless `@tanstack/react-table`) — nothing to "swap." Work is restyling with VhyxUI tokens/CSS Modules, plus swapping pagination UI to VhyxUI's `Pagination` (good fit — page-index driven). |
| Forms (RHF + yup + `Controller`/`CustomTextField`) | pervasive | **PARTIAL, structural-flavored** | VhyxUI's `Form`/`Field` is RHF-native and arguably better-designed, but requires rewriting the shared `CustomTextField`-equivalent wrapper layer once, then updating call sites across every form screen. |
| Toast (react-toastify + react-hot-toast) | 8+5 files | **READY** | VhyxUI's imperative Toast API closely mirrors `react-hot-toast`'s shape — migration also resolves the existing dual-library duplication as a side effect. |
| Drawer (mobile nav toggle) | chrome-level | **READY** (primitive only) | `side`/`size` props fit; the actual nav *system* built on top of it is a separate structural item below. |
| Breadcrumb | chrome-level | **READY** | Compound Breadcrumb exists; real usage volume in the app wasn't independently confirmed. |

### Structural (theming/layout — not component swaps)

1. **No ThemeProvider equivalent.** VhyxVoid's `CustomThemeProvider` (CSS-variable `colorSchemes`, RTL, and a live runtime Customizer for mode/skin/layout/navbar/footer variants, cookie-persisted) has nothing to attach to in VhyxUI — theming there is CSS-variable-only with no JS theme object or context. This is the single largest structural gap: the Customizer's live-editable settings system would need to be entirely hand-built as a custom CSS-variable-toggling layer on top of VhyxUI's existing token CSS.
2. **No layout primitives.** Box/Grid/Stack/Container are used in nearly every page (29+ files) for pure scaffolding and have zero VhyxUI equivalent. Needs either plain-div+flexbox/grid CSS (viable, since VhyxUI doesn't preclude custom CSS) or a small internal shim library.
3. **No navigation/app-shell system.** VhyxUI has no Menu/Dropdown and nothing resembling a vertical-nav/sidebar system. The entire dashboard shell (`@menu/vertical-menu`, `@layouts`) has to be hand-built from `Drawer` + plain nav markup + VhyxUI tokens.
4. **Design-token porting, not 1:1.** VhyxVoid's palette/shadow/spacing/typography *values* can port into VhyxUI's token CSS fairly directly (both are ultimately CSS custom properties), but the 36 MUI component-level style overrides (e.g., Chip's `tonal` variant) have no destination in VhyxUI's model and would become bespoke CSS Modules layered on top of VhyxUI's own — no officially documented "override slot" was confirmed beyond passing a `className`/`style` (components generally spread rest props, which should make this viable as an escape hatch, similar in spirit to MUI's `sx` but less ergonomic).

### Bugs (report to VhyxUI team, don't route around silently)
- Barrel/doc component-count mismatch (22 claimed vs. 25 exported).
- Missing `forwardRef` on `TextField`, `SelectField`, `TextareaField`, `Tooltip`, `Toast` (component), `Form`/`Field` — inconsistent with the other 21 components; `Tooltip`/`Toast` genuinely can't be ref'd today.
- `apps/docs`/`apps/playground` pinned to stale `@vhyxui/react`/`@vhyxui/tokens` versions instead of `workspace:*` — docs site may misrepresent the current API.
- "~22 production-ready" framing overstates drop-in-ness for the button-role form controls and single-select-only `Select` — not broken, but the label oversells the ease of the swap.

---

## Part 4 — Recommended Migration Strategy

**Not a big-bang cutover.** VhyxUI is pre-1.0 (0.1–0.3-alpha across its packages), has no Storybook safety net, has confirmed `forwardRef` bugs, and is missing several components VhyxVoid uses constantly (Typography, layout primitives, nav/menu, Avatar, Skeleton) — committing the whole 19-page app to it in one shot means shipping on unstable ground with no way to verify individual component regressions in isolation. **Recommend incremental, screen-by-screen migration with MUI and VhyxUI coexisting temporarily.**

**0. Foundation work (blocking, before any screen)**
- Port palette/spacing/typography *values* into `@vhyxui/tokens`' CSS files.
- Build small internal shims for the confirmed **MISSING** items that are cheap to hand-roll (Typography as styled `<p>`/`<span>`/heading tags on tokens; Skeleton as a simple CSS-animation div) — but treat these as **temporary**, and file the Typography/Avatar/Skeleton/layout-primitive/nav-system gaps as structured issues to the VhyxUI team rather than letting hand-rolled versions silently become permanent forks.
- Spike the CSS-reset coexistence question early: MUI's Emotion-injected baseline and VhyxUI's `reset.css` will both be present on shared layout shells (e.g., root `layout.tsx`) during the transition — verify they don't visually conflict before migrating a single real page.

**1. Public marketing pages (4 pages)** — pure presentation, no forms, no data fetching. Best first target to validate Typography/layout-shim/Button/Card replacements visually with the lowest possible risk.

**2. Auth-flow pages (7 pages, `(blank-layout-pages)` group)** — confirmed to have no persistent nav chrome dependency, so they can be fully cut over without touching the dashboard shell. Proves out Form/Field, Alert, Toast, and simple Dialog patterns end-to-end before the harder shell work.

**3. Dashboard shell + nav chrome (once, shared infra)** — sidebar/topbar/breadcrumbs/footer via `Drawer` + hand-built nav markup + tokens. This blocks every remaining page, so budget real time here — it's the largest structural item with the least existing VhyxUI support (no Menu/Dropdown at all).

**4. Simple dashboard content pages** (profile, org settings, billing) — self-contained, mostly a single form or read-only display plus a status Chip/Badge.

**5. List+CRUD screens on `GenericServerTable`** (tunnels → api-keys → billing→members in that order of complexity) — table itself needs restyling once (shared component, MUI-independent already), then `Pagination` swap; sequence tunnels (read-heavy, simplest dialogs) before api-keys (secret-reveal/rotate dialogs) before members (role-change/transfer-ownership dialogs, most interaction complexity).

**6. Admin-only screens last** (the single Autocomplete usage) — lowest traffic, and blocked on either VhyxUI adding a Combobox or a one-off hand-built substitute just for this screen.

**Alongside migration, not as separate projects**: consolidate `react-toastify`+`react-hot-toast` into VhyxUI's Toast as each screen touching them is migrated; delete the two confirmed-dead code paths (`src/libs/stepper-dot/`, the abandoned `src/libs/ui/*.jsx` shadcn experiment) immediately, independent of migration progress, since they cost nothing to remove now.

**Process recommendation**: treat the first 1-2 migrated screens as a joint pilot with the VhyxUI team specifically — surface the Typography/Avatar/Skeleton/layout-primitive/nav gaps and the `forwardRef`/docs-drift bugs as structured issues before scaling to the remaining ~15 screens, rather than accumulating silent workarounds across the whole app.
