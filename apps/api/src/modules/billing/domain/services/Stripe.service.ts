// ─────────────────────────────────────────────────────────────────────────────
// src/modules/billing/domain/services/StripeService.ts
// Abstract interface for Stripe operations.
// The concrete implementation lives in infrastructure/stripe/StripeService.ts.
// Use cases depend on this interface — not on the Stripe SDK directly.
// ─────────────────────────────────────────────────────────────────────────────

import { Plan } from "@/modules/billing/domain/enums";

export interface CreateCheckoutSessionParams {
  stripeCustomerId: string;
  accountId: string;
  priceId: string; // Stripe Price ID from your dashboard
  successUrl: string; // redirect after successful payment
  cancelUrl: string; // redirect if user cancels
  trialDays?: number; // optional trial period
  metadata?: Record<string, string>;
}

export interface CreateBillingPortalParams {
  stripeCustomerId: string;
  returnUrl: string; // where to send user after portal session
}

export interface CreateStripeCustomerParams {
  email: string;
  name: string;
  accountId: string; // stored in Stripe customer metadata
  metadata?: Record<string, string>;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  created: number;
}

export interface IStripeService {
  /**
   * Create or retrieve a Stripe customer for an account.
   * Returns the stripeCustomerId.
   */
  createCustomer(params: CreateStripeCustomerParams): Promise<string>;

  /**
   * Create a Stripe Checkout session URL.
   * Redirect the user to this URL to complete payment.
   */
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<string>;

  /**
   * Create a Stripe Billing Portal session URL.
   * Redirect the user to manage their subscription, payment methods, etc.
   */
  createBillingPortalSession(
    params: CreateBillingPortalParams,
  ): Promise<string>;

  /**
   * Verify and parse a Stripe webhook signature.
   * Throws if the signature is invalid — never process unverified events.
   */
  constructWebhookEvent(payload: Buffer, signature: string): StripeWebhookEvent;

  /**
   * Resolve which Plan corresponds to a Stripe Price ID.
   * This mapping lives in env config (STRIPE_PRO_PRICE_ID etc.)
   */
  resolvePlan(stripePriceId: string): Plan;
}
