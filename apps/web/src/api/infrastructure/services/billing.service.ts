import { httpClient } from '@/api/wrapper/http'
import { BILLING_ENDPOINTS } from '../endpoints/account.endpoints'

import type {
  SubscriptionResult,
  InvoicesResult,
  CreateCheckoutPayload,
  CreateCheckoutResult,
  CreatePortalPayload,
  CreatePortalResult
} from '@/api/domain/key-management/types/billing.types'

const u = (template: string, accountId: string) => template.replace(':accountId', accountId)

export const billingService = {
  /**
   * POST /organizations/:accountId/billing/checkout
   * OWNER only. Creates Stripe Checkout session.
   * Returns checkoutUrl — redirect user to this immediately.
   * Throws if account already has an active subscription.
   */
  createCheckout: (accountId: string, data: CreateCheckoutPayload): Promise<CreateCheckoutResult> =>
    httpClient({
      url: u(BILLING_ENDPOINTS.CHECKOUT, accountId),
      method: 'POST',
      data
    }),

  /**
   * POST /organizations/:accountId/billing/portal
   * OWNER only. Creates Stripe Billing Portal session.
   * Returns portalUrl — redirect user to this to manage subscription.
   * Throws 404 if no Stripe customer exists (user hasn't subscribed yet).
   */
  createPortal: (accountId: string, data: CreatePortalPayload): Promise<CreatePortalResult> =>
    httpClient({
      url: u(BILLING_ENDPOINTS.PORTAL, accountId),
      method: 'POST',
      data
    }),

  /**
   * GET /organizations/:accountId/billing/subscription
   * MEMBER+. Returns current plan and subscription status.
   * Returns null subscription if on FREE plan.
   */
  getSubscription: (accountId: string): Promise<SubscriptionResult> =>
    httpClient({
      url: u(BILLING_ENDPOINTS.SUBSCRIPTION, accountId),
      method: 'GET'
    }),

  /**
   * GET /organizations/:accountId/billing/invoices
   * OWNER only. Returns billing history.
   */
  getInvoices: (accountId: string): Promise<InvoicesResult> =>
    httpClient({
      url: u(BILLING_ENDPOINTS.INVOICES, accountId),
      method: 'GET'
    })
}
