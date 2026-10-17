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
import { SiteBackdrop } from './void/SiteBackdrop'
import { Analytics, COOKIE_SETTINGS_HASH, needsConsent } from './Analytics'
import { NewsletterBand } from './Newsletter'
import styles from './marketing.module.css'

/** The logo from Settings › Brand (or the built-in mark) and the product name. */
function Brand({ name, logo, logoOnly }: { name: string; logo?: string; logoOnly?: boolean }) {
  return (
    <span className={styles.brand}>
      {logo ? <img src={logo} alt={logoOnly ? name : ''} className={styles.logoImg} /> : <span className={styles.logo} aria-hidden />}
      {!(logo && logoOnly) && name}
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

/** Adds "Cookie settings" to the last footer column (Legal), when visitors are asked about cookies. */
export function withCookieSettings<C extends { title: string; links: Array<{ label: string; href: string; external?: boolean }> }>(columns: C[], on: boolean): C[] {
  if (!on || !columns.length) return columns
  const last = columns[columns.length - 1]

  return [...columns.slice(0, -1), { ...last, links: [...last.links, { label: 'Cookie settings', href: COOKIE_SETTINGS_HASH }] }]
}

/** The landing page (/, or /fr…), which brings its own starfield. */
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
  // When visitors are asked about cookies, the footer lets them change their answer.
  const cookieLink = needsConsent(s['analytics.provider'] ?? 'none', s['consent.mode']) && !!s['analytics.siteId']

  // The marketing site is the void: dark whatever the site theme (the theme
  // tokens are scoped by [data-theme], so this subtree opts in). The mobile
  // menu opens in a layer outside this wrapper (a portal under <body>), so the
  // document is dark too while a marketing page is shown; the site theme comes
  // back in the dashboard.
  useEffect(() => {
    const html = document.documentElement
    const before = html.dataset.theme

    html.dataset.theme = 'dark'

    return () => {
      if (before) html.dataset.theme = before
    }
  }, [])

  return (
    <div data-theme='dark' data-brand='vhyxvoid' className={styles.voidShell}>
      {/* Keyboard users jump past the navbar (and the announcement banner). */}
      <a href='#main-content' className='skip-link'>
        Skip to content
      </a>
      {!landing && <SiteBackdrop />}
      <Analytics settings={s} />
      <AnnouncementBanner settings={s} />
      <MarketingLayout
        navbar={{
          brand: <Brand name={name} logo={s['brand.logoUrl']} logoOnly={s['brand.logoOnly']} />,
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
          brand: <Brand name={name} logo={s['brand.logoUrl']} logoOnly={s['brand.logoOnly']} />,
          tagline: s['general.tagline'] || 'Your localhost, on the internet. Instantly.',
          linkAs: Link as any,
          // The footer menu edited in the admin panel; an API from before it
          // sends none, and then the footer is built as it used to be.
          columns: withCookieSettings(bootstrap.footerMenu
            ? footerColumns(bootstrap.footerMenu)
            : [
                { title: 'Product', links: [{ label: 'Features', href: '/#features' }, { label: 'Pricing', href: '/pricing' }, { label: 'Docs', href: docs }, ...(bootstrap.changelog?.entries ? [{ label: 'Changelog', href: '/changelog' }] : []), ...group('product')] },
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
              ], cookieLink),
          legal: `© ${new Date().getFullYear()} ${name}. All rights reserved.`
        }}
      >
        <div id='main-content' tabIndex={-1} className={styles.mainTarget}>
          {children}
        </div>
        <NewsletterBand settings={s} />
      </MarketingLayout>
    </div>
  )
}
