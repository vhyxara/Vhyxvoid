// /manifest.webmanifest: the name and colours browsers use when the site is
// installed or pinned.
import type { MetadataRoute } from 'next'

import { getBootstrap } from '@/views/marketing/publicApi'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { settings } = await getBootstrap()
  const name = settings['general.productName'] || 'VhyxVoid'

  return {
    name,
    short_name: name,
    description: settings['seo.defaultDescription'] || settings['general.tagline'] || undefined,
    start_url: '/',
    display: 'browser',
    background_color: '#0b0b12',
    theme_color: '#7c3aed',
    icons: [{ src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' }]
  }
}
