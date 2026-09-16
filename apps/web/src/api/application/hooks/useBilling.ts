import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { billingKeys } from '@/api/infrastructure/query-keys/api-key.keys'
import { billingService } from '@/api/infrastructure/services/billing.service'

import type { CreateCheckoutPayload, CreatePortalPayload } from '@/api/domain/key-management/types/billing.types'
import { useBootstrapReady } from './useBootstrapSession'

/**
 * Current subscription — plan, status, trial, period end.
 * Available to all members. Returns null subscription on FREE plan.
 */
export function useSubscription(accountId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: billingKeys.subscription(accountId),
    queryFn: () => billingService.getSubscription(accountId),
    enabled: ready && !!accountId,
    staleTime: 5 * 60_000
  })
}

/**
 * Invoice history — OWNER only.
 * Gated on the frontend by RequireRole accountId minLevel OWNER.
 */
export function useInvoices(accountId: string) {
  const ready = useBootstrapReady()

  return useQuery({
    queryKey: billingKeys.invoices(accountId),
    queryFn: () => billingService.getInvoices(accountId),
    enabled: ready && !!accountId,
    staleTime: 5 * 60_000
  })
}

/**
 * Create Stripe Checkout session → redirect to checkoutUrl.
 * OWNER only. Throws if account already has an active subscription.
 *
 * Usage:
 *   const checkout = useCreateCheckout(accountId)
 *   checkout.mutate({ priceId, successUrl, cancelUrl }, {
 *     onSuccess: ({ checkoutUrl }) => window.location.href = checkoutUrl
 *   })
 */
export function useCreateCheckout(accountId: string) {
  return useMutation({
    mutationFn: (data: CreateCheckoutPayload) => billingService.createCheckout(accountId, data)

    // No cache invalidation needed — subscription only changes
    // after Stripe webhook fires, not immediately on checkout creation
  })
}

/**
 * Create Stripe Billing Portal session → redirect to portalUrl.
 * OWNER only. Throws 404 if no Stripe customer exists yet.
 *
 * Usage:
 *   const portal = useCreatePortal(accountId)
 *   portal.mutate({ returnUrl }, {
 *     onSuccess: ({ portalUrl }) => window.location.href = portalUrl
 *   })
 */
export function useCreatePortal(accountId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreatePortalPayload) => billingService.createPortal(accountId, data),
    onSuccess: () => {
      // User is going to Stripe portal — invalidate subscription on return
      // so the dashboard reflects any plan changes they make there
      queryClient.invalidateQueries({ queryKey: billingKeys.all(accountId) })
    }
  })
}
