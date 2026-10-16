// /robots.txt: crawl the marketing site and blog, not the signed-in app.
import type { MetadataRoute } from 'next'

import { siteUrl } from '@/views/marketing/publicApi'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await siteUrl()

  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/dashboard', '/organizations', '/profile', '/invitations', '/reset-password', '/verify-email', '/api/'] }],
    sitemap: `${site}/sitemap.xml`
  }
}
