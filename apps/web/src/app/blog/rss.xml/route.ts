// /blog/rss.xml: the newest 20 posts as RSS 2.0, for feed readers. Outside
// [locale] (a file path, so the locale proxy skips it); cached like the blog
// pages, under the "cms" tag.
import { getBlogPosts, getBootstrap, siteUrl } from '@/views/marketing/publicApi'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export async function GET() {
  const [site, list, { settings }] = await Promise.all([siteUrl(), getBlogPosts({ limit: 20 }), getBootstrap()])
  const product = settings['general.productName'] || 'VhyxVoid'
  const items = (list?.items ?? [])
    .map(p => {
      const link = `${site}/blog/${p.slug}`

      return [
        '    <item>',
        `      <title>${xml(p.title)}</title>`,
        `      <link>${xml(link)}</link>`,
        `      <guid isPermaLink="true">${xml(link)}</guid>`,
        `      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
        p.excerpt ? `      <description>${xml(p.excerpt)}</description>` : '',
        p.authorName ? `      <dc:creator>${xml(p.authorName)}</dc:creator>` : '',
        p.category ? `      <category>${xml(p.category.name)}</category>` : '',
        ...p.tags.map(t => `      <category>${xml(t.name)}</category>`),
        '    </item>'
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xml(`${product} blog`)}</title>
    <link>${xml(`${site}/blog`)}</link>
    <description>${xml(settings['general.tagline'] || `News and guides from ${product}.`)}</description>
    <language>en</language>
    <atom:link href="${xml(`${site}/blog/rss.xml`)}" rel="self" type="application/rss+xml" />
${list?.items[0] ? `    <lastBuildDate>${new Date(list.items[0].publishedAt).toUTCString()}</lastBuildDate>\n` : ''}${items}
  </channel>
</rss>
`

  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } })
}
