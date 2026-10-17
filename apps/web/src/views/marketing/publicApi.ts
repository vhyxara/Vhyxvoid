import 'server-only'

import { defaultEntry, type FooterMenu, type PublishedContent } from '@vhyxvoid/content'

// Server-side reads of the API's public endpoints for the marketing pages.
// Cached by Next for 60 s under the "cms" tag: when an admin publishes, the
// API calls /api/revalidate, which expires the tag at once (the 60 s is the
// fallback when that call is not configured). If the API is unreachable the
// site still renders: content falls back to the built-in defaults
// (packages/content) and settings to safe values.

const API = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL_LIVE ?? 'http://localhost:9000/api/v1').replace(/\/$/, '')

export type PublicSettings = Record<string, unknown> & {
  'general.productName'?: string
  'general.tagline'?: string
  'maintenance.enabled'?: boolean
  'maintenance.message'?: string
  'announcement.enabled'?: boolean
  'announcement.message'?: string
  'announcement.tone'?: 'info' | 'success' | 'warning' | 'danger'
  'announcement.linkText'?: string
  'announcement.linkUrl'?: string
  'auth.signupsEnabled'?: boolean
  'billing.checkoutEnabled'?: boolean
  'billing.trialDays'?: number
  'support.email'?: string
  'support.docsUrl'?: string
  'support.contactForm'?: boolean
  'support.captchaSiteKey'?: string
  'general.statusPageUrl'?: string
  'general.twitterUrl'?: string
  'general.githubUrl'?: string
  'seo.siteUrl'?: string
  'seo.titleTemplate'?: string
  'seo.defaultDescription'?: string
  'seo.defaultImage'?: string
  'seo.generatedImages'?: boolean
  'seo.twitterHandle'?: string
  'seo.indexing'?: boolean
  'seo.robotsDisallow'?: string[]
  'seo.organizationLogo'?: string
  'seo.socialProfiles'?: string
  'seo.googleVerification'?: string
  'seo.bingVerification'?: string
  'seo.yandexVerification'?: string
  'analytics.provider'?: 'none' | 'plausible' | 'umami' | 'ga4' | 'gtm'
  'analytics.siteId'?: string
  'analytics.scriptUrl'?: string
  'consent.mode'?: 'auto' | 'always' | 'off'
  'consent.message'?: string
  'consent.policyUrl'?: string
  'newsletter.enabled'?: boolean
  'newsletter.title'?: string
  'newsletter.description'?: string
  'brand.logoUrl'?: string
  'brand.logoOnly'?: boolean
  'brand.faviconUrl'?: string
  'brand.accentColor'?: string
}

export type Bootstrap = {
  settings: PublicSettings
  /** Pages flagged for the footer; what APIs from before the footer menu send. */
  footer: Array<{ slug: string; title: string; group: string }>
  /** The footer as the site renders it (absent from APIs before the footer menu). */
  footerMenu?: FooterMenu
  /** How many posts the blog shows (absent from APIs before the blog). */
  blog?: { posts: number }
  /** How many changelog entries are live (absent from APIs before the changelog). */
  changelog?: { entries: number }
}

export const CMS_TAG = 'cms'

export type PublicPlans = {
  /** free: launch mode, nothing can be bought. paid: Stripe checkout is live. */
  mode?: 'free' | 'paid'
  defaultPlan?: 'FREE' | 'PRO' | 'ENTERPRISE'
  freeModeMessage?: string
  checkoutEnabled: boolean
  trialDays: number
  /** Which plans can be bought yearly (absent from APIs before yearly billing). */
  yearly?: { PRO: boolean; ENTERPRISE: boolean }
  plans: Array<{ plan: 'FREE' | 'PRO' | 'ENTERPRISE'; limits: Record<string, unknown> }>
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate: 60, tags: [CMS_TAG] }, signal: AbortSignal.timeout(4000) })

    if (!res.ok) return null
    const body = (await res.json()) as { data?: T }

    return (body.data ?? null) as T | null
  } catch {
    return null
  }
}

export async function getBootstrap(): Promise<Bootstrap> {
  return (
    (await get<Bootstrap>('/public/bootstrap')) ?? {
      settings: {},
      footer: [
        { slug: 'terms', title: 'Terms of Service', group: 'legal' },
        { slug: 'privacy', title: 'Privacy Policy', group: 'legal' }
      ]
    }
  )
}

export async function getContent<T>(slug: string): Promise<PublishedContent<T> | null> {
  const live = await get<PublishedContent<T>>(`/public/content/${slug}`)

  if (live) return live
  const def = defaultEntry(slug)

  return def
    ? { slug, kind: def.kind, title: def.title, seoTitle: null, seoDescription: def.seoDescription ?? null, data: def.data as T, publishedAt: null, isDefault: true }
    : null
}

export async function getPlans(): Promise<PublicPlans | null> {
  return get<PublicPlans>('/public/plans')
}

// ── Blog ──

