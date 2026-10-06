// Regenerates the table part of apps/docs/content/docs/operators/settings-reference.mdx
// from packages/shared's SETTING_DEFINITIONS. Run after `pnpm --filter @vhyxvoid/shared build`:
//   node scripts/docs-settings-reference.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const s = require('../packages/shared/dist/settings.js')
const groups = Object.keys(s.SETTING_GROUPS)
const esc = v => String(v).replace(/[|{}]/g, c => '\\' + c)
let out = ''
let g = null
for (const [key, d] of Object.entries(s.SETTING_DEFINITIONS).sort((a, b) => groups.indexOf(a[1].group) - groups.indexOf(b[1].group))) {
  if (d.group !== g) {
    g = d.group
    out += `\n## ${s.SETTING_GROUPS[g].label}\n\n${s.SETTING_GROUPS[g].description}\n\n| Key | Type | Default | Public | What it does |\n| --- | --- | --- | --- | --- |\n`
  }
  const def = JSON.stringify(d.default)
  const type = d.type + (d.options ? ` (${d.options.join(', ')})` : '') + (d.min !== undefined ? ` ${d.min}–${d.max ?? '∞'}` : '')
  out += `| \`${key}\` | ${type} | ${def.length > 40 ? 'see admin panel' : '`' + def.replace(/\|/g, '\\|') + '`'} | ${d.public ? 'yes' : 'no'} | ${esc(d.label)}. ${esc(d.description)} |\n`
}
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps/docs/content/docs/operators/settings-reference.mdx')
const marker = '{/* Generated from packages/shared/src/settings.ts (SETTING_DEFINITIONS). */}\n'
const src = readFileSync(file, 'utf8')
writeFileSync(file, src.slice(0, src.indexOf(marker) + marker.length) + out)
console.log('updated', file)
