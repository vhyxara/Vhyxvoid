import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// No redirects set on the SEO screen; nothing reported.
vi.mock('@/views/seo/redirects', () => ({ redirectRules: async () => [], redirectFor: () => null, reportRedirectHit: () => {} }))
// next-intl's own middleware isn't under test here: it passes requests through.
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server')

  return { default: () => () => NextResponse.next() }
})

const { default: proxy } = await import('@/proxy')
const { LOCALES, RETIRED_LOCALES, routing } = await import('./routing')

const visit = (path: string) => proxy(new NextRequest(new URL(path, 'https://site.test')))

describe('one language', () => {
  it('serves English only, with French kept switched off', () => {
    expect(routing.locales).toEqual(['en'])
    expect(LOCALES).toEqual(['en'])
    expect(RETIRED_LOCALES).toContain('fr')
  })

  it('sends old French addresses to the English page, for good', async () => {
    for (const [from, to] of [
      ['/fr', 'https://site.test/'],
      ['/fr/pricing', 'https://site.test/pricing'],
      ['/fr/blog/hello?utm=x', 'https://site.test/blog/hello?utm=x']
    ]) {
      const r = await visit(from)

      expect(r.status, from).toBe(308)
      expect(r.headers.get('location'), from).toBe(to)
    }
  })

  it('leaves English pages alone', async () => {
    const r = await visit('/pricing')

    expect(r.headers.get('location')).toBeNull()
  })
})
