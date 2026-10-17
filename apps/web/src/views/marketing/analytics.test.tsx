import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { Analytics, CONSENT_KEY, analyticsScripts, needsConsent, readConsent } from './Analytics'
import { withCookieSettings } from './MarketingShell'

const scripts = () => Array.from(document.head.querySelectorAll('script[data-vv-analytics]')) as HTMLScriptElement[]

beforeEach(() => {
  localStorage.clear()
  document.head.querySelectorAll('script[data-vv-analytics]').forEach(s => s.remove())
})
afterEach(() => localStorage.clear())

describe('consent rules', () => {
  it('ask only for providers with cookies, unless told to always or never ask', () => {
    expect(needsConsent('ga4')).toBe(true)
    expect(needsConsent('gtm', 'auto')).toBe(true)
    expect(needsConsent('plausible', 'auto')).toBe(false)
    expect(needsConsent('umami', 'always')).toBe(true)
    expect(needsConsent('ga4', 'off')).toBe(false)
    expect(needsConsent('none', 'always')).toBe(false)
  })

  it('build each provider’s scripts, and none for a bad id', () => {
    expect(analyticsScripts('plausible', 'vhyxvoid.com')).toEqual([{ src: 'https://plausible.io/js/script.js', attrs: { 'data-domain': 'vhyxvoid.com', defer: '' } }])
    expect(analyticsScripts('umami', 'abc-123', 'https://stats.example.com/s.js')[0]).toMatchObject({ src: 'https://stats.example.com/s.js', attrs: { 'data-website-id': 'abc-123' } })
    expect(analyticsScripts('plausible', 'x.com', 'http://insecure.test/s.js')[0].src).toBe('https://plausible.io/js/script.js')
    const ga = analyticsScripts('ga4', 'G-ABC123')

    expect(ga[0].src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABC123')
    expect(ga[1].inline).toContain('"G-ABC123"')
    expect(analyticsScripts('ga4', "G-1');alert(1)//")).toEqual([])
    expect(analyticsScripts('gtm', '')).toEqual([])
  })

  it('add "Cookie settings" to the last footer column only when visitors are asked', () => {
    const cols = [{ title: 'Product', links: [] }, { title: 'Legal', links: [{ label: 'Terms', href: '/terms' }] }]

    expect(withCookieSettings(cols, false)).toBe(cols)
    expect(withCookieSettings(cols, true)[1].links.map(l => l.label)).toEqual(['Terms', 'Cookie settings'])
  })
})

describe('the banner', () => {
  const ga = { 'analytics.provider': 'ga4' as const, 'analytics.siteId': 'G-TEST1', 'consent.message': 'We count visits.', 'consent.policyUrl': '/privacy' }

  it('waits for an answer before loading Google Analytics, and remembers it', () => {
    const { unmount } = render(<Analytics settings={ga} />)

    expect(screen.getByRole('dialog').textContent).toContain('We count visits.')
    expect(scripts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(readConsent()).toBe('granted')
    expect(document.cookie).toContain(`${CONSENT_KEY}=granted`)
    expect(scripts().map(s => s.src || 'inline')).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-TEST1', 'inline'])
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
    // Next visit: no question, loads at once.
    document.head.querySelectorAll('script[data-vv-analytics]').forEach(s => s.remove())
    render(<Analytics settings={ga} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(scripts()).toHaveLength(2)
  })

  it('loads nothing after Decline, and the footer link asks again', () => {
    render(
      <>
        <Analytics settings={ga} />
        <a href='#cookie-settings'>Cookie settings</a>
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(readConsent()).toBe('denied')
    expect(scripts()).toHaveLength(0)
    fireEvent.click(screen.getByText('Cookie settings'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('loads cookieless analytics without asking, and nothing when not set up', () => {
    const { unmount } = render(<Analytics settings={{ 'analytics.provider': 'plausible', 'analytics.siteId': 'vhyxvoid.com' }} />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(scripts()[0].getAttribute('data-domain')).toBe('vhyxvoid.com')
    unmount()
    document.head.querySelectorAll('script[data-vv-analytics]').forEach(s => s.remove())
    render(<Analytics settings={{ 'analytics.provider': 'ga4', 'analytics.siteId': '' }} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(scripts()).toHaveLength(0)
  })
})
