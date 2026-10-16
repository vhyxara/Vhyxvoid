import type { Metadata } from 'next'

import type { PricingContent } from '@vhyxvoid/content'

import { PricingView } from '@/views/marketing/PricingView'
import { getBootstrap, getContent, getPlans } from '@/views/marketing/publicApi'
import { JsonLd, faqJsonLd } from '@/views/seo/JsonLd'
import { routeMetadata } from '@/views/seo/seo'

export async function generateMetadata(): Promise<Metadata> {
  const entry = await getContent<PricingContent>('pricing')

  return routeMetadata('/pricing', { ...(entry?.seoTitle ? { title: entry.seoTitle } : {}), ...(entry?.seoDescription ? { description: entry.seoDescription } : {}) })
}

export default async function PricingPage() {
  const [entry, plans, { settings }] = await Promise.all([getContent<PricingContent>('pricing'), getPlans(), getBootstrap()])

  return (
    <>
      <JsonLd data={faqJsonLd(entry!.data.faq ?? [])} />
      <PricingView content={entry!.data} plans={plans} signupsEnabled={settings['auth.signupsEnabled'] !== false} />
    </>
  )
}
