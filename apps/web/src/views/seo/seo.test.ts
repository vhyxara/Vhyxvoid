import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  pages: [] as Array<{ path: string; title: string | null; description: string | null; imageUrl: string | null; noindex: boolean }>,
  sitemap: { pages: [{ slug: 'about', updatedAt: '2026-10-01T00:00:00Z' }], posts: [{ slug: 'hello', updatedAt: '2026-10-02T00:00:00Z' }], categories: ['news'], tags: ['js'], hidden: ['/about'] }
}))

vi.mock('server-only', () => ({}))
vi.mock('@/views/marketing/publicApi', () => ({
  API_BASE: 'http://api.test/api/v1',
  getBootstrap: async () => ({ settings: state.settings, footer: [] }),
  getSeo: async () => ({ pages: state.pages, redirects: [] }),
  getSitemap: async () => state.sitemap,
  siteUrl: async () => 'https://www.acme.test'
}))

const { pageMetadata, routeMetadata, siteMetadata, siteJsonLd, imageFor } = await import('./seo')
const { faqJsonLd, breadcrumbJsonLd, scriptJson } = await import('./JsonLd')
const { redirectFor } = await import('./redirects')
const robots = (await import('@/app/robots')).default
const sitemap = (await import('@/app/sitemap')).default

beforeEach(() => {
  state.settings = { 'general.productName': 'Acme', 'general.tagline': 'Tunnels for everyone' }
  state.pages = []
})

describe('page metadata', () => {
  it('applies the title template, canonical address, previews and the default description', async () => {
    state.settings['seo.defaultDescription'] = 'Acme shares localhost.'
    state.settings['seo.twitterHandle'] = 'acmehq'
    const m = await pageMetadata({ path: '/pricing', title: 'Pricing' })

    expect(m.title).toEqual({ absolute: 'Pricing — Acme' })
    expect(m.description).toBe('Acme shares localhost.')
    expect(m.alternates?.canonical).toBe('/pricing')
    expect(String(m.metadataBase)).toBe('https://www.acme.test/')
    expect(m.robots).toMatchObject({ index: true })
    expect(m.openGraph).toMatchObject({ siteName: 'Acme', url: '/pricing', title: 'Pricing — Acme', images: [{ url: 'https://www.acme.test/api/og?title=Pricing' }] })
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', site: '@acmehq' })
  })

  it('lets the SEO screen override any address, and hide it', async () => {
    state.settings['seo.titleTemplate'] = '%s | Acme tunnels'
    state.pages = [{ path: '/pricing', title: 'Plans and prices', description: 'Cheap.', imageUrl: '/img/p.png', noindex: true }]
    const m = await routeMetadata('/pricing')

    expect(m.title).toEqual({ absolute: 'Plans and prices | Acme tunnels' })
    expect(m.description).toBe('Cheap.')
    expect(m.robots).toMatchObject({ index: false })
    expect(m.openGraph).toMatchObject({ images: [{ url: 'https://www.acme.test/img/p.png' }] })
  })

  it('keeps the home title as is, and noindexes everything when indexing is off', async () => {
    state.settings['seo.indexing'] = false
    const m = await pageMetadata({ path: '/', title: 'Acme — tunnels', isHome: true })

    expect(m.title).toEqual({ absolute: 'Acme — tunnels' })
    expect(m.robots).toMatchObject({ index: false })
    expect((await siteMetadata()).robots).toMatchObject({ index: false, follow: false })
  })

  it('picks share images: the page’s, then the default, then a generated one or none', () => {
    expect(imageFor({}, 'https://a.test', 'https://cdn.test/x.png', 'T')).toBe('https://cdn.test/x.png')
    expect(imageFor({ 'seo.defaultImage': '/d.png' }, 'https://a.test', null, 'T')).toBe('https://a.test/d.png')
    expect(imageFor({}, 'https://a.test', null, 'Hi & bye')).toBe('https://a.test/api/og?title=Hi%20%26%20bye')
    expect(imageFor({ 'seo.generatedImages': false }, 'https://a.test', null, 'T')).toBeNull()
  })

  it('puts verification codes and the template on every page', async () => {
    Object.assign(state.settings, { 'seo.googleVerification': 'g-code', 'seo.bingVerification': 'b-code', 'seo.titleTemplate': '%s · Acme' })
    const m = await siteMetadata()

    expect(m.verification).toMatchObject({ google: 'g-code', other: { 'msvalidate.01': 'b-code' } })
    expect(m.title).toEqual({ default: 'Acme', template: '%s · Acme' })
  })
})

