// ─────────────────────────────────────────────────────────────────────────────
// PLAN LIMIT SERVICE — looks up the account's real Subscription/flat-rate
// plan. Renamed from HardcodedPlanLimitService now that it actually does
// the lookup its old name said it didn't — see context.md risks #6/#36 and
// decision.md, 2026-09-13, "Billing model: flat-rate tiers".
// ─────────────────────────────────────────────────────────────────────────────

import { PlanLimitService } from "@/core/types/api-key/plans.type";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { PLAN_LIMITS, Plan, PlanLimits } from "@/modules/billing/domain/enums";

// Account statuses that mean "not currently entitled to a paid plan's
// limits," regardless of what Subscription.plan says. PAST_DUE is
// deliberately excluded — that's the grace-period window (see
// GracePeriodWorker/GRACE_PERIOD_MS): the account keeps its real plan's
// limits until the grace period actually expires, at which point the
// account-status webhook/worker flow already flips it to SUSPENDED, which
// this list does catch.
const NOT_ENTITLED_STATUSES = new Set(["SUSPENDED", "RESTRICTED", "CANCELED", "DELETED"]);

export class SubscriptionPlanLimitService implements PlanLimitService {
  constructor(private prisma: PrismaTransactionalClient) {}

  async getLimitsForAccount(accountId: string): Promise<PlanLimits> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { status: true },
    });

    // Data-integrity edge case, not expected in practice (accountId always
    // comes from an authenticated actor's own membership) — fail to the
    // most restrictive tier rather than throwing and blocking the request.
    if (!account) {
      return PLAN_LIMITS[Plan.FREE];
    }

    if (NOT_ENTITLED_STATUSES.has(account.status)) {
      return PLAN_LIMITS[Plan.FREE];
    }

    // ACTIVE or PAST_DUE (grace period) both get the account's real plan.
    // Most recent Subscription row wins — same "most recent" convention
    // PrismaSubscriptionRepository.findByAccountId already uses for the
    // billing dashboard's "current subscription" display, since an
    // account can accumulate more than one Subscription row over time
    // (accountId is not unique on this table).
    const subscription = await this.prisma.subscription.findFirst({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      select: { plan: true },
    });

    // No Subscription row at all — a brand-new account before ever going
    // through Stripe checkout. Confirmed via account/organization creation
    // (CreateOrganization.usecase.ts) never creates one, and a Subscription
    // row is only ever created by the Stripe webhook's
    // customer.subscription.created handler — so "no subscription" means
    // "still on the free tier," not an error.
    if (!subscription) {
      return PLAN_LIMITS[Plan.FREE];
    }

    return PLAN_LIMITS[subscription.plan as Plan];
  }
}
