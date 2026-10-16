import type { Metadata } from 'next'

import { SupportView } from '@/views/marketing/SupportView'
import { getBootstrap } from '@/views/marketing/publicApi'
import { routeMetadata } from '@/views/seo/seo'

export async function generateMetadata(): Promise<Metadata> {
  return routeMetadata('/support')
}

export default async function SupportPage() {
  const { settings } = await getBootstrap()

  return (
    <SupportView
      email={settings['support.email'] || 'support@vhyxvoid.com'}
      docsUrl={settings['support.docsUrl'] || '/docs'}
      statusUrl={settings['general.statusPageUrl'] || undefined}
    />
  )
}
