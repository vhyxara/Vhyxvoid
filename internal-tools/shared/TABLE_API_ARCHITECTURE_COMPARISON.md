# Table + API-Client Architecture: Cross-Project Comparison & Recommendation

**Date:** 2026-09-14
**Scope:** VhyxVoid (`apps/web`), `kautilyan-admin`, `kautilyan-frontend`
**Method:** Direct source reading in all three repos (VhyxVoid read directly in this session plus `internal-tools/user-frontend/decision.md`'s documented Step 5 bug history; kautilyan-admin and kautilyan-frontend each investigated fresh via an independent research pass, file:line-cited). No code changes made — investigation and recommendation only.

---

## PART 1 — Inventory

### 1.1 VhyxVoid (`apps/web`)

**Table architecture.** One shared component, `libs/table/GenericServerTable.tsx`, generic over `TData`/`TExtra`, driven by a `tableKey` string prop. Table state (page/limit/search/sorting/filters) lives in `useServerTable(tableKey)` (`libs/table/useServerTable.ts`), which:
- persists state to `localStorage` under `table:${tableKey}` via `usePersistedState` (`tableUtility.ts`)
- debounces search 500ms (`useDebounce`)
- derives TanStack `SortingState` into flat `sortBy`/`sortOrder`

`GenericServerTable` fetches data itself, inline:

```ts
const { data, isLoading, error } = useQuery<PaginatedResponse<TData, TExtra>>({
  queryKey: [tableKey, JSON.stringify(cleanParams)],
  queryFn: () => fetchData(cleanParams as FetchParams),
  placeholderData: previousData => previousData,
  staleTime: 5000
})
```

`fetchData` is a caller-supplied prop — the table never touches the app's real React Query hooks (`useMembersList`, `useApiKeys`, etc.); it runs a second, parallel query keyed by `[tableKey, params]`, completely disjoint from any semantic query-key factory.

Loading/empty/error render as a three-way `<tbody>` branch (error → `TableSkeleton` → "No records found" → rows) — clean and consistently ordered. Row/bulk actions are a real declarative API: `RowAction<T>` (`libs/table/type.ts`) is a discriminated union (`'click' | 'dialog' | 'confirmation'`) rendered by `RowActions` (`RowAction.tsx`), plus a parallel `BulkActions` (`TableAction.tsx`) for multi-select. **Click-to-sort state is fully plumbed** (`onSortingChange`, `manualSorting: true`) but **no column definition anywhere in the app wires `column.getToggleSortingHandler()`** to a header — the capability exists and is dead in every current screen (flagged, not fixed, since Step 5a).

**API client layer.** `api/wrapper/http.ts`'s `httpClient()` is the single real client: HMAC request signing (nonce/timestamp/signature, keyed off `NEXT_PUBLIC_SECRET_KEY`/`NEXT_PUBLIC_API_KEY`), bearer-token auth with a genuine refresh-queue (concurrent 401s during an in-flight refresh are queued and retried once the new token lands, not each triggering their own refresh), lazy imports to dodge circular deps, and envelope-unwrapping (`{success,message,data} → data`). `api/wrapper/queryClient.ts` installs global `QueryCache`/`MutationCache` `onError` handlers that `toast.error(...)` on every non-401 failure — **but no `<ToastContainer />` is mounted anywhere in the app**, so this entire error-surfacing pipeline is a confirmed no-op today (documented in `LOCAL_DEV_BACKEND.md` and `internal-tools/user-frontend/decision.md`).

Query keys use a shared `createQueryKeys(base)` factory (`utils/utility.ts`) — `accountKeys`, `memberKeys`, `apiKeyKeys`, etc. — a clean, well-designed abstraction on its own.

**The confirmed bug, read directly from the fix:** `useMembers.ts` and `useApiKeys.ts` both carry an explicit `invalidateXTable()` helper and a code comment explaining it:

```ts
// GenericServerTable owns its own useQuery, keyed by `[tableKey, params]`
// ... a different key namespace than memberKeys' `createQueryKeys('members')`
// factory. The two never overlap, so invalidating only memberKeys.list()
// never refetches the visible table ...
```

Every mutation hook (`useChangeMemberRole`, `useRemoveMember`, `useTransferOwnership`, `useCreateApiKey`, `useUpdateApiKey`, `useRevokeApiKey`, `useRotateApiKey`) now calls **two** `invalidateQueries` — the semantic factory key and a second, ad hoc `[`members-${accountId}`]`/`[`api-keys-${accountId}`]` string that happens to match the literal `tableKey` each view passes in. This is a real, live-tested, point-fixed bug (Step 5c discovered it on Members; the Step 5 closing-check session then found and fixed the identical bug on API Keys; Tunnels was confirmed exempt only because it has no mutations at all).

**Other confirmed bugs from the same migration** (per `internal-tools/user-frontend/decision.md`, not re-derived here): a double-mutation-ownership bug where both a dialog and its parent independently called `useRotateApiKey` (two real rotate requests per click, first secret silently discarded); a wrong-ID-field bug (rotate sent the public `keyId` where the backend schema required the internal UUID `id`); a `Dialog.Portal`/`Dialog.Overlay` omission that made every dialog render permanently open; a `Member.userId` field that the backend never actually returned (only `id`), silently breaking remove/change-role/transfer-ownership until normalized at the service layer.

**Two parallel API-call paths, one dead.** `libs/components/Confirmation.tsx` supports two ways to fire its action: an `onConfirm` callback (what every real call site uses — delegates to the proper mutation hook) and a legacy `apiUrl`/`method`/`payloadData` default path that calls a **second, independent HTTP client**, `utils/fetchData.ts` — its own from-scratch HMAC signing implementation, a hardcoded `'x-api-key': 'livein-key'` header (not even reading the real API key env var for that header, despite computing the signature with it), a stray `console.log` of the secret, and no envelope-unwrapping. Confirmed via grep: **zero live call sites pass `apiUrl`** — this second client is fully vestigial today, but it is imported and would misbehave immediately if anyone used it.

### 1.2 kautilyan-admin

**Table architecture** is architecturally near-identical to VhyxVoid's — same `GenericServerTable.tsx` name, same `useServerTable` shape (localStorage-persisted state, 500ms debounce, sorting→sortBy/sortOrder), same inline `useQuery` with a self-owned key:

```ts
queryKey: [tableKey, "list", cleanParams],
queryFn: () => fetchData(cleanParams as FetchParams),
```

Loading/empty/error branching matches VhyxVoid's shape exactly. Row/bulk actions use the same `RowAction<T>` discriminated-union / `RowActions` / `BulkActions` API VhyxVoid has (this is convergent evolution or shared lineage, not a difference worth flagging).

**Click-to-sort is a proven, working capability, unevenly adopted.** `RoleTable.tsx`, `StocksTable.tsx`, and `AbilityTable.tsx` correctly wire `onClick={column.getToggleSortingHandler()}` with a sort-direction arrow icon on the header; `UsersTable.tsx` does not — same dead-plumbing gap VhyxVoid has, but only on some screens, not all. This matters directly for the recommendation below: **the exact fix VhyxVoid needs already exists, proven, in a sibling codebase.**

**API client layer.** A centralized `httpClient` (`api/wrapper/http.ts`) does HMAC signing the same way VhyxVoid does — `NEXT_PUBLIC_SECRET_KEY` mixed into the signature, sent from the browser. The `QueryClient` (`api/wrapper/queryClient.ts`) has the same shape as VhyxVoid's `onError` → toast design, **except the `<Toaster>` is actually mounted** (`providers.client.tsx`) — this pipeline genuinely works end-to-end here, unlike VhyxVoid's dead-letter version. It additionally force-redirects to `/login` on 401/403 with a duplicate-redirect guard, and has a real retry policy.

Query keys use the identical `createQueryKeys(base)` factory VhyxVoid has (near byte-for-byte). Mutations invalidate a resource's `.all` key (e.g. `userKeys.all`), not a fully-qualified list key.

**The critical finding: kautilyan-admin does NOT have VhyxVoid's staleness bug — but only by accident, not by design.** Every `tableKey` literal in the app (`"users"`, `"admins"`, `"roles"`, `"stocks"`, …) happens to equal its resource's `createQueryKeys` base string exactly. React Query's `invalidateQueries` prefix-matches by default (`exact: false`), so `invalidateQueries({queryKey: userKeys.all})` (`['users']`) also matches the table's own independent key (`['users', 'list', {...}]`) even though the table never imported `userKeys` and never consumes the real `useUserHooks` query. **Nothing enforces this coupling** — `tableKey` is a bare `string` prop, `createQueryKeys(base)` takes a bare `string`, no shared constant or lint rule ties them together. A single typo or one-sided rename would silently reproduce VhyxVoid's exact bug, undetected by any type check.

`Confirmation.tsx` here also uses a separate `fetchData` utility rather than the shared `httpClient`/service-hook path — the same dual-path pattern VhyxVoid has (not independently confirmed live or dead in kautilyan-admin, but structurally identical).

**Security note surfaced by this pass, applies to both above:** the HMAC "secret" is shipped via `NEXT_PUBLIC_SECRET_KEY`, which Next.js inlines directly into the client bundle. As request-integrity theater this may be fine (deters casual tampering/replay from non-browser clients); as an actual secret, it provides no confidentiality — anyone can read it out of the shipped JS. Worth a real decision (documented intent, or move the property it's actually protecting server-side), not silent carry-forward.

### 1.3 kautilyan-frontend

**Table architecture is structurally different from the other two, and this difference is the single most important finding of this investigation.** `components/table/DataTable.tsx` is **purely presentational** — `columns`, `data`, `isLoading`, `error`, `emptyMessage`, `getRowId`, and a `pagination` union are all props. **It owns zero query/fetch state.** Fetching happens in a per-domain hook that the *view* calls (`usePendingSignals(page, limit)`), which hands `items`/`isLoading`/`error` down into `<DataTable>`.

Pagination is deliberately two-mode, decided per table by checking what the real backend endpoint does (not assumed uniformly): `{mode: 'client'}` runs `getPaginationRowModel()` over an already-fully-fetched array where the backend has no real `.range()` (Holdings); `{mode: 'server'}` renders `data` as-is with page state owned by the caller where the backend genuinely paginates (Trade Signals). Loading/empty/error branching matches the same shape as the other two projects. Sorting is **not implemented at all** — no state, no plumbing, a direct code comment explains why ("no manualSorting since sorting isn't needed by any consumer yet"). Row actions are hand-rolled per table (no `RowAction<T>`-style abstraction) — the team's own `docs/table-architecture-notes.md` explicitly flags this as deferred, not overlooked.

That design doc is itself worth noting: a dated, honest log of the team evaluating kautilyan-admin's `GenericServerTable`/`useServerTable`/`RowAction<T>` pattern and consciously **not** building the full server-driven version yet — "one table isn't enough evidence," extraction into a shared package explicitly called premature. Real reuse (three different row shapes flowing through the identical unmodified `DataTable` engine) was verified before pagination was even added.

**API client layer.** Same family as the other two: httpOnly cross-site cookie for the session, HMAC request signing via `signer.hook.ts`, a single `httpClient<TResponse,TPayload>()` funnel, typed `ApiError(status, message)` thrown on any non-ok response. Session-expiry handling is unusually careful: it matches an exact allowlist of 4 backend error strings *and* excludes login/signup/self-details URLs, because the backend (confirmed empirically, not assumed) reuses HTTP 403 for both "session dead" and an unrelated HMAC-signature-rejection path. A 5-second dedupe guards against a burst of parallel 401-equivalents firing the same toast repeatedly.

Query keys: one factory object per domain (9 files under `api/queryKeys/`), each with an `all` root and derived sub-keys — same shape as `createQueryKeys`, just hand-written per domain rather than a shared generic factory.

**Verified directly: 100% of the 23 `queryKey`/`invalidateQueries` call sites across every hook go through these same factories.** Zero raw array literals, zero independently-derived keys. **This project cannot have VhyxVoid's bug, structurally, for two reasons: the table itself never constructs a query key at all (no query, no key to drift), and the one place a key is constructed (the domain hook) is the same function used for both the read and every mutation's invalidation of that read.**

A real, honestly-documented limitation: search/filter on Trade Signals is client-side over only the current server-paginated page (10 rows), because the backend has no search param — the team shipped a visible inline caveat rather than silently shipping broken search or over-engineering a fix.

---

## PART 2 — Cross-comparison

### Where all three converge (signal for "the right pattern")

1. **HMAC request signing as the house auth pattern.** All three independently sign every request with nonce/timestamp/signature. This is clearly the team's standing convention across every project it touches, not a one-off choice — strong signal it's intentional and should be preserved, packaged, and documented once rather than reimplemented a fourth time.
2. **Query-key-factory-as-abstraction.** All three use a `{all, lists, list(params), details, detail(id)}`-shaped factory per resource — VhyxVoid and kautilyan-admin literally share the same generic `createQueryKeys(base)` implementation; kautilyan-frontend hand-writes the identical shape per domain. This convergence is unambiguous signal: the abstraction itself is right, and the shared generic version (rather than reimplementing it per file) is strictly better with zero downside.
3. **Loading/error/empty-state branching order** (error → skeleton → "no records" → rows) is identical in shape across all three. A solid, converged UI pattern worth keeping as-is.
4. **A single, centralized `httpClient` funnel** (not scattered `fetch` calls) is universal. Good, keep it.

### Where they converge on a shared *bug*, not just a shared virtue

5. **VhyxVoid and kautilyan-admin's `GenericServerTable` architecture is near-identical — and that similarity is exactly what produces the disjoint-key staleness bug.** Both let the table own an independent `useQuery` keyed by an ad hoc `[tableKey, params]` string, disjoint from the real query-key factory the resource's mutation hooks invalidate against. VhyxVoid hit this for real (Step 5c, confirmed live: a 200 response with the correct field values, visible table never updates without a reload) and point-fixed it per mutation hook with a second `invalidateQueries` call. kautilyan-admin has the **identical architecture** and has **not** hit the bug yet — purely because every `tableKey` string in that app currently happens to equal its resource's key-factory base, so React Query's default prefix-matching accidentally saves it. That's not a fix, it's an unenforced convention one rename-typo away from reproducing VhyxVoid's exact incident. **This is the most important comparative finding in this report**: two of three projects share a latent defect, one has already paid for it, the other hasn't yet — and neither has actually fixed the structural cause.
6. **`NEXT_PUBLIC_SECRET_KEY` exposed to the browser bundle** appears in VhyxVoid and kautilyan-admin identically (kautilyan-frontend's fork report also confirms the same `NEXT_PUBLIC_SECRET_KEY` reference in its `http.ts`, so this is a three-for-three convergence, not two-for-three). Convergence here is not validation — it's the same unexamined assumption copied forward three times. Worth a single explicit decision, made once, not three separate ones.
7. **`Confirmation.tsx`'s dual API-call path** (a real `onConfirm` mutation-hook path plus a legacy `fetchData`-based `apiUrl` default path, using a second, independently-implemented signing client) appears in both VhyxVoid (confirmed fully dead — zero live callers) and kautilyan-admin (same shape, live-ness not independently confirmed). Same likely shared origin, same fix once.

### Where they genuinely diverge, and which version is better

8. **Table data ownership: kautilyan-frontend's pure-props `DataTable` is structurally better than the other two's self-fetching `GenericServerTable`.** Not a matter of taste — it is the only one of the three architectures that makes the staleness bug *impossible by construction* rather than something to remember to work around per mutation. The tradeoff: kautilyan-frontend's simplicity was earned by having fewer, more recently-built screens and consciously deferring sorting/row-actions/localStorage-persisted table state. Those are real, valuable features `GenericServerTable` already has that `DataTable` doesn't — a straight swap would be a regression, not just a refactor. The right move is to take `DataTable`'s ownership model (props in, no internal query) and re-attach `GenericServerTable`'s already-built features (`useServerTable`'s persisted/debounced state, `RowAction`/`BulkActions`, pagination component) to it, not to throw either implementation away.
9. **Click-to-sort: kautilyan-admin has proven, working header-click wiring** (`RoleTable.tsx`, `StocksTable.tsx`, `AbilityTable.tsx`) using the exact same TanStack Table primitives (`manualSorting`, `column.getToggleSortingHandler()`, `column.getIsSorted()`) that VhyxVoid already has sitting unused in `GenericServerTable`. This is not a design question to re-litigate — it's a working pattern to copy verbatim into VhyxVoid's column definitions. kautilyan-frontend deliberately has none of this plumbing at all (no manualSorting, no state), which is fine for its current screens but means it isn't a source of a proven pattern here.
10. **Error/toast pipeline: kautilyan-admin's is the only one of the three actually verified working end-to-end** (its `<Toaster>` is mounted; VhyxVoid's `<ToastContainer>` is not, making an otherwise well-designed `onError`/toast pipeline a confirmed no-op). kautilyan-admin's version — global `QueryCache`/`MutationCache` handlers, session-death detection, duplicate-redirect guard, sane retry policy — is the best current reference implementation of this piece across all three and should be the template VhyxVoid's fix is based on (which also happens to close VhyxVoid's own long-standing documented gap).
11. **Row-action structure: VhyxVoid and kautilyan-admin already converge here** (same `RowAction<T>` discriminated union, same `RowActions`/`BulkActions` split) — this is not a gap between them. kautilyan-frontend is the outlier (hand-rolled per table), but its own documentation correctly frames this as "not yet needed, not overlooked" given it only has 2-3 tables so far, not a worse design choice.
12. **VhyxVoid still has one confirmed-unmigrated MUI component inside this layer**: `libs/table/TableAction.tsx` (`BulkActions`) still imports `Stack`/`Typography` from `@mui/material` and a MUI `IconButton` — flagged in `internal-tools/user-frontend/decision.md` as intentionally out of scope for the VhyxUI migration (admin-only usage), unrelated to the kautilyan comparison itself but worth carrying into whatever refactor touches this file next, since a shared package extraction is a natural point to finish it.

---

## PART 3 — Recommendation

**Recommendation: (c), narrower than a full shared package — with a specific two-phase shape.**

Do **not** extract a shared table-component package yet (full option b), and do **not** just patch each project independently forever (pure option a). Instead:

**Phase 1 — extract and share the API-client/query-key layer now.** This is where all three projects already converge on the same design, where the shared bug lives, and where the highest-leverage, lowest-risk win is.

**Phase 2 — refactor (not yet extract) each project's server-table component to stop owning its own query**, adopting kautilyan-frontend's proven pure-props ownership model while keeping `GenericServerTable`'s superior feature set (persisted/debounced state, declarative row/bulk actions, working click-to-sort copied from kautilyan-admin). Only extract *this* into a shared package once it's proven in both VhyxVoid and kautilyan-admin and a genuinely new third table-consumer needs it — mirroring kautilyan-frontend's own documented and correct standard for when extraction is warranted ("one table isn't enough evidence"). That evidence already exists across VhyxVoid + kautilyan-admin (10+ real table screens combined); it just hasn't been converted to the safe shape yet.

### Why not full option (b) now

Extracting `GenericServerTable` into a shared package *before* fixing its internal-query-ownership flaw would just distribute the same latent bug into a third codebase with a clean-looking abstraction hiding it. Packaging is not a substitute for the structural fix — do the fix first, in place, in the two projects that already have the bug (one realized, one latent), then decide whether packaging the fixed version is worth it once there's a genuine third consumer (kautilyan-frontend, or a future VhyxVoid admin frontend, would both qualify once/if built).

### Why not pure option (a)

The API-client layer isn't just similar across the three — it's the *same* design, maintained as three independent, silently-drifting copies (kautilyan-admin's toast pipeline works and VhyxVoid's is dead; the `NEXT_PUBLIC_SECRET_KEY` exposure is unexamined in all three; the `Confirmation.tsx` dual-path wart is copied verbatim). Refining each in place independently means re-diagnosing and re-fixing the same categories of problem a third and fourth time as more projects in this family get built. This layer has already proven itself across three real codebases — that's exactly the evidence bar for sharing it now, not waiting further.

### What "done" looks like

**Phase 1 (API-client / query-key package) — concrete deliverables:**
- A small internal package (e.g. `@internal/api-kit`) exporting: (1) `createQueryKeys(base)`, extracted verbatim from its current near-identical VhyxVoid/kautilyan-admin implementation; (2) a configurable `httpClient` factory — not a single hardcoded implementation, since the three projects' auth models genuinely differ (VhyxVoid: bearer token + client-side refresh-queue; kautilyan-admin: bearer token + cookie, force-redirect-on-403; kautilyan-frontend: httpOnly cookie only, refresh expected server-side) — the shared piece is the signing/envelope-unwrapping/error-typing scaffold, with auth/refresh behavior injected per project; (3) a reference `QueryClient` factory carrying kautilyan-admin's proven working `onError`/toast/retry/session-death pattern, ported to fix VhyxVoid's dead-toast bug in the same change.
- A written decision on `NEXT_PUBLIC_SECRET_KEY`'s actual security role (documented as request-integrity/anti-tampering rather than confidentiality, or the properties it's meant to protect moved server-side) — one decision, applied to all three, not three separate unexamined copies.
- `Confirmation.tsx`'s dead `fetchData`-based default-action path removed or rewired through the shared client, in both VhyxVoid and kautilyan-admin.
- **Effort estimate:** ~1 week to design the package's auth-injection surface and extract/test the pieces above (most of the code already exists and is being consolidated, not written fresh), then roughly 1–2 days per project to adopt it. Start with VhyxVoid, since adopting it directly fixes a real, currently-live bug (the dead toast pipeline) as a side effect, giving an immediate, verifiable payoff beyond the refactor itself.

**Phase 2 (table data-ownership refactor) — concrete deliverables:**
- `GenericServerTable` (both VhyxVoid and kautilyan-admin) stops running its own internal `useQuery`; it takes `data`/`isLoading`/`error`/`total` as props, matching `DataTable`'s contract. `useServerTable`'s state (page/limit/search/sorting/filters, persisted + debounced) stays, but now drives params passed into whatever real query-key-factory-backed hook the caller supplies (`useMembersList`, `useApiKeys`, etc.) instead of being consumed by an internal ad hoc query.
- Every column definition across both apps gets the working `column.getToggleSortingHandler()` + sort-direction-icon pattern already proven in kautilyan-admin's `RoleTable.tsx`/`StocksTable.tsx`/`AbilityTable.tsx`, closing both VhyxVoid's total gap and kautilyan-admin's partial-adoption gap in one pass.
- Each conversion is independently verifiable: after converting one table, the exact Step 5c-style mutation-then-check-the-visible-row test should pass without a page reload, with no second `invalidateQueries` call needed anymore (the point-fixes in `useMembers.ts`/`useApiKeys.ts` become removable dead code once the structural fix lands — a good sign this is the real fix, not another patch).
- **Effort estimate:** VhyxVoid has 3 real tables on this pattern today (Tunnels, API Keys, Members) — roughly 3–5 days including the established functional-check discipline against the real local backend. kautilyan-admin has more tables (users, admins, roles, abilities, stocks, quarters, datasets, chatbot_faqs) — roughly 5–8 days, doable incrementally, one table at a time, each conversion immediately retiring that table's latent staleness risk.
- Package extraction of the refactored table component is a **follow-up, not scheduled now** — revisit once both projects have converted and a genuine new table (a third real consumer, whether in kautilyan-frontend or elsewhere) needs the shared shape. Estimate that follow-up at another 3–5 days once triggered.

### Sequencing note

Phase 1 and Phase 2 are independent and can run in either order or in parallel, but Phase 1 first is lower-risk and delivers a standalone win (the dead-toast fix) without touching any table's rendering behavior — a good place to build confidence in the shared package's design before Phase 2's larger, more invasive per-table refactor begins.
