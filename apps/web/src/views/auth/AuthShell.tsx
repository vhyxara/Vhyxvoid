'use client'

// The frame of every sign-in page (sign in, sign up, forgot and reset
// password, verify email, accept invitation): the website's void look.
// On wide screens the left half is the landing page's wormhole, with the
// requests that page is about in orbit; the form sits on the right. Narrow
// screens get the form over the starfield. Always dark, whatever the site
// theme, like the marketing pages.
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import Link from 'next/link'

import Logo from '@/libs/layout/shared/Logo'
import { Portal, type PortalCall } from '@/views/marketing/void/Portal'
import { Starfield } from '@/views/marketing/void/Starfield'
import voidStyles from '@/views/marketing/void/void.module.css'
import styles from './AuthShell.module.css'

export type AuthArt = { calls: PortalCall[]; local: string; caption: string; detail: string }

/** What orbits the wormhole on each page: the requests that page is about. */
export const AUTH_ART = {
  login: {
    calls: [
      { method: 'POST', path: '/webhooks/stripe', tone: 'violet' },
      { method: 'GET', path: '/api/users', tone: 'cyan' },
      { method: 'WS', path: '/live', tone: 'pink' },
      { method: 'PUT', path: '/orders/42', tone: 'blue' },
      { method: 'GET', path: '/health', tone: 'cyan' },
      { method: 'POST', path: '/graphql', tone: 'violet' }
    ],
    local: 'localhost:3000',
    caption: 'Your tunnels are where you left them.',
    detail: 'Requests keep arriving from the internet. Sign in to watch them land on your machine.'
  },
  register: {
    calls: [
      { method: 'GET', path: '/', tone: 'cyan' },
      { method: 'POST', path: '/webhooks/github', tone: 'violet' },
      { method: 'GET', path: '/app.js', tone: 'blue' },
      { method: 'POST', path: '/api/login', tone: 'pink' },
      { method: 'GET', path: '/favicon.ico', tone: 'cyan' },
      { method: 'WS', path: '/hmr', tone: 'violet' }
    ],
    local: 'localhost:5173',
    caption: 'Your localhost, on the internet.',
    detail: 'One command gives your dev server a public HTTPS address. Free to start, no card needed.'
  },
  recover: {
    calls: [
      { method: 'POST', path: '/password/forgot', tone: 'violet' },
      { method: 'GET', path: '/reset?token=…', tone: 'cyan' },
      { method: 'POST', path: '/password/reset', tone: 'pink' },
      { method: 'GET', path: '/login', tone: 'blue' }
    ],
    local: 'your inbox',
    caption: 'Lost the key? A new one is on its way.',
    detail: 'Reset links expire after an hour and work once, so an old email can’t be used against you.'
  },
  verify: {
    calls: [
      { method: 'MAIL', path: 'verify-email', tone: 'violet' },
      { method: 'GET', path: '/verify?token=…', tone: 'cyan' },
      { method: 'MAIL', path: 'welcome', tone: 'pink' },
      { method: 'GET', path: '/login', tone: 'blue' }
    ],
    local: 'your inbox',
    caption: 'One click from your first tunnel.',
    detail: 'Confirming your address keeps your account, keys and tunnels yours.'
  },
  invite: {
    calls: [
      { method: 'POST', path: '/invitations', tone: 'violet' },
      { method: 'MAIL', path: 'invite', tone: 'pink' },
      { method: 'GET', path: '/accept?token=…', tone: 'cyan' },
      { method: 'GET', path: '/dashboard', tone: 'blue' }
    ],
    local: 'your team',
    caption: 'Your team is waiting on the other side.',
    detail: 'Share tunnels, keys and mocks with the people you build with.'
  }
} satisfies Record<string, AuthArt>

export function AuthShell({ art, children }: { art: AuthArt; children: ReactNode }) {
  // Dark whatever the site theme, for the layers outside this tree (toasts, dialogs) too.
  useEffect(() => {
    const html = document.documentElement
    const before = html.dataset.theme

    html.dataset.theme = 'dark'

    return () => {
      if (before) html.dataset.theme = before
    }
  }, [])

  return (
    <div className={styles.shell} data-theme='dark' data-brand='vhyxvoid'>
      <a href='#main-content' className='skip-link'>
        Skip to content
      </a>
      <aside className={`${voidStyles.void} ${styles.art}`} aria-hidden>
        <Starfield className={styles.stars} focusX={0.5} focusY={0.42} density={0.8} />
        <div className={styles.portal}>
          <Portal calls={art.calls} local={art.local} />
        </div>
        <div className={styles.caption}>
          <p className={styles.captionTitle}>{art.caption}</p>
          <p>{art.detail}</p>
        </div>
      </aside>
      <main id='main-content' tabIndex={-1} className={styles.panel}>
        <Starfield className={styles.panelStars} focusX={0.5} focusY={0.1} density={0.35} />
        <Link href='/' className={styles.home} aria-label='Home'>
          <Logo />
        </Link>
        <div className={styles.card}>{children}</div>
      </main>
    </div>
  )
}
