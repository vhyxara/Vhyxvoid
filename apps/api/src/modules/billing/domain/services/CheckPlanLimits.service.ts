// ─────────────────────────────────────────────────────────────────────────────
// CheckPlanLimitsService
// Used by other modules (tunnel, API keys, members) to enforce plan limits.
//
// getLimits() used to have its own resolution rule (the subscription's own
// status — isActive()/isTrialing() — not the account's), which is the
// non-canonical rule the E1-E7 investigation named and the S3 session
// replaced everywhere else: it drops a PAST_DUE account straight to FREE's
// limits (a subscription that just went PAST_DUE is neither "active" nor
// "trialing"), contradicting the decided seven-day-grace policy, which keeps
// the real plan's limits until the grace period actually expires. This was
// already live — it gates POST /api-keys via apiKeyLimitGuard — so a PRO
// account's key limit silently dropped to FREE's the moment it went
// PAST_DUE. Found and fixed 2026-09-22 while wiring maxMembers (S2), because
// wiring a second caller onto a known-wrong resolver would only add a second
// live instance of the same bug. Now a thin adapter over the same canonical
// resolver SubscriptionPlanLimitService and the hub use
// (packages/shared's getPlanLimitsForAccount), not a third copy of the rule.
// See shared/decision.md, 2026-09-22, "S2".
// ─────────────────────────────────────────────────────────────────────────────

import { PlanLimits, Plan } from "@/modules/billing/domain/enums";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { getPlanLimitsForAccount } from "@vhyxvoid/shared";

export class CheckPlanLimitsService {
  constructor(private readonly prisma: PrismaTransactionalClient) {}

  /**
   * Get the plan limits for an account, by the same rule API-key creation
   * and the hub's agent/rate limits use: SUSPENDED/RESTRICTED/CANCELED/
   * DELETED accounts get FREE; PAST_DUE keeps its real plan (the grace
   * period); otherwise the plan of the most recent subscription; no
   * subscription -> FREE.
   */
  async getLimits(accountId: string): Promise<PlanLimits & { plan: Plan }> {
    return getPlanLimitsForAccount(this.prisma, accountId);
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
