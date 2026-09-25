# Code archive

A structured record of every backlog item, bug or addition that was fixed or
built in the code: what was wrong, why, what changed, how it was tested and
verified, and what is still open. One Markdown file per change.

It complements `internal-tools/`:

- `internal-tools/<component>/backlog.md` lists what is still **open**.
- `internal-tools/archive/<component>-backlog.md` keeps the original backlog
  text of a resolved item plus a one-line `Resolved ...` note.
- `code-archive/` (this folder) holds the **full write-up** of each fix, so the
  one-line note can point here instead of repeating it.

## Layout

```
code-archive/
  README.md            this file: purpose, rules, session log
  INDEX.md             one row per entry, newest at the bottom
  _TEMPLATE.md         copy this to start a new entry
  api/                 apps/api
  hub/                 apps/hub
  shared/              packages/*, nginx, CI and monorepo tooling
  user-frontend/       apps/web
  admin-frontend/      apps/admin
  docs/                apps/docs
```

Component folders match `internal-tools/` so the two are easy to cross-check.

## Adding an entry

1. Take the next free ID (`CA-` plus four digits, never reused; see the last
   row of `INDEX.md`).
2. Copy `_TEMPLATE.md` to `<component>/<ID>-<short-slug>.md` and fill in every
   section. Write "None" rather than deleting a section.
3. Add a row to the bottom of `INDEX.md`.
4. If it came from a backlog, move the item to
   `internal-tools/archive/<component>-backlog.md` with its `Resolved` line
   naming the commit and this entry's ID. If only part of it is fixed, set
   **Status** to "Partially fixed", say what is left under **Follow-ups**, and
   leave the rest in `backlog.md`.
5. Record a fix only once it is verified (tests or a real check), not when it
   is merely attempted.

Entries are append-only. If a later change reverts or corrects one, add a new
entry that references the old ID instead of rewriting it.

### Field values

- **Type:** Bug fix, Security, Privacy, Performance, Cleanup, Removal,
  Consistency, Tooling, Test fix, Docs source fix, Addition (qualifiers such as
  "(data loss)" or "(flake)" are fine).
- **Severity:** Critical, High, Medium, Low, or n/a for additions.
- **Status:** Fixed, Partially fixed, Fixed (in repo; needs deploy), Done.

## Session log

### 2026-09-25: backlog sweep (`2026-09-25-backlog-sweep`)

Branch `backlog`. Entries CA-0001 to CA-0024.

| Commit | Scope |
| --- | --- |
| `b9c9f67` | apps/api fixes (CA-0001 to CA-0009) |
| `96e9c69` | apps/hub fixes and the sdk:register usage fix (CA-0010 to CA-0013, CA-0019) |
| `d61f681` | packages, nginx, test scripts, SDK JSDoc (CA-0014 to CA-0018, CA-0020, CA-0023) |
| `fc9612c` | apps/web and apps/admin (CA-0021, CA-0022) |
| `fccf1dd` | docs content (CA-0024) |

Gates at the end of the session:

- Root suite (`pnpm test`): 73 files passed, 1 skipped; 519 tests passed,
  6 skipped (482 before the session). New test files: `apiBacklogFixes20260925`,
  `agentFatalHubErrors`, `agentResponseCacheBudget`,
  `evictionReleasesSubdomain`, `frameworkSignalsAndCi`.
- `turbo run typecheck` (excluding web and admin, as CI does): 10/10.
- `turbo run build` (excluding web, admin): 8/8; `@vhyxvoid/docs` build: 32/32 pages.
- apps/web and apps/admin: `tsc` error sets identical before and after (all
  pre-existing, caused by the missing sibling `VhyxUI`/`vhyx-api-kit` checkouts);
  their vitest suites can't load here for the same reason.
- nginx: `nginx -t` OK, plus a live X-Forwarded-For check (CA-0018).

Left open on purpose (still in the backlogs), because each needs a decision
or is larger than a contained fix:

- API-key expiry on FREE (`PLAN_LIMITS.expiryAllowed` is false but the docs
  offer it to every plan): enforce or hide is a product call.
- `@vhyxvoid/middleware` port detection (audit part2 G8): needs a tunnel
  restart or a public API change.
- The agent's SQLite queue (no producer), the per-machine queue file (G2),
  request cancellation (G13), subdomain key TTLs, the usage pipeline's H4
  remainder, rate limiting of guard-rejected requests, admin logout token
  revocation, admin refresh race, account deletion, notification types,
  and all deploy notes, feature proposals and architecture items.

### 2026-09-25: decisions and end-to-end run (`2026-09-25-decisions-and-e2e`)

Entries CA-0025 to CA-0037. Commits `4a3131f`, `195f405`, `c415239`, `3eecfae`,
`ea6e1f0`, `42f6652`, `fca13f7`, `3c66040`.

- The four confirmed decisions (CA-0025 to CA-0028).
- A 53-step end-to-end journey on an isolated local stack (CA-0029). It found
  a critical pre-verification account takeover (CA-0030), dropped early
  WebSocket frames (CA-0031), billing without Redis and Stripe webhook
  problems (CA-0035), and several 500s for client errors.
- Also fixed: admin token revocation (CA-0032), the super-admin seed
  (CA-0033), TunnelClient authentication (CA-0034).
- Added: streaming responses and request cancellation (CA-0036); removed two
  wasted Redis commands per request (CA-0037).

Gates: unit suite 537 passed / 6 skipped (77 files); journey 53/53 with every
section on; typecheck 10/10 (web/admin excluded as in CI).

