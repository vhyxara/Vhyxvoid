'use client'

import { useQuery } from '@tanstack/react-query'

import { httpClient } from '@/api/wrapper/http'

// Admin-controlled, public data the dashboard reacts to: announcement
// banner, maintenance mode, feature switches, plan limits. Cached for a
// minute; failures are silent (the dashboard works without it).

export type PublicBootstrap = {
  settings: Record<string, unknown>
  footer: Array<{ slug: string; title: string; group: string }>
}

export type PublicPlans = {
  /** free: launch mode, nothing can be bought. paid: Stripe checkout is live. */
  mode?: 'free' | 'paid'
  defaultPlan?: 'FREE' | 'PRO' | 'ENTERPRISE'
  freeModeMessage?: string
  checkoutEnabled: boolean
  trialDays: number
  plans: Array<{ plan: 'FREE' | 'PRO' | 'ENTERPRISE'; limits: Record<string, unknown> }>
}

export function usePublicBootstrap() {
  return useQuery({
    queryKey: ['public', 'bootstrap'],
    queryFn: () => httpClient<PublicBootstrap>({ url: '/public/bootstrap', method: 'GET', isPublic: true }),
    staleTime: 60_000,
    refetchInterval: 120_000,
    meta: { silent: true }
  })
}

export function usePublicPlans() {
  return useQuery({
    queryKey: ['public', 'plans'],
    queryFn: () => httpClient<PublicPlans>({ url: '/public/plans', method: 'GET', isPublic: true }),
    staleTime: 60_000,
    meta: { silent: true }
  })
}

/** A typed accessor with a default. */
export function setting<T>(data: PublicBootstrap | undefined, key: string, fallback: T): T {
  const v = data?.settings?.[key]

  return (v === undefined || v === null ? fallback : v) as T
}
