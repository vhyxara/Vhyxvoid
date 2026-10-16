'use client'

// How a page will look in a search result and as a shared link, so an admin
// sees the effect of a title or description before saving it.
import type { ReactNode } from 'react'

import { Card, Text } from '@vhyxui/react'

export const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:4000').replace(/\/$/, '')

/** The website's address: the SEO setting if set, else this console's idea of it. */
export const siteOrigin = (setting: unknown) => (typeof setting === 'string' && setting ? setting.replace(/\/$/, '') : SITE)

/** "%s — Acme" applied to a title; the same rule as the website (packages/content applyTitleTemplate). */
export function fullTitle(title: string, template: string, product: string, isHome = false) {
  if (isHome) return title || product
  const t = template.includes('%s') ? template : `%s — ${product}`

  return title ? t.replace('%s', title) : product
}

/** The share image the website uses: the page's, else the default, else a generated one. */
export function shareImage(origin: string, image: string, defaultImage: string, generated: boolean, title: string) {
  const abs = (u: string) => (u.startsWith('/') ? `${origin}${u}` : u)

  if (image) return abs(image)
  if (defaultImage) return abs(defaultImage)

  return generated ? `${origin}/api/og?title=${encodeURIComponent(title)}` : ''
}

/** A character count that turns amber past what search engines show. */
export function Counter({ value, max, min }: { value: string; max: number; min?: number }) {
  const n = value.length

  return (
    <Text size='xs' tone='muted' style={n > max ? { color: 'var(--vhyx-color-warning, #b45309)' } : undefined}>
      {n}/{max}
      {n > max ? ' — will be cut off' : min && n > 0 && n < min ? ` — ${min}+ works better` : ''}
    </Text>
  )
}

export function SerpPreview({ url, title, description }: { url: string; title: string; description: string }) {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

  return (
    <div className='serp-preview' aria-label='Search result preview'>
      <div className='serp-url'>{url.replace(/^https?:\/\//, '').replace(/\//g, ' › ')}</div>
      <div className='serp-title'>{cut(title, 60)}</div>
      <div className='serp-desc'>{description ? cut(description, 160) : <em>Search engines pick some text from the page.</em>}</div>
    </div>
  )
}

export function SocialPreview({ url, title, description, image }: { url: string; title: string; description: string; image: string }) {
  return (
    <div className='social-preview' aria-label='Link preview'>
      {image ? <img src={image} alt='' className='social-preview-img' /> : <div className='social-preview-img social-preview-none'>No image</div>}
      <div className='social-preview-body'>
        <div className='social-preview-host'>{url.replace(/^https?:\/\//, '').split('/')[0]}</div>
        <div className='social-preview-title'>{title}</div>
        {description && <div className='social-preview-desc'>{description}</div>}
      </div>
    </div>
  )
}

/** Query areas every SEO change refreshes: the audit and pages ('seo') and the two lists. */
export const SEO_AREAS = ['seo', 'seo-redirects', 'seo-not-found']

/** A titled card. */
export function Panel({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <Card className='p-5 flex flex-col gap-3'>
      {title && (
        <div>
          <Text weight='medium' size='lg'>
            {title}
          </Text>
          {description && (
            <Text size='sm' tone='muted'>
              {description}
            </Text>
          )}
        </div>
      )}
      {children}
    </Card>
  )
}
