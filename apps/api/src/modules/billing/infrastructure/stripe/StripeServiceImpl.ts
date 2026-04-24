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
} from "../../domain/services/Stripe.service";

export class StripeServiceImpl implements IStripeService {
  private readonly stripe: Stripe;

  // Price ID → Plan mapping (from environment variables)
  private readonly priceToPlан: Map<string, Plan>;

  constructor(
    private readonly config: {
      secretKey: string;
      webhookSecret: string;
      proPriceId: string;
      enterprisePriceId: string;
    },
  ) {
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: "2024-12-18.acacia",
      typescript: true,
    });

    // Map Stripe Price IDs to our Plan enum
    // These are set in your .env:
    //   STRIPE_PRO_PRICE_ID=price_xxx
    //   STRIPE_ENTERPRISE_PRICE_ID=price_yyy
    this.priceToPlан = new Map([
      [config.proPriceId, Plan.PRO],
      [config.enterprisePriceId, Plan.ENTERPRISE],
    ]);
  }

  async createCustomer(params: CreateStripeCustomerParams): Promise<string> {
    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: {
        accountId: params.accountId,
        ...params.metadata,
      },
    });
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
    });

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

  resolvePlan(stripePriceId: string): Plan {
    return this.priceToPlан.get(stripePriceId) ?? Plan.FREE;
  }
}
