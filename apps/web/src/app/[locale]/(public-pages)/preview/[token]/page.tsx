// /preview/<token>: a draft page or post, shown with the real page layout
// under a "draft preview" banner. The link comes from the admin panel
// (Preview), is signed by the API and expires; never indexed or cached.
import type { Metadata } from 'next'

import type { LandingContent, PageContent, PricingContent } from '@vhyxvoid/content'

import { BlogPostView } from '@/views/blog/BlogViews'
import { LandingView } from '@/views/marketing/LandingView'
import { MarkdownPage } from '@/views/marketing/MarkdownPage'
import { PricingView } from '@/views/marketing/PricingView'
import { getBootstrap, getPlans, getPreview, siteUrl } from '@/views/marketing/publicApi'
import { PreviewBanner } from '@/views/marketing/void/PreviewBanner'

type Props = { params: Promise<{ token: string }> }

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getPreview((await params).token)
  const title = !p ? 'Preview expired' : p.kind === 'post' ? p.post.title : p.entry.title

  return { title: `Preview: ${title}`, robots: { index: false, follow: false, nocache: true } }
}

export default async function PreviewPage({ params }: Props) {
  const p = await getPreview((await params).token)

  if (!p) {
    return <PreviewBanner expired />
  }

  const [{ settings }, site] = await Promise.all([getBootstrap(), siteUrl()])
  const signups = settings['auth.signupsEnabled'] !== false

  if (p.kind === 'post') {
    const live = p.state === 'PUBLISHED' ? `/blog/${p.post.slug}` : undefined

    return (
      <>
        <PreviewBanner what={p.state === 'SCHEDULED' ? 'Scheduled post' : p.state === 'DRAFT' ? 'Draft post' : 'Saved post'} expiresAt={p.expiresAt} liveHref={live} />
        <BlogPostView post={p.post} related={[]} site={site} />
      </>
    )
  }

  const e = p.entry
  const live = e.status === 'PUBLISHED' ? (e.kind === 'landing' ? '/' : e.kind === 'pricing' ? '/pricing' : `/${e.slug}`) : undefined
  const banner = <PreviewBanner what={e.status === 'PUBLISHED' ? 'Working copy (not published yet)' : 'Draft page'} expiresAt={p.expiresAt} liveHref={live} />

  if (e.kind === 'landing') {
    return (
      <>
        {banner}
        <LandingView content={e.data as LandingContent} signupsEnabled={signups} />
      </>
    )
  }

  if (e.kind === 'pricing') {
    return (
      <>
        {banner}
        <PricingView content={e.data as PricingContent} plans={await getPlans()} signupsEnabled={signups} />
      </>
    )
  }

  return (
    <>
      {banner}
      <MarkdownPage
        body={(e.data as PageContent).body}
        slug={e.slug}
        contact={{ enabled: settings['support.contactForm'] !== false, supportEmail: settings['support.email'] || 'support@vhyxvoid.com', captchaSiteKey: settings['support.captchaSiteKey'] || undefined }}
      />
    </>
  )
}
