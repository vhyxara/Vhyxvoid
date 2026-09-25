Documentation lives under `internal-tools/`, split per component — not in
`.claude/`. `internal-tools/` is entirely gitignored (local working notes,
not shared/reviewed like source code).

Components: `internal-tools/api/` (apps/api), `internal-tools/hub/`
(apps/hub), `internal-tools/user-frontend/` (apps/web), `internal-tools/shared/`
(packages/*, monorepo-wide architecture, CI/test infra, cross-repo docs —
also where `LOCAL_DEV_BACKEND.md`/`TABLE_API_ARCHITECTURE_COMPARISON.md`
live now). An `internal-tools/admin-frontend/` will exist once that app is
built.

Each component folder has up to four files: `context.md` (architecture and
known state), `decision.md` (judgment calls already made — don't
re-litigate), `session_update.md` (session history), `backlog.md` (small,
already-diagnosed, deferred items). Resolved backlog items live in
`internal-tools/archive/<component>-backlog.md` (see below). The
2026-09-24 whole-application audit is kept as a permanent reference at
`internal-tools/shared/audit-2026-09-24.md`; its finding IDs (C1, H4, …)
are cited from context.md/decision.md/backlog.md.

`decision.md`/`session_update.md` are chronological append-only logs split by component — each entry lives in
whichever component it's about, in original order, with item/entry
numbering preserved across files. If you need the full cross-component
timeline, `grep` all four `decision.md` (or `session_update.md`) files by
date.

Before starting work, read in this order:

1. `internal-tools/shared/context.md` and `internal-tools/shared/decision.md`
   — always, regardless of what you're working on (cross-cutting
   architecture, the Agent/SDK auth-path split, CI/test infra, etc.)
2. Whichever component's `context.md` and `decision.md` match what you're
   working on (apps/api → `internal-tools/api/`, apps/hub →
   `internal-tools/hub/`, apps/web → `internal-tools/user-frontend/`). If
   your task spans components, read all the relevant ones.
3. That component's `backlog.md` (small, contained, non-urgent items — not
   the big architectural questions in context.md's Known Risks/Gaps)
4. The last 3-5 entries in that component's `session_update.md` — recent
   session history
5. Then execute the brief below.

At the end of the task, append one JSON entry to the relevant component's
`session_update.md` following its documented schema (use
`internal-tools/shared/session_update.md` for cross-cutting sessions). If
you made any non-trivial judgment call not already covered by an existing
decision.md entry, also append a decision.md entry (same component) in its
documented format.

If you fix a backlog.md item (intentionally or incidentally), move it out
of backlog.md into its component's archive file,
`internal-tools/archive/<component>-backlog.md` (`api`, `hub`, `shared`,
`user-frontend`, `admin-frontend`, `docs`): keep the item's original text
unchanged and add one line beneath it, `Resolved <YYYY-MM-DD>, <commit(s)
or session_id>, <one-line fix description>`. Don't check it off in place
and don't delete it outright — backlog.md should only ever show what's
still outstanding, and the archive keeps the record of what was fixed and
how (archive files are append-only, oldest first). You don't need to read
the archive at session start; `grep` it when checking whether something
was already fixed. Only move an item once the fix is confirmed (tests,
verification), not when a fix is merely attempted.

If you find a new small, contained, non-urgent issue that isn't worth a full context.md Known Risks/Gaps entry,
append a line to that component's backlog.md instead of letting it only
live in your session's own report.

- If your task changes the public surface of `packages/{agent,sdk,middleware,next}`, `apps/web`'s dashboard features, or `PLAN_LIMITS`, run `pnpm --filter @vhyxvoid/docs check:fresh` and update or re-verify every page it flags, in the same session (see `internal-tools/docs/context.md`, Part 4).
