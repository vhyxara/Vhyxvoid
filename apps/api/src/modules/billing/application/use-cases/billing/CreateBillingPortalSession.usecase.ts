// ─────────────────────────────────────────────────────────────────────────────
// CreateBillingPortalSessionUseCase
// Called when user clicks "Manage Subscription".
// Returns the Stripe Billing Portal URL — user can change plan, cancel,
// update payment methods, download invoices, etc.
// ─────────────────────────────────────────────────────────────────────────────

import { NotFoundError } from "@/core/errors/error.format";
import { AccountBillingRepository } from "@/modules/billing/domain/repositories/PrismaBillingRepositories";
import { IStripeService } from "@/modules/billing/domain/services/Stripe.service";

export class CreateBillingPortalSessionUseCase {
  constructor(
    private readonly stripeService: IStripeService,
    private readonly accountBillingRepo: AccountBillingRepository,
  ) {}

  async execute(params: {
    accountId: string;
    returnUrl: string;
  }): Promise<{ portalUrl: string }> {
    const stripeCustomerId = await this.accountBillingRepo.getStripeCustomerId(
      params.accountId,
    );
    if (!stripeCustomerId) {
      throw new NotFoundError(
        "No billing account found. Please subscribe first.",
      );
    }

    const portalUrl = await this.stripeService.createBillingPortalSession({
      stripeCustomerId,
      returnUrl: params.returnUrl,
    });

    return { portalUrl };
  }
}
