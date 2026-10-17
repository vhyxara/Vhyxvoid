// /changelog/rss.xml: the newest 20 changelog entries as RSS 2.0. Outside
// [locale], like the blog feed.
import { getBootstrap, getChangelog, siteUrl } from '@/views/marketing/publicApi'
import { KIND_LABEL, changelogAnchors } from '@/views/changelog/ChangelogView'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export async function GET() {
  const [site, list, { settings }] = await Promise.all([siteUrl(), getChangelog(1, 20), getBootstrap()])
  const product = settings['general.productName'] || 'VhyxVoid'
  const entries = list?.items ?? []
  const anchors = changelogAnchors(entries)
  const items = entries
    .map((e, i) => {
      const link = `${site}/changelog#${anchors[i]}`
      const title = e.version ? `v${e.version.replace(/^v/i, '')}: ${e.title}` : e.title

      return [
        '    <item>',
        `      <title>${xml(title)}</title>`,
        `      <link>${xml(link)}</link>`,
        `      <guid isPermaLink="false">${xml(`changelog-${e.id}`)}</guid>`,
        `      <pubDate>${new Date(e.publishedAt).toUTCString()}</pubDate>`,
        e.body ? `      <description>${xml(e.body.slice(0, 2000))}</description>` : '',
        ...e.kinds.map(k => `      <category>${xml(KIND_LABEL[k])}</category>`),
        '    </item>'
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(`${product} changelog`)}</title>
    <link>${xml(`${site}/changelog`)}</link>
    <description>${xml(`New features, improvements and fixes in ${product}.`)}</description>
    <language>en</language>
    <atom:link href="${xml(`${site}/changelog/rss.xml`)}" rel="self" type="application/rss+xml" />
${entries[0] ? `    <lastBuildDate>${new Date(entries[0].publishedAt).toUTCString()}</lastBuildDate>\n` : ''}${items}
  </channel>
</rss>
`

  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } })
}
