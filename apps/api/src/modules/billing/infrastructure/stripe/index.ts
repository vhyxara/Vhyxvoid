// ─────────────────────────────────────────────────────────────────────────────
// src/modules/billing/infrastructure/stripe/index.ts
// Factory for the StripeService — reads from process.env.
// Call this once in your Fastify plugin setup.
// ─────────────────────────────────────────────────────────────────────────────

import { StripeServiceImpl } from "@/modules/billing/infrastructure/stripe/StripeServiceImpl";

export function buildStripeService(): StripeServiceImpl {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  const enterprisePriceId = process.env.STRIPE_ENTERPRISE_PRICE_ID;

  if (!secretKey || !webhookSecret || !proPriceId || !enterprisePriceId) {
    throw new Error(
      "Missing Stripe env vars. Required:\n" +
        "  STRIPE_SECRET_KEY\n" +
        "  STRIPE_WEBHOOK_SECRET\n" +
        "  STRIPE_PRO_PRICE_ID\n" +
        "  STRIPE_ENTERPRISE_PRICE_ID",
    );
  }

  return new StripeServiceImpl({
    secretKey,
    webhookSecret,
    proPriceId,
    enterprisePriceId,
  });
}
