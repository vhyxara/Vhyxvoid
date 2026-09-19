# blackserver-frontend

## @vhyx/api-kit local link setup

`@vhyx/api-kit` (shared `createHttpClient`/`createQueryKeys`/`createQueryClient`
conventions — see `internal-tools/shared/TABLE_API_ARCHITECTURE_COMPARISON.md`
at the monorepo root)
is declared the same way `@vhyxui/react`/`@vhyxui/tokens` are — pnpm's `link:`
protocol, pointing at a relative path into a **separate** sibling repo:

```json
"@vhyx/api-kit": "link:../../../vhyx-api-kit"
```

Same requirement as VhyxUI below: `vhyx-api-kit` must be checked out as a
sibling directory (see the tree below) — already covered by the same
`turbopack.root` widening `next.config.ts` does for VhyxUI, so no separate
Next.js config change was needed for this package. Unlike VhyxUI, this repo
is a single package (no nested `packages/*` to pick a subpath from) and has
its own `.claude/` setup as a separate consideration — see its own README
for build/test instructions. Like VhyxUI, it ships compiled `dist/` output,
not raw source — rebuild it (`pnpm build` inside `vhyx-api-kit`) after
pulling changes there.

## VhyxUI local link setup

`@vhyxui/react` and `@vhyxui/tokens` are declared in `package.json` using pnpm's
`link:` protocol, pointing at relative paths into a **separate** sibling repo:

```json
"@vhyxui/react": "link:../../../VhyxUI/packages/react",
"@vhyxui/tokens": "link:../../../VhyxUI/packages/tokens"
```

This is a real filesystem symlink into VhyxUI's own package source (not a
published npm version), so it always reflects whatever is currently in
`packages/react/src` / `packages/react/dist` and `packages/tokens/`, and never
a stale registry version.

**To build/typecheck/dev this app locally, you need all three repos checked
out as siblings on disk**, matching the relative paths above exactly:

```
<parent>/
├── Black-Server/    (this monorepo — apps/web lives here)
├── VhyxUI/          (must exist alongside it, not nested inside)
└── vhyx-api-kit/    (same — must exist alongside it, not nested inside)
```

If VhyxUI or vhyx-api-kit live somewhere else on your machine, either
symlink them into place at their relative paths, or update the `link:`
paths in `package.json` to match (and re-run `pnpm install` at the
monorepo root afterward). Same CI caveat as VhyxUI: a bare CI checkout of
just this repo won't have either sibling present — see `decision.md`'s
2026-09-13 CI entry for the (still-unresolved) VhyxUI version of this
question, which now applies identically to vhyx-api-kit.

`@vhyxui/react` ships a pre-built `dist/` (via `vite build`); if you pull
changes in VhyxUI and don't see them reflected here, rebuild VhyxUI itself
(`pnpm --filter @vhyxui/react build` from inside the VhyxUI repo) — Turborepo
in this repo has no visibility into VhyxUI's own build graph, since it's
outside this workspace entirely.

Two non-obvious Next.js config changes in `next.config.ts` exist specifically
to make this cross-repo link work under Turbopack:
- `turbopack.root` is widened one level past this monorepo's own root, to the
  common parent of `Black-Server` and `VhyxUI` — Turbopack only resolves a
  symlinked module if its target falls inside the configured root.
- Any component from `@vhyxui/react` must be rendered from within a
  `'use client'` boundary — its components are not built for React Server
  Components, and importing one into a Server Component fails at build time.

## Internationalization and proxy middleware todos

## /docs is proxied to apps/docs

`/docs` is not served by this app. `next.config.ts` rewrites `/docs` and
`/docs/*` (`beforeFiles`) to `apps/docs`, a separate Next app with
`basePath: '/docs'`, so both share one origin. `src/proxy.ts` skips next-intl
for those paths (otherwise it rewrites `/docs` to `/en/docs` first and the docs
rewrite never matches).

- **Local dev:** run `pnpm dev:docs` (port 4002); `DOCS_ORIGIN` defaults to
  `http://localhost:4002`. Restart `apps/web`'s dev server after pulling this
  change — `next.config.ts` is not hot-reloaded.
- **Production:** set `DOCS_ORIGIN` (no trailing slash needed) at **build time**
  — Next bakes rewrites in at `next build`. Where apps/docs is deployed is not
  recorded in this repo. If `DOCS_ORIGIN` is unset the build warns and `/docs`
  falls back to the "Coming soon" placeholder page rather than proxying to
  nothing.
- Only the unprefixed `/docs` is proxied; `/fr/docs` still hits the placeholder
  (docs are English-only).