describe('structured data', () => {
  it('describes the organization with its profiles', async () => {
    Object.assign(state.settings, { 'general.twitterUrl': 'https://x.com/acme', 'seo.socialProfiles': 'https://linkedin.com/company/acme\nnope', 'seo.organizationLogo': '/logo.png' })
    const [org, site] = await siteJsonLd()

    expect(org).toMatchObject({ '@type': 'Organization', name: 'Acme', url: 'https://www.acme.test/', logo: 'https://www.acme.test/logo.png', sameAs: ['https://x.com/acme', 'https://linkedin.com/company/acme'] })
    expect(site).toMatchObject({ '@type': 'WebSite', publisher: { '@id': 'https://www.acme.test/#organization' } })
  })

  it('builds FAQ and breadcrumbs, and escapes script-closing text', () => {
    expect(faqJsonLd([{ q: 'Free?', a: 'Yes.' }, { q: '', a: 'skipped' }])).toMatchObject({ '@type': 'FAQPage', mainEntity: [{ name: 'Free?', acceptedAnswer: { text: 'Yes.' } }] })
    expect(faqJsonLd([])).toBeNull()
    expect(breadcrumbJsonLd('https://a.test', [{ name: 'Home', path: '/' }, { name: 'Blog', path: '/blog' }]).itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://a.test/blog' })
    expect(scriptJson({ a: '</script>' })).not.toContain('</script>')
  })
})

describe('redirects in the proxy', () => {
  const rules = [
    { from: '/old', to: '/new', permanent: true },
    { from: '/docs/*', to: '/guides/*', permanent: false },
    { from: '/away', to: 'https://elsewhere.test/x', permanent: true }
  ]

  it('send old addresses to new ones, keeping the query and the language prefix', () => {
    expect(redirectFor(rules, '/old/', '?utm=1')).toEqual({ location: '/new?utm=1', status: 301, from: '/old' })
    expect(redirectFor(rules, '/fr/old', '', 'fr')).toMatchObject({ location: '/fr/new' })
    expect(redirectFor(rules, '/docs/a/b', '')).toEqual({ location: '/guides/a/b', status: 302, from: '/docs/*' })
    expect(redirectFor(rules, '/away', '?q=1')).toMatchObject({ location: 'https://elsewhere.test/x?q=1' })
    expect(redirectFor(rules, '/elsewhere', '')).toBeNull()
    expect(redirectFor([{ from: '/a', to: '/a', permanent: true }], '/a', '')).toBeNull()
  })
})

describe('robots.txt and the sitemap', () => {
  it('keep crawlers out of the app and the paths the SEO screen lists, or out of everything', async () => {
    state.settings['seo.robotsDisallow'] = ['/internal']
    const r = await robots()

    expect(r.sitemap).toBe('https://www.acme.test/sitemap.xml')
    expect((r.rules as { disallow: string[] }[])[0].disallow).toEqual(expect.arrayContaining(['/dashboard', '/internal']))
    state.settings['seo.indexing'] = false
    expect((await robots()).rules).toEqual([{ userAgent: '*', disallow: '/' }])
  })

  it('lists pages, posts and categories, minus hidden addresses', async () => {
    const urls = (await sitemap()).map(e => e.url)

    expect(urls).toEqual(expect.arrayContaining(['https://www.acme.test', 'https://www.acme.test/pricing', 'https://www.acme.test/blog/hello', 'https://www.acme.test/blog/category/news']))
    expect(urls).not.toContain('https://www.acme.test/about')
    expect(urls.some(u => u.includes('/blog/tag/'))).toBe(false)
    state.settings['seo.indexing'] = false
    expect(await sitemap()).toEqual([])
  })
})
