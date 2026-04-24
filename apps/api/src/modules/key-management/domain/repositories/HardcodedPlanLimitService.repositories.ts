// ─────────────────────────────────────────────────────────────────────────────
// PLAN LIMIT SERVICE — hardcoded now, Stripe-ready interface
// ─────────────────────────────────────────────────────────────────────────────

import { PlanLimitService } from "@/core/types/api-key/plans.type";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { PLAN_LIMITS, PlanLimits } from "@/modules/billing/domain/enums";

export class HardcodedPlanLimitService implements PlanLimitService {
  constructor(private prisma: PrismaTransactionalClient) {}

  async getLimitsForAccount(accountId: string): Promise<PlanLimits> {
    // TODO: replace with Subscription lookup when billing is built
    // const subscription = await this.prisma.subscription.findFirst({
    //   where: { accountId, status: 'ACTIVE' },
    //   include: { plan: true },
    // });
    // return PLAN_LIMITS[subscription.plan.tier];

    // For now: all accounts get PRO limits
    // In production: fetch from subscription table
    return PLAN_LIMITS["PRO"];
  }
}
