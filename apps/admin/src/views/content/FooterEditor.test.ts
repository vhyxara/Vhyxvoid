import { describe, expect, it } from 'vitest'

import { applyDrag, hrefProblem, type FooterData } from './FooterEditor'

const data: FooterData = {
  columns: [
    { id: 'c1', title: 'Product', links: [{ id: 'a', label: 'A', type: 'url', href: '/a' }, { id: 'b', label: 'B', type: 'url', href: '/b' }, { id: 'c', label: 'C', type: 'url', href: '/c' }] },
    { id: 'c2', title: 'Legal', links: [{ id: 't', label: 'Terms', type: 'page', slug: 'terms' }] }
  ]
}

describe('the footer editor', () => {
  it('moves columns and links to where they are dropped', () => {
    expect(applyDrag(data, 'c2', 'c1').columns.map(c => c.id)).toEqual(['c2', 'c1'])
    expect(applyDrag(data, 'c', 'a').columns[0].links.map(l => l.id)).toEqual(['c', 'a', 'b'])
    expect(applyDrag(data, 'a', 'a')).toBe(data)
    // A link dropped on another column's link stays put (moving columns is the "Column" field).
    expect(applyDrag(data, 'a', 't')).toEqual(data)
  })

  it('checks URLs the same way the API does', () => {
    for (const ok of ['https://github.com/x', '/pricing', '/#features', 'mailto:hi@example.com']) expect(hrefProblem(ok), ok).toBeNull()
    for (const bad of [undefined, '', 'javascript:alert(1)', '//evil.example', 'evil.example']) expect(hrefProblem(bad), String(bad)).toBeTruthy()
  })
})
