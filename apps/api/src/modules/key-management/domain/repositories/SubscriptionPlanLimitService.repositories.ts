// ─────────────────────────────────────────────────────────────────────────────
// PLAN LIMIT SERVICE — looks up the account's real Subscription/flat-rate
// plan. Renamed from HardcodedPlanLimitService now that it actually does
// the lookup its old name said it didn't — see context.md risks #6/#36 and
// decision.md, 2026-09-13, "Billing model: flat-rate tiers".
//
// The resolution rule itself (SUSPENDED/RESTRICTED/CANCELED/DELETED accounts
// get FREE, PAST_DUE keeps its real plan for the grace period, otherwise the
// latest subscription's plan, none = FREE) moved to packages/shared
// (resolvePlanForAccount) on 2026-09-22 so apps/hub applies the same rule to
// its agent limit; this class only adapts it to the PlanLimitService interface.
// ─────────────────────────────────────────────────────────────────────────────

import { PlanLimitService } from "@/core/types/api-key/plans.type";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { PLAN_LIMITS, PlanLimits } from "@/modules/billing/domain/enums";
import { resolvePlanForAccount } from "@vhyxvoid/shared";

export class SubscriptionPlanLimitService implements PlanLimitService {
  constructor(private prisma: PrismaTransactionalClient) {}

  async getLimitsForAccount(accountId: string): Promise<PlanLimits> {
    return PLAN_LIMITS[await resolvePlanForAccount(this.prisma, accountId)];
  }
}
