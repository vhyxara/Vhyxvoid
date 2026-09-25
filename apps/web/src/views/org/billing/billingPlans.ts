// Plans offered in the upgrade dialog. No imports on purpose: a root test
// (tests/e2e/billingPlansMatchLimits.test.ts) checks these numbers against
// packages/shared's PLAN_LIMITS, so the dialog can't promise limits the API
// doesn't apply (it used to say "5 team members" and "50 active tunnels").
// Prices are display labels; the charge comes from the Stripe price ID.

export type UpgradePlan = {
  id: 'pro' | 'enterprise'
  label: string
  price: string
  priceId: string
  limits: { maxAgents: number; maxMembers: number; maxApiKeys: number; publicPathRateLimitPerMinute: number }
  extras: string[]
}

const fmt = (n: number, noun: string) => (Number.isFinite(n) ? `${n.toLocaleString('en-US')} ${noun}` : `Unlimited ${noun}`)

export const UPGRADE_PLANS: UpgradePlan[] = [
  {
    id: 'pro',
    label: 'Pro',
    price: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_LABEL ?? '$29 / month',
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ?? 'price_pro',
    limits: { maxAgents: 5, maxMembers: 10, maxApiKeys: 20, publicPathRateLimitPerMinute: 3_000 },
    extras: ['PROD keys and key rotation', 'Priority support']
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    price: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_LABEL ?? '$99 / month',
    priceId: process.env.NEXT_PUBLIC_STRIPE_ENTERPRISE_PRICE_ID ?? 'price_enterprise',
    limits: { maxAgents: Infinity, maxMembers: Infinity, maxApiKeys: Infinity, publicPathRateLimitPerMinute: Infinity },
    extras: ['PROD keys and key rotation', 'Priority support']
  }
]

/** Feature bullets; `personal` leaves out team members (a personal workspace has none). */
export function planFeatures(plan: UpgradePlan, personal = false): string[] {
  const l = plan.limits
  return [
    fmt(l.maxAgents, 'connected agents'),
    ...(personal ? [] : [fmt(l.maxMembers, 'team members')]),
    fmt(l.maxApiKeys, 'API keys'),
    Number.isFinite(l.publicPathRateLimitPerMinute)
      ? `${l.publicPathRateLimitPerMinute.toLocaleString('en-US')} tunnel requests / minute`
      : 'No tunnel rate limit',
    ...plan.extras
  ]
}
