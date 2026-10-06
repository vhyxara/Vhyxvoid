import 'server-only'

import { defaultEntry, type PublishedContent } from '@vhyxvoid/content'

// Server-side reads of the API's public endpoints for the marketing pages.
// Cached by Next for 60 s (the admin panel's publish shows up within a
// minute). If the API is unreachable the site still renders: content falls
// back to the built-in defaults (packages/content) and settings to safe values.

const API = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL_LIVE ?? 'http://localhost:9000/api/v1').replace(/\/$/, '')

export type PublicSettings = Record<string, unknown> & {
  'general.productName'?: string
  'general.tagline'?: string
  'maintenance.enabled'?: boolean
  'maintenance.message'?: string
  'announcement.enabled'?: boolean
  'announcement.message'?: string
  'announcement.tone'?: 'info' | 'success' | 'warning' | 'danger'
  'announcement.linkText'?: string
  'announcement.linkUrl'?: string
  'auth.signupsEnabled'?: boolean
  'billing.checkoutEnabled'?: boolean
  'billing.trialDays'?: number
  'support.email'?: string
  'support.docsUrl'?: string
  'general.statusPageUrl'?: string
  'general.twitterUrl'?: string
  'general.githubUrl'?: string
}

export type Bootstrap = { settings: PublicSettings; footer: Array<{ slug: string; title: string; group: string }> }

export type PublicPlans = {
  /** free: launch mode, nothing can be bought. paid: Stripe checkout is live. */
  mode?: 'free' | 'paid'
  defaultPlan?: 'FREE' | 'PRO' | 'ENTERPRISE'
  freeModeMessage?: string
  checkoutEnabled: boolean
  trialDays: number
  plans: Array<{ plan: 'FREE' | 'PRO' | 'ENTERPRISE'; limits: Record<string, unknown> }>
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) })

    if (!res.ok) return null
    const body = (await res.json()) as { data?: T }

    return (body.data ?? null) as T | null
  } catch {
    return null
  }
}

export async function getBootstrap(): Promise<Bootstrap> {
  return (
    (await get<Bootstrap>('/public/bootstrap')) ?? {
      settings: {},
      footer: [
        { slug: 'terms', title: 'Terms of Service', group: 'legal' },
        { slug: 'privacy', title: 'Privacy Policy', group: 'legal' }
      ]
    }
  )
}

export async function getContent<T>(slug: string): Promise<PublishedContent<T> | null> {
  const live = await get<PublishedContent<T>>(`/public/content/${slug}`)

  if (live) return live
  const def = defaultEntry(slug)

  return def
    ? { slug, kind: def.kind, title: def.title, seoTitle: null, seoDescription: def.seoDescription ?? null, data: def.data as T, publishedAt: null, isDefault: true }
    : null
}

export async function getPlans(): Promise<PublicPlans | null> {
  return get<PublicPlans>('/public/plans')
}
