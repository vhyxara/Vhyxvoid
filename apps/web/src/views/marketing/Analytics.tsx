'use client'

// Visitor analytics on the marketing website, set on the admin Settings
// screen (Analytics and cookies), and the cookie consent banner. Providers
// that set cookies (Google Analytics 4, Tag Manager) load only after the
// visitor accepts; cookieless ones (Plausible, Umami) load at once unless
// consent is required for everything. The choice is remembered for a year
// and can be changed from the footer's "Cookie settings" link.
import { useEffect, useState } from 'react'

import Link from 'next/link'

import type { PublicSettings } from './publicApi'
import styles from './marketing.module.css'

export type Consent = 'granted' | 'denied'
export const CONSENT_KEY = 'vv_consent'
export const COOKIE_SETTINGS_HASH = '#cookie-settings'

type Provider = NonNullable<PublicSettings['analytics.provider']>

/** Whether this provider puts cookies on the visitor's device. */
export const usesCookies = (p: Provider) => p === 'ga4' || p === 'gtm'

/** Ask before loading? auto: only for providers with cookies; always: for any; off: never. */
export function needsConsent(provider: Provider, mode: PublicSettings['consent.mode'] = 'auto') {
  if (provider === 'none' || mode === 'off') return false

  return mode === 'always' || usesCookies(provider)
}

export function readConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY)

    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    return null
  }
}

function saveConsent(c: Consent) {
  try {
    localStorage.setItem(CONSENT_KEY, c)
  } catch {
    // Private mode: the choice lasts for this page.
  }

  document.cookie = `${CONSENT_KEY}=${c}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax`
}

/** Google Analytics' own cookies (_ga, _ga_<id>, _gid, _gat, _gcl_*), on this host and its parent domains. */
export function clearAnalyticsCookies() {
  const names = document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => /^(_ga|_gid|_gat|_gcl)/.test(n))
  const parts = location.hostname.split('.')
  const domains = ['', ...parts.map((_, i) => `; domain=.${parts.slice(i).join('.')}`).slice(0, -1)]

  for (const n of names) for (const d of domains) document.cookie = `${n}=; Max-Age=0; Path=/${d}`
}

const ID = /^[A-Za-z0-9._-]{1,100}$/

/** The <script> tags of a provider; nothing for a missing or malformed id. */
export function analyticsScripts(provider: Provider, siteId: string, scriptUrl = ''): Array<{ src?: string; inline?: string; attrs?: Record<string, string> }> {
  if (provider === 'none' || !ID.test(siteId)) return []
  const custom = /^https:\/\//.test(scriptUrl) ? scriptUrl : ''

  switch (provider) {
    case 'plausible':
      return [{ src: custom || 'https://plausible.io/js/script.js', attrs: { 'data-domain': siteId, defer: '' } }]
    case 'umami':
      return [{ src: custom || 'https://cloud.umami.is/script.js', attrs: { 'data-website-id': siteId, defer: '' } }]
    case 'ga4':
      return [
        { src: `https://www.googletagmanager.com/gtag/js?id=${siteId}`, attrs: { async: '' } },
        { inline: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(siteId)},{anonymize_ip:true});` }
      ]
    case 'gtm':
      return [{ inline: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(siteId)});` }]
  }
}

function inject(provider: Provider, siteId: string, scriptUrl?: string) {
  if (document.querySelector('script[data-vv-analytics]')) return

  for (const s of analyticsScripts(provider, siteId, scriptUrl)) {
    const el = document.createElement('script')

    el.dataset.vvAnalytics = provider
    if (s.src) el.src = s.src
    if (s.inline) el.text = s.inline
    for (const [k, v] of Object.entries(s.attrs ?? {})) el.setAttribute(k, v)
    document.head.appendChild(el)
  }
}

export function Analytics({ settings }: { settings: PublicSettings }) {
  const provider = settings['analytics.provider'] ?? 'none'
  const siteId = settings['analytics.siteId'] ?? ''
  const ask = needsConsent(provider, settings['consent.mode'])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (provider === 'none' || !siteId) return
    if (!ask) return inject(provider, siteId, settings['analytics.scriptUrl'])
    const c = readConsent()

    if (c === 'granted') inject(provider, siteId, settings['analytics.scriptUrl'])
    else if (c === null) setOpen(true)
  }, [provider, siteId, ask, settings])

  // The footer's "Cookie settings" link reopens the choice.
  useEffect(() => {
    if (!ask) return
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a')

      if (a && a.getAttribute('href') === COOKIE_SETTINGS_HASH) {
        e.preventDefault()
        setOpen(true)
      }
    }

    document.addEventListener('click', onClick)

    return () => document.removeEventListener('click', onClick)
  }, [ask])

  if (!open) return null

  const choose = (c: Consent) => {
    saveConsent(c)
    setOpen(false)
    if (c === 'granted') inject(provider, siteId, settings['analytics.scriptUrl'])
    else {
      // Turning it off after accepting: remove what Google Analytics stored, and reload so its scripts stop.
      clearAnalyticsCookies()
      if (document.querySelector('script[data-vv-analytics]')) window.location.reload()
    }
  }

  return (
    <div className={styles.consent} role='dialog' aria-modal='false' aria-labelledby='consent-title'>
      <p id='consent-title' className={styles.consentTitle}>
        Cookies
      </p>
      <p className={styles.consentText}>
        {settings['consent.message'] || 'We use cookies to understand how visitors use this site.'}{' '}
        {settings['consent.policyUrl'] && <Link href={settings['consent.policyUrl']}>Privacy policy</Link>}
      </p>
      <div className={styles.consentActions}>
        <button type='button' className={styles.consentGhost} onClick={() => choose('denied')}>
          Decline
        </button>
        <button type='button' className={styles.consentAccept} onClick={() => choose('granted')}>
          Accept
        </button>
      </div>
    </div>
  )
}
