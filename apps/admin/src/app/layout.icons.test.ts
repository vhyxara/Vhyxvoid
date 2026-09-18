import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Regression test for the 2026-09-18 chrome-visual finding: every
 * icon-only button in this app (row actions, Confirmation dialog icons,
 * revoke badges) rendered with zero visible pixels because
 * apps/admin/src/app/layout.tsx never imported the generated Tabler
 * icon-font CSS its copied RowAction.tsx/Confirmation.tsx components
 * depend on — apps/web does (apps/web/src/app/layout.tsx), backed by its
 * own src/assets/iconify-icons/ directory apps/admin didn't have at all.
 * See decision.md, 2026-09-18.
 *
 * A real "the icon glyph is visually painted" check is out of scope for
 * jsdom/vitest (this repo's own vitest.config.ts runs CSS through an empty
 * postcss plugin list and doesn't assert on computed styles) — that's
 * exactly why this bug survived every prior session's test-suite run
 * without being caught. This test instead guards the two concrete,
 * mechanical facts that actually caused the bug and would catch a
 * regression of either: the import exists, and the CSS file it points at
 * really defines every tabler-* class this app's own source references.
 */

const LAYOUT_PATH = join(__dirname, 'layout.tsx')
const ICON_CSS_PATH = join(__dirname, '..', 'assets', 'iconify-icons', 'generated-icons.css')

// Every tabler-* class this app's own source (src/**/*.tsx, src/**/*.ts)
// references today, collected via:
//   grep -rhoE "tabler-[a-z0-9-]+" src --include="*.tsx" --include="*.ts" | sort -u
const ICON_CLASSES_IN_USE = [
  'tabler-alert-triangle',
  'tabler-arrow-left',
  'tabler-arrows-sort',
  'tabler-ban',
  'tabler-check',
  'tabler-chevron-down',
  'tabler-chevron-up',
  'tabler-circle-check',
  'tabler-circle-x',
  'tabler-eye',
  'tabler-info-circle',
  'tabler-plus',
  'tabler-search',
  'tabler-trash',
  'tabler-x'
]

describe('apps/admin icon-font CSS — regression guard for the invisible-button bug', () => {
  it('layout.tsx imports the generated icon-font CSS, matching apps/web/src/app/layout.tsx', () => {
    const layoutSource = readFileSync(LAYOUT_PATH, 'utf8')

    expect(layoutSource).toMatch(/import ['"]@assets\/iconify-icons\/generated-icons\.css['"]/)
  })

  it('the copied generated-icons.css file exists and is non-trivial (not an empty/placeholder copy)', () => {
    const css = readFileSync(ICON_CSS_PATH, 'utf8')

    expect(css.length).toBeGreaterThan(100_000)
  })

  it.each(ICON_CLASSES_IN_USE)('generated-icons.css defines a rule for every real class in use: .%s', className => {
    const css = readFileSync(ICON_CSS_PATH, 'utf8')

    expect(css).toContain(`.${className}`)
  })
})
