import type { Metadata } from 'next'

import type { PricingContent } from '@vhyxvoid/content'

import { PricingView } from '@/views/marketing/PricingView'
import { getBootstrap, getContent, getPlans } from '@/views/marketing/publicApi'

export async function generateMetadata(): Promise<Metadata> {
  const entry = await getContent<PricingContent>('pricing')

  return { title: entry?.seoTitle || 'Pricing — VhyxVoid', description: entry?.seoDescription ?? undefined }
}

export default async function PricingPage() {
  const [entry, plans, { settings }] = await Promise.all([getContent<PricingContent>('pricing'), getPlans(), getBootstrap()])

  return <PricingView content={entry!.data} plans={plans} signupsEnabled={settings['auth.signupsEnabled'] !== false} />
}
