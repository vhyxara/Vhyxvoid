// Factory for the StripeService. Stripe is optional: without
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET the API still starts (billing
// mode "free" needs neither) and every billing call answers 503.
// Prices are not configured here: they come from the admin panel's
// billing.stripePrices setting, falling back to STRIPE_*_PRICE_ID.

import { StripeServiceImpl } from "@/modules/billing/infrastructure/stripe/StripeServiceImpl";
import { ServiceUnavailableError } from "@/core/errors/error.format";
import { Plan } from "@/modules/billing/domain/enums";
import type { IStripeService } from "@/modules/billing/domain/services/Stripe.service";

const NOT_CONFIGURED = "Payments are not set up yet (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET).";

/** Stand-in used when Stripe keys are missing. */
export class UnconfiguredStripeService implements IStripeService {
  readonly configured = false;
  async createCustomer(): Promise<string> {
    throw new ServiceUnavailableError(NOT_CONFIGURED);
  }
  async createCheckoutSession(): Promise<string> {
    throw new ServiceUnavailableError(NOT_CONFIGURED);
  }
  async createBillingPortalSession(): Promise<string> {
    throw new ServiceUnavailableError(NOT_CONFIGURED);
  }
  constructWebhookEvent(): never {
    throw new ServiceUnavailableError(NOT_CONFIGURED);
  }
  async resolvePlan(): Promise<Plan> {
    return Plan.FREE;
  }
  async retrievePrice(): Promise<never> {
    throw new ServiceUnavailableError(NOT_CONFIGURED);
  }
}

export function buildStripeService(env: Record<string, string | undefined> = process.env): IStripeService {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) return new UnconfiguredStripeService();
  return new StripeServiceImpl({ secretKey, webhookSecret });
}
