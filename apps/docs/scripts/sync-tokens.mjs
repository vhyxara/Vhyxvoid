// Refreshes the two VhyxUI-derived stylesheets this app carries as copies.
//
//   src/styles/vhyxui-tokens.css          <- ../../../VhyxUI/packages/tokens/index.css
//                                            minus its trailing reset.css section
//   src/styles/vhyxui-brand-override.css  <- ../web/src/app/vhyxui-brand-override.css
//
// Copied (not `link:`ed) because a public docs site must build without the
// sibling VhyxUI checkout. Manual, developer-run: needs the sibling repo
// present, so it is deliberately NOT part of `build`/CI. Re-run and commit the
// diff whenever apps/web's linked VhyxUI tokens or brand override change.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const sources = [
  {
    from: resolve(root, '../../../VhyxUI/packages/tokens/index.css'),
    to: resolve(root, 'src/styles/vhyxui-tokens.css'),
    label: '@vhyxui/tokens index.css',
    // index.css is a concatenation ending in VhyxUI's global reset
    // (`* { margin: 0; padding: 0 }`, body/focus rules). Fumadocs/Tailwind bring
    // their own preflight; VhyxUI's reset on top zeroes every margin and padding
    // in the docs layout. Tokens only.
    transform: text => text.slice(0, text.indexOf('/* === src/reset.css === */')).trimEnd() + '\n',
    version: () => {
      const pkg = resolve(root, '../../../VhyxUI/packages/tokens/package.json')

      return existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : 'unknown'
    }
  },
  {
    from: resolve(root, '../web/src/app/vhyxui-brand-override.css'),
    to: resolve(root, 'src/styles/vhyxui-brand-override.css'),
    label: 'apps/web vhyxui-brand-override.css',
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
