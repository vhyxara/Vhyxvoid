// Refreshes the two VhyxUI-derived stylesheets this app carries as copies.
//
//   src/styles/vhyxui-tokens.css          <- apps/web's installed @vhyxui/tokens/index.css
//                                            minus its trailing reset.css section
//   src/styles/vhyxui-brand-override.css  <- packages/brand/brand.css
//
// Copied so the docs keep Fumadocs' own preflight instead of VhyxUI's reset.
// Developer-run (needs `pnpm install`), not part of `build`/CI. Re-run and
// commit the diff whenever apps/web's @vhyxui/tokens version or brand override
// changes.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const sources = [
  {
    from: resolve(root, '../web/node_modules/@vhyxui/tokens/index.css'),
    to: resolve(root, 'src/styles/vhyxui-tokens.css'),
    label: '@vhyxui/tokens index.css',
    // index.css is a concatenation ending in VhyxUI's global reset
    // (`* { margin: 0; padding: 0 }`, body/focus rules). Fumadocs/Tailwind bring
    // their own preflight; VhyxUI's reset on top zeroes every margin and padding
    // in the docs layout. Tokens only.
    transform: text => {
      const at = text.indexOf('/* === src/reset.css')

      return (at === -1 ? text : text.slice(0, at)).trimEnd() + '\n'
    },
    version: () => {
      const pkg = resolve(root, '../web/node_modules/@vhyxui/tokens/package.json')

      return existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : 'unknown'
    }
  },
  {
    from: resolve(root, '../../packages/brand/brand.css'),
    to: resolve(root, 'src/styles/vhyxui-brand-override.css'),
    label: '@vhyxvoid/brand brand.css',
    version: () => 'monorepo'
  }
]

let failed = false

for (const s of sources) {
  if (!existsSync(s.from)) {
    console.error(`[sync-tokens] missing source: ${s.from}`)
    failed = true
    continue
  }

  const header = `/* COPY — do not edit here. Source: ${s.label} (${s.version()}).\n   Refresh with: pnpm --filter @vhyxvoid/docs sync-tokens */\n\n`

  const text = readFileSync(s.from, 'utf8')

  writeFileSync(s.to, header + (s.transform ? s.transform(text) : text))
  console.log(`[sync-tokens] ${s.label} -> ${s.to}`)
}

if (failed) process.exit(1)
