// ─────────────────────────────────────────────────────────────────────────────
// CreateCheckoutSessionUseCase
// Called when user clicks "Upgrade to Pro".
// Creates a Stripe customer if none exists, then creates a Checkout session.
// Returns the Stripe-hosted URL to redirect the user to.
// ─────────────────────────────────────────────────────────────────────────────

import { ForbiddenError } from "@/core/errors/error.format";
import {
  AccountBillingRepository,
  SubscriptionRepository,
} from "@/modules/billing/domain/repositories/PrismaBillingRepositories";
// import {
//   SubscriptionRepository,
//   AccountBillingRepository,
// } from "@/modules/billing/domain/repositories";
import { IStripeService } from "@/modules/billing/domain/services/Stripe.service";

export class CreateCheckoutSessionUseCase {
  constructor(
    private readonly stripeService: IStripeService,
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly accountBillingRepo: AccountBillingRepository,
  ) {}

  async execute(params: {
    accountId: string;
    accountName: string;
    userEmail: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
  }): Promise<{ checkoutUrl: string }> {
    // 1. Check if already subscribed to an active plan
    const existing = await this.subscriptionRepo.findByAccountId(
      params.accountId,
    );
    if (existing?.isActive() || existing?.isTrialing()) {
      throw new ForbiddenError(
        "Account already has an active subscription. Use the billing portal to make changes.",
      );
    }
    // A failed payment is fixed in the portal; a second subscription would
    // double-bill (audit M16).
    if (existing?.isPastDue() || existing?.status === "UNPAID") {
      throw new ForbiddenError(
        "This account has an unpaid subscription. Update the payment method in the billing portal.",
      );
    }
    // Trials are for an account's first subscription only (audit M16).
    const trialDays = existing ? 0 : (params.trialDays ?? 0);

    // 2. Get or create Stripe customer
    let stripeCustomerId = await this.accountBillingRepo.getStripeCustomerId(
      params.accountId,
    );
    if (!stripeCustomerId) {
      stripeCustomerId = await this.stripeService.createCustomer({
        email: params.userEmail,
        name: params.accountName,
        accountId: params.accountId,
        // Two concurrent checkouts create one customer, not two.
        idempotencyKey: `customer:${params.accountId}`,
      });
      await this.accountBillingRepo.setStripeCustomerId(
        params.accountId,
        stripeCustomerId,
      );
    }

    // 3. Create Stripe Checkout session
    const checkoutUrl = await this.stripeService.createCheckoutSession({
      stripeCustomerId,
      accountId: params.accountId,
      priceId: params.priceId,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      trialDays,
      metadata: { accountId: params.accountId },
      // The same request repeated within a minute (double click, retry)
      // returns the same session instead of opening a second one.
      idempotencyKey: `checkout:${params.accountId}:${params.priceId}:${Math.floor(Date.now() / 60_000)}`,
    });

    return { checkoutUrl };
  }
}