export type BlogTaxon = { slug: string; name: string }
/** An author profile as posts list it. */
export type BlogAuthorRef = { slug: string; name: string; avatarUrl: string }
/** The whole public profile (post pages, author pages). */
export type BlogAuthorProfile = BlogAuthorRef & { title: string; bio: string; website: string; twitter: string; github: string; linkedin: string }

export type BlogSummary = {
  slug: string
  title: string
  excerpt: string
  coverImageUrl: string | null
  coverImageAlt: string
  publishedAt: string
  updatedAt: string
  readingMinutes: number
  authorName: string
  /** The author's profile, when the post is signed with one (absent from APIs before profiles). */
  author?: BlogAuthorRef | null
  featured: boolean
  category: BlogTaxon | null
  tags: BlogTaxon[]
}

export type BlogPost = Omit<BlogSummary, 'author'> & { author?: BlogAuthorProfile | null; body: string; seoTitle: string | null; seoDescription: string | null }

export type BlogList = {
  items: BlogSummary[]
  /** The newest featured post, on page 1 of the unfiltered list only. */
  featured: BlogSummary | null
  category: (BlogTaxon & { description: string }) | null
  tag: BlogTaxon | null
  author?: BlogAuthorProfile | null
  meta: { page: number; limit: number; total: number; totalPages: number }
}

export type BlogTaxonomy = { categories: Array<BlogTaxon & { description: string; count: number }>; tags: Array<BlogTaxon & { count: number }> }

/** null: an unknown category or tag, or the API is down. */
export async function getBlogPosts(q: { page?: number; limit?: number; category?: string; tag?: string; author?: string; q?: string } = {}): Promise<BlogList | null> {
  const qs = new URLSearchParams()

  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') qs.set(k, String(v))

  return get<BlogList>(`/public/blog/posts${qs.size ? `?${qs}` : ''}`)
}

/** The post, or where an old address of it moved to. */
export async function getBlogPost(slug: string): Promise<{ post: BlogPost; related: BlogSummary[] } | { redirect: string } | null> {
  return get(`/public/blog/posts/${encodeURIComponent(slug)}`)
}

export type ChangelogKind = 'new' | 'improved' | 'fixed' | 'security'
export type ChangelogEntry = { id: string; version: string; title: string; body: string; kinds: ChangelogKind[]; publishedAt: string; updatedAt: string }
export type ChangelogList = { items: ChangelogEntry[]; total: number; page: number; pages: number }

export async function getChangelog(page = 1, limit = 20): Promise<ChangelogList | null> {
  return get<ChangelogList>(`/public/changelog?page=${page}&limit=${limit}`)
}

export async function getBlogTaxonomy(): Promise<BlogTaxonomy> {
  return (await get<BlogTaxonomy>('/public/blog/taxonomy')) ?? { categories: [], tags: [] }
}

/**
 * The website's own address, for feeds, sitemaps and canonical links: the
 * SEO screen's site address, else SITE_URL, else the address this request
 * came in on.
 */
export async function siteUrl(): Promise<string> {
  const { settings } = await getBootstrap()

  if (settings['seo.siteUrl']) return settings['seo.siteUrl'].replace(/\/$/, '')
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '')
  const { headers } = await import('next/headers')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:4000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')

  return `${proto}://${host}`
}

export type SitemapData = { pages: Array<{ slug: string; updatedAt: string }>; posts: Array<{ slug: string; updatedAt: string }>; categories: string[]; tags: string[]; authors?: string[]; hidden?: string[]; changelog?: { updatedAt: string } | null }

export async function getSitemap(): Promise<SitemapData> {
  return (await get<SitemapData>('/public/sitemap')) ?? { pages: [], posts: [], categories: [], tags: [], hidden: [] }
}

export type SeoOverride = { path: string; title: string | null; description: string | null; imageUrl: string | null; noindex: boolean }
export type SeoData = { pages: SeoOverride[]; redirects: Array<{ from: string; to: string; permanent: boolean }> }

/** Per-address SEO set on the admin SEO screen, and the redirects. */
export async function getSeo(): Promise<SeoData> {
  return (await get<SeoData>('/public/seo')) ?? { pages: [], redirects: [] }
}

export const API_BASE = API

export type PreviewData =
  | { kind: 'content'; expiresAt: string; entry: { slug: string; kind: 'landing' | 'pricing' | 'page'; title: string; status: string; seoTitle: string | null; seoDescription: string | null; data: unknown; updatedAt: string } }
  | { kind: 'post'; expiresAt: string; state: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED'; post: BlogPost & { status: string } }

/** A draft behind a preview link (admin → Preview); null when the link is wrong or expired. Never cached. */
export async function getPreview(token: string): Promise<PreviewData | null> {
  try {
    const res = await fetch(`${API}/public/preview?token=${encodeURIComponent(token)}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })

    if (!res.ok) return null

    return ((await res.json()) as { data?: PreviewData }).data ?? null
  } catch {
    return null
  }
}
