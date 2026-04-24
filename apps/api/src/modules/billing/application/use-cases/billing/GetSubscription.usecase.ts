// ─────────────────────────────────────────────────────────────────────────────
// GetSubscriptionUseCase
// Returns the current subscription for an account.
// Called by dashboard to show current plan, next billing date, etc.
// ─────────────────────────────────────────────────────────────────────────────

import { SubscriptionStatus } from "@/generated/prisma";
import { Plan } from "@/modules/billing/domain/enums";
import { SubscriptionRepository } from "@/modules/billing/domain/repositories/PrismaBillingRepositories";

export class GetSubscriptionUseCase {
  constructor(private readonly subscriptionRepo: SubscriptionRepository) {}

  async execute(accountId: string): Promise<{
    plan: Plan;
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    trialEndsAt: Date | null;
  } | null> {
    const sub = await this.subscriptionRepo.findByAccountId(accountId);
    if (!sub) return null;

    return {
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      trialEndsAt: sub.trialEndsAt,
    };
  }
}
