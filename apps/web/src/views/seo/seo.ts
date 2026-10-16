import 'server-only'

// Metadata for every public page, from one place: the page says what it is
// (path, title, description, image), the admin's SEO screen can override any
// of it per address, and the site-wide SEO settings fill the rest (title
// template, default description and image, X handle, indexing). Canonical
// links always point at the unprefixed path on the site address, so /fr/x and
// /x?utm=… count as /x.
import type { Metadata } from 'next'

import { SITE_ROUTES, applyTitleTemplate, profileUrls } from '@vhyxvoid/content'

import { API_BASE, getBootstrap, getSeo, siteUrl, type PublicSettings } from '@/views/marketing/publicApi'

export type PageSeo = {
  /** The page's path on the site, e.g. "/pricing". */
  path: string
  title: string
  description?: string | null
  /** An https URL or a site path; the page's own (a blog cover…). */
  image?: string | null
  imageAlt?: string
  type?: 'website' | 'article'
  /** The page's own choice; the SEO screen and the indexing setting can add to it. */
  noindex?: boolean
  /** The home page uses its title without the template. */
  isHome?: boolean
  /** Extra fields merged into the result (openGraph article times…). */
  extra?: Metadata
}

export async function seoContext() {
  const [{ settings }, seo, site] = await Promise.all([getBootstrap(), getSeo(), siteUrl()])

  return {
    settings,
    site,
    product: settings['general.productName'] || 'VhyxVoid',
    overrides: new Map(seo.pages.map(p => [p.path, p])),
    indexing: settings['seo.indexing'] !== false
  }
}

const absolute = (site: string, url: string) => (url.startsWith('/') ? `${site}${url}` : url)

/** The share image of a page: its own, else the default, else one generated from its title. */
export function imageFor(settings: PublicSettings, site: string, own: string | null | undefined, title: string): string | null {
  if (own) return absolute(site, own)
  if (settings['seo.defaultImage']) return absolute(site, settings['seo.defaultImage'])

  return settings['seo.generatedImages'] === false ? null : `${site}/api/og?title=${encodeURIComponent(title.slice(0, 120))}`
}

export async function pageMetadata(page: PageSeo): Promise<Metadata> {
  const { settings, site, product, overrides, indexing } = await seoContext()
  const o = overrides.get(page.path)
  const ownTitle = o?.title || page.title
  const title = page.isHome && !o?.title ? ownTitle || product : applyTitleTemplate(ownTitle, settings['seo.titleTemplate'] ?? '', product)
  const description = o?.description || page.description || settings['seo.defaultDescription'] || undefined
  const image = imageFor(settings, site, o?.imageUrl || page.image, ownTitle || product)
  const noindex = !indexing || !!o?.noindex || !!page.noindex
  const handle = settings['seo.twitterHandle'] ? `@${settings['seo.twitterHandle'].replace(/^@/, '')}` : undefined
  const images = image ? [{ url: image, width: 1200, height: 630, alt: page.imageAlt || ownTitle || product }] : undefined
  const extra = page.extra ?? {}

  return {
    ...extra,
    metadataBase: new URL(site),
    title: { absolute: title },
    description,
    alternates: { ...extra.alternates, canonical: page.path },
    robots: noindex ? { index: false, follow: true } : { index: true, follow: true, 'max-image-preview': 'large' },
    openGraph: { siteName: product, url: page.path, title, description, type: page.type ?? 'website', images, locale: 'en_US', ...(extra.openGraph as object) } as Metadata['openGraph'],
    twitter: { card: image ? 'summary_large_image' : 'summary', site: handle, creator: handle, title, description, images: image ? [image] : undefined, ...(extra.twitter as object) } as Metadata['twitter']
  }
}

/** Metadata for one of the site's fixed routes (SITE_ROUTES), with extras. */
export function routeMetadata(path: string, page: Partial<PageSeo> = {}): Promise<Metadata> {
  const route = SITE_ROUTES.find(r => r.path === path)

  return pageMetadata({ path, title: route?.title ?? '', description: route?.description, ...page })
}

/** What every page inherits (root layout): verification codes, indexing, the defaults. */
export async function siteMetadata(): Promise<Metadata> {
  const { settings, site, product, indexing } = await seoContext()
  const other: Record<string, string> = {}

  if (settings['seo.bingVerification']) other['msvalidate.01'] = settings['seo.bingVerification']

  return {
    metadataBase: new URL(site),
    applicationName: product,
    title: { default: product, template: settings['seo.titleTemplate']?.includes('%s') ? settings['seo.titleTemplate'] : `%s — ${product}` },
    description: settings['seo.defaultDescription'] || settings['general.tagline'] || undefined,
    robots: indexing ? undefined : { index: false, follow: false },
    verification: {
      google: settings['seo.googleVerification'] || undefined,
      yandex: settings['seo.yandexVerification'] || undefined,
      other: Object.keys(other).length ? other : undefined
    },
    openGraph: { siteName: product, type: 'website' }
  }
}

// ── Structured data (schema.org JSON-LD) ──

/** The organization and the site, for the home page. */
export async function siteJsonLd() {
  const { settings, site, product } = await seoContext()
  const sameAs = profileUrls(settings['seo.socialProfiles'] ?? '', settings['general.twitterUrl'], settings['general.githubUrl'])
  const logo = settings['seo.organizationLogo'] ? absolute(site, settings['seo.organizationLogo']) : undefined

  return [
    { '@context': 'https://schema.org', '@type': 'Organization', '@id': `${site}/#organization`, name: product, url: `${site}/`, logo, sameAs: sameAs.length ? sameAs : undefined, email: settings['support.email'] || undefined },
    { '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${site}/#website`, name: product, url: `${site}/`, description: settings['seo.defaultDescription'] || settings['general.tagline'] || undefined, publisher: { '@id': `${site}/#organization` } }
  ]
}

// ── Missing addresses ──

/**
 * Tells the API a visitor asked for an address that doesn't exist (SEO
 * screen → Not found). Needs REVALIDATE_SECRET (shared with the API); runs
 * after the response, so a slow API never delays the 404 page.
 */
export async function reportNotFound(path: string) {
  const secret = process.env.REVALIDATE_SECRET

  if (!secret) return
  const [{ after }, { headers }] = await Promise.all([import('next/server'), import('next/headers')])
  const h = await headers()
  const referrer = h.get('referer') ?? undefined

  // A link prefetch isn't a visit. Crawlers are kept: a search engine asking
  // for an old address is exactly what a redirect should catch.
  if (h.get('next-router-prefetch') || h.get('purpose') === 'prefetch') return
  after(() =>
    fetch(`${API_BASE}/public/seo/not-found`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ path, referrer }),
      signal: AbortSignal.timeout(3000)
    }).catch(() => {})
  )
}
