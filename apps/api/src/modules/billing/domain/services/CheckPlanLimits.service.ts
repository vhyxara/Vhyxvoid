// ─────────────────────────────────────────────────────────────────────────────
// CheckPlanLimitsService
// Used by other modules (tunnel, API keys) to enforce plan limits.
// Reads the current subscription and returns the limits for the plan.
// ─────────────────────────────────────────────────────────────────────────────

import { PlanLimits, Plan, PLAN_LIMITS } from "@/modules/billing/domain/enums";
import { SubscriptionRepository } from "@/modules/billing/domain/repositories/PrismaBillingRepositories";

export class CheckPlanLimitsService {
  constructor(private readonly subscriptionRepo: SubscriptionRepository) {}

  /**
   * Get the plan limits for an account.
   * Returns FREE limits if no subscription exists.
   */
  async getLimits(accountId: string): Promise<PlanLimits & { plan: Plan }> {
    const sub = await this.subscriptionRepo.findByAccountId(accountId);
    const plan = sub?.isActive() || sub?.isTrialing() ? sub.plan : Plan.FREE;
    return { plan, ...PLAN_LIMITS[plan] };
  }

  async canAddAgent(
    accountId: string,
    currentAgentCount: number,
  ): Promise<boolean> {
    const limits = await this.getLimits(accountId);
    return currentAgentCount < limits.maxAgents;
  }

  async canAddApiKey(
    accountId: string,
    currentKeyCount: number,
  ): Promise<boolean> {
    const limits = await this.getLimits(accountId);
    return currentKeyCount < limits.maxApiKeys;
  }

  async canAddMember(
    accountId: string,
    currentMemberCount: number,
  ): Promise<boolean> {
    const limits = await this.getLimits(accountId);
    return currentMemberCount < limits.maxMembers;
  }
}
