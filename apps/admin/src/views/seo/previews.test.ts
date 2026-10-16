import { describe, expect, it } from 'vitest'

import { fullTitle, shareImage, siteOrigin } from './previews'

describe('SEO previews', () => {
  it('build titles the way the website does', () => {
    expect(fullTitle('Pricing', '', 'Acme')).toBe('Pricing — Acme')
    expect(fullTitle('Pricing', '%s | Acme', 'Acme')).toBe('Pricing | Acme')
    expect(fullTitle('Acme — tunnels', '%s | Acme', 'Acme', true)).toBe('Acme — tunnels')
    expect(fullTitle('', 'no placeholder', 'Acme')).toBe('Acme')
  })

  it('pick the share image: the page’s, the default, or a generated one', () => {
    expect(shareImage('https://a.test', '/img/x.png', '/d.png', true, 'T')).toBe('https://a.test/img/x.png')
    expect(shareImage('https://a.test', '', 'https://cdn.test/d.png', true, 'T')).toBe('https://cdn.test/d.png')
    expect(shareImage('https://a.test', '', '', true, 'Hello & bye')).toBe('https://a.test/api/og?title=Hello%20%26%20bye')
    expect(shareImage('https://a.test', '', '', false, 'T')).toBe('')
  })

  it('use the site address setting when there is one', () => {
    expect(siteOrigin('https://www.acme.test/')).toBe('https://www.acme.test')
    expect(siteOrigin('')).toMatch(/^http/)
  })
})
