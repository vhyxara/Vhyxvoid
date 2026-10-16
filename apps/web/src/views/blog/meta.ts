import type { Metadata } from 'next'

import { pageMetadata } from '@/views/seo/seo'

/** A page number from ?page=, or null when it isn't one. */
export function pageParam(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return 1
  const n = Number(Array.isArray(raw) ? raw[0] : raw)

  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : null
}

/**
 * Metadata every blog page shares: the site's SEO rules (views/seo/seo.ts),
 * a canonical address that keeps ?page=, and the RSS feed.
 */
export async function blogMetadata({ title, description, path, page = 1, image, imageAlt, noindex, type, extra }: { title: string; description?: string | null; path: string; page?: number; image?: string | null; imageAlt?: string; noindex?: boolean; type?: 'website' | 'article'; extra?: Metadata }): Promise<Metadata> {
  const canonical = page > 1 ? `${path}?page=${page}` : path
  const meta = await pageMetadata({ path, title: page > 1 ? `${title} (page ${page})` : title, description, image, imageAlt, noindex, type, extra })

  return {
    ...meta,
    alternates: { canonical, types: { 'application/rss+xml': [{ url: '/blog/rss.xml', title: 'Blog' }] } },
    openGraph: { ...meta.openGraph, url: canonical }
  }
}
