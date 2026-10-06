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
  idempotencyKey?: string;
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
  idempotencyKey?: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  created: number;
}

export interface StripePriceInfo {
  id: string;
  active: boolean;
  unitAmount: number | null;
  currency: string;
  interval: string | null;
  productName: string | null;
}

export interface IStripeService {
  /** False when STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are not set. */
  readonly configured: boolean;

  createCustomer(params: CreateStripeCustomerParams): Promise<string>;

  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<string>;

  createBillingPortalSession(
    params: CreateBillingPortalParams,
  ): Promise<string>;

  constructWebhookEvent(payload: Buffer, signature: string): StripeWebhookEvent;

  /** Which plan a Stripe price buys (admin setting, then env). Unknown -> FREE. */
  resolvePlan(stripePriceId: string): Promise<Plan>;

  /** Look a price up in Stripe (admin panel's price check). */
  retrievePrice(priceId: string): Promise<StripePriceInfo>;
}
