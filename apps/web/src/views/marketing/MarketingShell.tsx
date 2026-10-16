'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { MarketingLayout } from '@vhyxui/blocks'
import { Button } from '@vhyxui/react'

import type { FooterMenu } from '@vhyxvoid/content'

import { routing } from '@/i18n/routing'

import type { Bootstrap } from './publicApi'
import styles from './marketing.module.css'

function Brand({ name }: { name: string }) {
  return (
    <span className={styles.brand}>
      <span className={styles.logo} aria-hidden />
      {name}
    </span>
  )
}

export function AnnouncementBanner({ settings }: { settings: Bootstrap['settings'] }) {
  if (!settings['announcement.enabled'] || !settings['announcement.message']) return null

  return (
    <div className={styles.banner} data-tone={settings['announcement.tone'] ?? 'info'} role='status'>
      <span>{settings['announcement.message']}</span>
      {settings['announcement.linkUrl'] && <a href={settings['announcement.linkUrl']}>{settings['announcement.linkText'] || 'Learn more'}</a>}
    </div>
  )
}

/** Footer menu columns for the footer component; empty columns are left out. */
export function footerColumns(menu: FooterMenu) {
  return menu.columns
    .filter(c => c.links.length > 0)
    .map(c => ({ title: c.title, links: c.links.map(l => (l.external ? { label: l.label, href: l.href, external: true } : { label: l.label, href: l.href })) }))
}

/** The landing page (/, or /fr…): its navbar and footer join the page's dark "void" look. */
export function isLandingPath(pathname: string) {
  const parts = pathname.split('/').filter(Boolean)

  return parts.length === 0 || (parts.length === 1 && (routing.locales as readonly string[]).includes(parts[0]))
}

export function MarketingShell({ bootstrap, children }: { bootstrap: Bootstrap; children: ReactNode }) {
  const s = bootstrap.settings
  const name = s['general.productName'] || 'VhyxVoid'
  const docs = s['support.docsUrl'] || '/docs'
  const signups = s['auth.signupsEnabled'] !== false
  const group = (g: string) => bootstrap.footer.filter(f => f.group === g).map(f => ({ label: f.title, href: `/${f.slug}` }))
  const external = (label: string, href?: string) => (href ? [{ label, href, external: true }] : [])

  const landing = isLandingPath(usePathname() ?? '')

  // The mobile menu opens in a layer outside this wrapper (a portal under
  // <body>); while the landing page is shown the document is dark too, and the
  // site theme comes back when the visitor leaves it.
  useEffect(() => {
    if (!landing) return
    const html = document.documentElement
    const before = html.dataset.theme

    html.dataset.theme = 'dark'

    return () => {
      if (before) html.dataset.theme = before
    }
  }, [landing])

  // On the landing page the shell takes the dark theme's tokens whatever the
  // site theme (they are scoped by [data-theme], so this subtree opts in).
  return (
    <div {...(landing ? { 'data-theme': 'dark', 'data-brand': 'vhyxvoid', className: styles.voidShell } : {})}>
      <AnnouncementBanner settings={s} />
      <MarketingLayout
        navbar={{
          brand: <Brand name={name} />,
          brandHref: '/',
          linkAs: Link as any,
          links: [
            { label: 'Features', href: '/#features' },
            { label: 'How it works', href: '/#how-it-works' },
            { label: 'Pricing', href: '/pricing' },
            ...(bootstrap.blog?.posts ? [{ label: 'Blog', href: '/blog' }] : []),
            { label: 'Docs', href: docs }
          ],
          actions: (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button asChild variant='ghost' size='sm'>
                <Link href='/login'>Sign in</Link>
              </Button>
              {signups && (
                <Button asChild size='sm'>
                  <Link href='/register'>Start free</Link>
                </Button>
              )}
            </div>
          )
        }}
        footer={{
          brand: <Brand name={name} />,
          tagline: s['general.tagline'] || 'Your localhost, on the internet. Instantly.',
          linkAs: Link as any,
          // The footer menu edited in the admin panel; an API from before it
          // sends none, and then the footer is built as it used to be.
          columns: bootstrap.footerMenu
            ? footerColumns(bootstrap.footerMenu)
            : [
                { title: 'Product', links: [{ label: 'Features', href: '/#features' }, { label: 'Pricing', href: '/pricing' }, { label: 'Docs', href: docs }, ...group('product')] },
                {
                  title: 'Company',
                  links: [
                    { label: 'Support', href: '/support' },
                    ...external('Status', s['general.statusPageUrl']),
                    ...external('GitHub', s['general.githubUrl']),
                    ...external('X / Twitter', s['general.twitterUrl']),
                    ...group('company')
                  ]
                },
                { title: 'Legal', links: group('legal') }
              ],
          legal: `© ${new Date().getFullYear()} ${name}. All rights reserved.`
        }}
      >
        {children}
      </MarketingLayout>
    </div>
  )
}
