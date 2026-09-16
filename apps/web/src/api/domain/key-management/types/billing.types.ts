export type SubscriptionInfo = {
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  trialStartsAt: string | null
  trialEndsAt: string | null
}

export type BillingResult = {
  accountId: string
  plan: string
  status: string
  accountStatus: string
  graceEndsAt: string | null
  subscription: SubscriptionInfo | null
  invoices: Invoice[]
}

export type Plan = 'FREE' | 'PRO' | 'ENTERPRISE'
export type SubscriptionStatus = 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE'
export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'UNCOLLECTIBLE' | 'VOID'

export type Subscription = {
  plan: Plan
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  trialEndsAt: string | null
}

export type SubscriptionResult = {
  accountId: string
  subscription: Subscription | null
}

export type Invoice = {
  id: string
  amountDue: number
  amountPaid: number
  currency: string
  status: InvoiceStatus
  invoicePdfUrl: string | null
  hostedInvoiceUrl: string | null
  paidAt: string | null
  periodStart: string | null
  periodEnd: string | null
}

export type InvoicesResult = {
  accountId: string
  invoices: Invoice[]
}

// ── Mutation payloads ──────────────────────────────────────────────────────

export type CreateCheckoutPayload = {
  priceId: string
  successUrl: string
  cancelUrl: string
  trialDays?: number
}

export type CreateCheckoutResult = {
  checkoutUrl: string
}

export type CreatePortalPayload = {
  returnUrl: string
}

export type CreatePortalResult = {
  portalUrl: string
}
