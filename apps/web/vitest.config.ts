import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

const dirname = fileURLToPath(new URL('.', import.meta.url))

// apps/web's own, independent test config — mirrors the repo's existing
// precedent of keeping apps/web out of the root tooling graphs (own
// tsconfig, own ESLint config; see decision.md, 2026-09-09). The root
// tests/vitest.config.ts runs backend-only tests in a Node environment and
// wouldn't pick these up anyway (its `include` is tests/**/*.test.ts, and it
// has no jsdom environment for rendering React components).
//
// Run these with `pnpm --filter @vhyxvoid/web test`, not a bare `vitest`/
// `npx vitest` invoked from inside apps/web — Vitest 4 auto-discovers every
// vitest config across a pnpm workspace and merges them into one run when
// no `--config` is given, which breaks both this config's and the root
// config's own `@/` path-alias resolution (confirmed: `npx vitest run` from
// apps/web pulled in tests/e2e/* too and then failed to resolve
// '@/components/vhyxui-shims'). `pnpm --filter` avoids this by running the
// package's own "test" script (`vitest run`, no args) from its own cwd.
export default defineConfig({
  plugins: [tsconfigPaths(), react()],

  // @vhyxui/react is consumed via pnpm `link:` into a separate sibling repo
  // that has its *own* installed copy of `react`/`react-dom` (same class of
  // cross-repo duplicate-dependency issue as decision.md's 2026-09-10 "VhyxUI
  // Form/react-hook-form generic typing friction" entry, here surfacing at
  // runtime instead of compile time — two React module instances means two
  // hook dispatchers, so a VhyxUI component can throw "Invalid hook call").
  // This dedupe+alias covers plain cases, but does NOT fix every VhyxUI
  // component: any wrapped in `@vhyxseal/react`'s `withAgentContract` HOC
  // (confirmed on Card/Badge/Button, likely all of them) still pulls that
  // HOC's own required-at-a-deeper-level React copy regardless of this
  // config — those still throw and must be mocked directly per test file
  // (see GenericServerTable.test.tsx's `vi.mock('@vhyxui/react', ...)`).
  // Kept anyway since it's harmless and may help simpler cases.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: path.resolve(dirname, 'node_modules/react'),
      'react-dom': path.resolve(dirname, 'node_modules/react-dom')
    }
  },

  // Bypasses postcss.config.mjs's `plugins: ['@tailwindcss/postcss']` shorthand
  // (a Next.js/webpack convention Vite's own postcss-load-config can't parse —
  // it expects actual plugin instances). CSS Modules still need *some* postcss
  // pass to produce their class-name export map; tests don't assert on actual
  // Tailwind-generated styles, so an empty plugin list is sufficient here.
  css: {
    postcss: { plugins: [] }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}']
  }
})
