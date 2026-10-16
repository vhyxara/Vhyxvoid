// /robots.txt: crawl the marketing site and blog, not the signed-in app. The
// SEO screen can add paths to skip, or close the whole site (before launch,
// or on a staging copy).
import type { MetadataRoute } from 'next'

import { getBootstrap, siteUrl } from '@/views/marketing/publicApi'

const APP_PATHS = ['/dashboard', '/organizations', '/profile', '/invitations', '/reset-password', '/forgot-password', '/verify-email', '/api/']

export default async function robots(): Promise<MetadataRoute.Robots> {
  const [site, { settings }] = await Promise.all([siteUrl(), getBootstrap()])

  if (settings['seo.indexing'] === false) return { rules: [{ userAgent: '*', disallow: '/' }] }

  return {
    rules: [{ userAgent: '*', allow: ['/', '/api/og'], disallow: [...new Set([...APP_PATHS, ...(settings['seo.robotsDisallow'] ?? [])])] }],
    sitemap: `${site}/sitemap.xml`
  }
}
