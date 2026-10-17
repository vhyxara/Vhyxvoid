// /sitemap.xml: the fixed marketing routes plus every published CMS page and
// blog post and category page (from the API's /public/sitemap). Addresses the
// SEO screen hides from search engines are left out, and so is everything
// when indexing is off.
import type { MetadataRoute } from 'next'

import { getBootstrap, getSitemap, siteUrl } from '@/views/marketing/publicApi'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [site, data, { settings }] = await Promise.all([siteUrl(), getSitemap(), getBootstrap()])

  if (settings['seo.indexing'] === false) return []
  const hidden = new Set(data.hidden ?? [])
  const at = (path: string, extra: Partial<MetadataRoute.Sitemap[number]> = {}) => ({ url: `${site}${path === '/' ? '' : path}`, ...extra })

  return [
    at('/', { changeFrequency: 'weekly', priority: 1 }),
    at('/pricing', { changeFrequency: 'weekly', priority: 0.8 }),
    at('/support', { changeFrequency: 'monthly', priority: 0.5 }),
    ...(data.changelog ? [at('/changelog', { lastModified: data.changelog.updatedAt, changeFrequency: 'weekly', priority: 0.6 })] : []),
    at('/register', { changeFrequency: 'yearly', priority: 0.3 }),
    ...data.pages.map(p => at(`/${p.slug}`, { lastModified: p.updatedAt, changeFrequency: 'monthly', priority: 0.5 })),
    ...(data.posts.length ? [at('/blog', { lastModified: data.posts[0].updatedAt, changeFrequency: 'daily', priority: 0.7 })] : []),
    ...data.posts.map(p => at(`/blog/${p.slug}`, { lastModified: p.updatedAt, changeFrequency: 'monthly', priority: 0.6 })),
    ...data.categories.map(slug => at(`/blog/category/${slug}`, { changeFrequency: 'weekly', priority: 0.4 }))
    // Tag pages are noindex (blog/tag/[slug]/page.tsx), so they are left out.
  ].filter(e => !hidden.has(e.url.slice(site.length) || '/'))
}
