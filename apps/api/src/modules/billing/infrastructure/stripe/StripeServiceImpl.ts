// src/modules/billing/infrastructure/stripe/StripeServiceImpl.ts
// Concrete implementation of IStripeService using the Stripe Node.js SDK.
// This is the ONLY file in the billing module that imports from 'stripe'.

import Stripe from "stripe";
import { Plan } from "@/modules/billing/domain/enums";
import {
  IStripeService,
  CreateStripeCustomerParams,
  CreateCheckoutSessionParams,
  CreateBillingPortalParams,
  StripeWebhookEvent,
  StripePriceInfo,
} from "../../domain/services/Stripe.service";
import { currentStripePrices } from "@vhyxvoid/shared";

export class StripeServiceImpl implements IStripeService {
  private readonly stripe: ReturnType<typeof Stripe>;

  readonly configured = true;

  constructor(
    private readonly config: {
      secretKey: string;
      webhookSecret: string;
    },
  ) {
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: "2026-03-25.dahlia",
      typescript: true,
    });
  }

  async createCustomer(params: CreateStripeCustomerParams): Promise<string> {
    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: {
        accountId: params.accountId,
        ...params.metadata,
      },
    }, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);
    return customer.id;
  }

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      customer: params.stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      ...(params.trialDays
        ? {
            subscription_data: {
              trial_period_days: params.trialDays,
              metadata: { accountId: params.accountId, ...params.metadata },
            },
          }
        : {
            subscription_data: {
              metadata: { accountId: params.accountId, ...params.metadata },
            },
          }),
      metadata: { accountId: params.accountId, ...params.metadata },
      allow_promotion_codes: true,
      billing_address_collection: "required",
    }, params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined);

    if (!session.url) {
      throw new Error("Stripe did not return a session URL");
    }

    return session.url;
  }

  async createBillingPortalSession(
    params: CreateBillingPortalParams,
  ): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.stripeCustomerId,
      return_url: params.returnUrl,
    });
    return session.url;
  }

  constructWebhookEvent(
    payload: Buffer,
    signature: string,
  ): StripeWebhookEvent {
    // This throws if the signature is invalid — Stripe verifies the webhook came from Stripe
    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.config.webhookSecret,
    );
    return event as unknown as StripeWebhookEvent;
  }

  async resolvePlan(stripePriceId: string): Promise<Plan> {
    const prices = await currentStripePrices();
    if (prices.PRO === stripePriceId) return Plan.PRO;
    if (prices.ENTERPRISE === stripePriceId) return Plan.ENTERPRISE;
    return Plan.FREE;
  }

  async retrievePrice(priceId: string): Promise<StripePriceInfo> {
    const price = await this.stripe.prices.retrieve(priceId, { expand: ["product"] });
    const product = price.product as { name?: string } | string | null;
    return {
      id: price.id,
      active: price.active,
      unitAmount: price.unit_amount,
      currency: price.currency,
      interval: price.recurring?.interval ?? null,
      productName: typeof product === "object" && product ? product.name ?? null : null,
    };
  }
}
