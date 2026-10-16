import type { Metadata } from 'next'

import { getBootstrap, siteUrl } from '@/views/marketing/publicApi'

/** A page number from ?page=, or null when it isn't one. */
export function pageParam(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return 1
  const n = Number(Array.isArray(raw) ? raw[0] : raw)

  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : null
}

/** Metadata every blog page shares: absolute URLs, the canonical address and the RSS feed. */
export async function blogMetadata({ title, description, path, page = 1, extra }: { title: string; description?: string; path: string; page?: number; extra?: Metadata }): Promise<Metadata> {
  const [site, { settings }] = await Promise.all([siteUrl(), getBootstrap()])
  const product = settings['general.productName'] || 'VhyxVoid'
  const canonical = page > 1 ? `${path}?page=${page}` : path
  const full = `${title}${page > 1 ? ` (page ${page})` : ''} — ${product}`

  return {
    metadataBase: new URL(site),
    title: full,
    description,
    alternates: { canonical, types: { 'application/rss+xml': [{ url: '/blog/rss.xml', title: `${product} blog` }] } },
    openGraph: { type: 'website', title: full, description, url: canonical, siteName: product },
    twitter: { card: 'summary_large_image', title: full, description },
    ...extra
  }
}
