import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

const dirname = fileURLToPath(new URL('.', import.meta.url))

// apps/admin's own, independent test config — same shape as apps/web's
// (see that file's own comment for the full "why a separate config, why
// `pnpm --filter` not a bare `vitest`" rationale, which applies identically
// here since apps/admin has the same cross-repo `link:` React-duplication
// exposure). Run with `pnpm --filter @vhyxvoid/admin test`.
export default defineConfig({
  plugins: [tsconfigPaths(), react()],

  // @vhyxui/react resolves its own separately-installed react/react-dom
  // copy through the `link:` symlink into VhyxUI's sibling repo — dedupe +
  // alias to this app's own copy so a real VhyxUI component doesn't throw
  // "Invalid hook call" from two live React instances. Same known-incomplete
  // fix as apps/web's own config: components wrapped in `@vhyxseal/react`'s
  // `withAgentContract` HOC still need per-test `vi.mock('@vhyxui/react', ...)`
  // — see GenericServerTable.test.tsx, copied verbatim from apps/web with
  // its existing mock intact.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: path.resolve(dirname, 'node_modules/react'),
      'react-dom': path.resolve(dirname, 'node_modules/react-dom')
    }
  },

  // Bypasses postcss.config.mjs's `plugins: ['@tailwindcss/postcss']`
  // shorthand, which Vite's own postcss-load-config can't parse (a Next.js/
  // webpack convention, not a Vite one). CSS Modules still need some postcss
  // pass to produce their class-name export map; tests don't assert on
  // actual Tailwind-generated styles, so an empty plugin list is sufficient.
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
