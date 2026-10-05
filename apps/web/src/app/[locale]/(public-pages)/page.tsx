import type { Metadata } from 'next'

import type { LandingContent } from '@vhyxvoid/content'

import { LandingView } from '@/views/marketing/LandingView'
import { getBootstrap, getContent } from '@/views/marketing/publicApi'

export async function generateMetadata(): Promise<Metadata> {
  const [entry, { settings }] = await Promise.all([getContent<LandingContent>('home'), getBootstrap()])
  const name = settings['general.productName'] || 'VhyxVoid'

  return {
    title: entry?.seoTitle || `${name} — ${settings['general.tagline'] || 'Your localhost, on the internet'}`,
    description: entry?.seoDescription ?? undefined
  }
}

export default async function LandingPage() {
  const [entry, { settings }] = await Promise.all([getContent<LandingContent>('home'), getBootstrap()])

  return <LandingView content={entry!.data} signupsEnabled={settings['auth.signupsEnabled'] !== false} />
}
