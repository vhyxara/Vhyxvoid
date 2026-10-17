// The 404 page for paths under a locale (no route, and no CMS page at that
// slug). Rendered by notFound(), so the response status is a real 404 rather
// than a 200 "soft 404" that search engines would index. Shown inside the
// marketing site's shell, in the void's look, with the ways back.
import '@vhyxui/tokens/reset.css'
import '@vhyxui/blocks/style.css'

import { MarketingShell } from '@/views/marketing/MarketingShell'
import { getBootstrap } from '@/views/marketing/publicApi'
import { VoidNotFound } from '@/views/marketing/void/VoidNotFound'

export default async function LocaleNotFound() {
  const bootstrap = await getBootstrap()
  const s = bootstrap.settings
  const links = [
    ...(bootstrap.blog?.posts ? [{ label: 'Blog', href: '/blog' }] : []),
    { label: 'Docs', href: s['support.docsUrl'] || '/docs' },
    { label: 'Support', href: '/support' }
  ]

  return (
    <MarketingShell bootstrap={bootstrap}>
      <VoidNotFound links={links} />
    </MarketingShell>
  )
}
