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

    // 2. Get or create Stripe customer
    let stripeCustomerId = await this.accountBillingRepo.getStripeCustomerId(
      params.accountId,
    );
    if (!stripeCustomerId) {
      stripeCustomerId = await this.stripeService.createCustomer({
        email: params.userEmail,
        name: params.accountName,
        accountId: params.accountId,
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
      trialDays: params.trialDays,
      metadata: { accountId: params.accountId },
    });

    return { checkoutUrl };
  }
}
