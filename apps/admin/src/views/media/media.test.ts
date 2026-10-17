import { describe, expect, it } from 'vitest'

import { formatBytes, sortFiles } from './MediaLibrary'

const file = (name: string, type: string, size = 1000) => new File([new Uint8Array(size)], name, { type })

describe('media uploads', () => {
  it('take PNG, JPEG, WebP, GIF and AVIF up to 10 MB, and say why others are refused', () => {
    const { ok, refused } = sortFiles([file('a.png', 'image/png'), file('b.jpg', 'image/jpeg'), file('c.svg', 'image/svg+xml'), file('d.pdf', 'application/pdf'), file('e.webp', 'image/webp', 11 * 1024 * 1024)])

    expect(ok.map(f => f.name)).toEqual(['a.png', 'b.jpg'])
    expect(refused).toEqual([expect.stringMatching(/c\.svg.*scripts/), expect.stringMatching(/d\.pdf/), expect.stringMatching(/e\.webp: larger than 10 MB/)])
  })

  it('show sizes readably', () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(3.5 * 1024 * 1024)]).toEqual(['512 B', '2 KB', '3.5 MB'])
  })
})
