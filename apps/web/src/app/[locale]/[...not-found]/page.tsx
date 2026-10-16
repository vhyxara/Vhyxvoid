// Every path no other route matches: a CMS page at /<slug> (admin panel →
// Content), else a 404 (../not-found.tsx). Real routes always win (Next matches them
// first), and the API refuses slugs that are routes (RESERVED_PAGE_SLUGS), so
// a CMS page can never hide a page of the app.
import '@vhyxui/tokens/reset.css'
import '@vhyxui/blocks/style.css'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import type { PageContent } from '@vhyxvoid/content'

import { MarkdownPage } from '@/views/marketing/MarkdownPage'
import { MarketingShell } from '@/views/marketing/MarketingShell'
import { getBootstrap, getContent } from '@/views/marketing/publicApi'

type Props = { params: Promise<{ 'not-found': string[] }> }

// Same rule as the API's slugs; anything else is not worth a lookup.
const SLUG = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/

async function cmsPage(params: Props['params']) {
  const segments = (await params)['not-found'] ?? []
  const slug = segments.map(s => decodeURIComponent(s)).join('/').toLowerCase()

  if (!SLUG.test(slug) || slug.length > 80) return null
  const entry = await getContent<PageContent>(slug)

  return entry && entry.kind === 'page' ? entry : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = await cmsPage(params)

  return entry ? { title: entry.seoTitle || `${entry.title} — VhyxVoid`, description: entry.seoDescription ?? undefined } : {}
}

const NotFoundPage = async ({ params }: Props) => {
  const entry = await cmsPage(params)

  if (entry) {
    const bootstrap = await getBootstrap()
    const s = bootstrap.settings

    return (
      <MarketingShell bootstrap={bootstrap}>
        <MarkdownPage body={entry.data.body} slug={entry.slug} contact={{ enabled: s['support.contactForm'] !== false, supportEmail: s['support.email'] || 'support@vhyxvoid.com' }} />
      </MarketingShell>
    )
  }

  // A real 404 status, rendered by ../not-found.tsx.
  notFound()
}

export default NotFoundPage
