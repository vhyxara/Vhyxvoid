import type { Metadata } from 'next'

import type { LandingContent } from '@vhyxvoid/content'

import { LandingView } from '@/views/marketing/LandingView'
import { getBootstrap, getContent } from '@/views/marketing/publicApi'
import { JsonLd, faqJsonLd } from '@/views/seo/JsonLd'
import { pageMetadata, siteJsonLd } from '@/views/seo/seo'

export async function generateMetadata(): Promise<Metadata> {
  const [entry, { settings }] = await Promise.all([getContent<LandingContent>('home'), getBootstrap()])
  const name = settings['general.productName'] || 'VhyxVoid'

  return pageMetadata({
    path: '/',
    isHome: true,
    title: entry?.seoTitle || `${name} — ${settings['general.tagline'] || 'Your localhost, on the internet'}`,
    description: entry?.seoDescription || settings['general.tagline']
  })
}

export default async function LandingPage() {
  const [entry, { settings }, site] = await Promise.all([getContent<LandingContent>('home'), getBootstrap(), siteJsonLd()])

  return (
    <>
      <JsonLd data={[...site, faqJsonLd(entry!.data.faq?.items ?? [])].filter(Boolean)} />
      <LandingView content={entry!.data} signupsEnabled={settings['auth.signupsEnabled'] !== false} />
    </>
  )
}
