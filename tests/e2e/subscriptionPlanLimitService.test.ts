import { describe, it, expect, vi } from "vitest";
import { SubscriptionPlanLimitService } from "../../apps/api/src/modules/key-management/domain/repositories/SubscriptionPlanLimitService.repositories";
import { PLAN_LIMITS, Plan } from "../../apps/api/src/modules/billing/domain/enums";

// Covers context.md risks #6/#36: HardcodedPlanLimitService.getLimitsForAccount()
// always returned PRO for every account regardless of what they'd actually
// subscribed to. Renamed to SubscriptionPlanLimitService and now does a real
// lookup. See decision.md, 2026-09-13, "Billing model: flat-rate tiers" for
// the flat-rate decision and the PAST_DUE-keeps-plan / SUSPENDED-downgrades-
// to-FREE edge-case handling this test file locks in.

function makePrisma(opts: {
  accountStatus?: string | null; // null = account not found
  subscriptionPlan?: string | null; // null = no Subscription row
}) {
  return {
    account: {
      findUnique: vi.fn().mockResolvedValue(
        opts.accountStatus === null ? null : { status: opts.accountStatus ?? "ACTIVE" },
      ),
    },
    subscription: {
      findFirst: vi.fn().mockResolvedValue(
        opts.subscriptionPlan == null ? null : { plan: opts.subscriptionPlan },
      ),
    },
  };
}

describe("SubscriptionPlanLimitService.getLimitsForAccount", () => {
  it("returns FREE limits for a FREE-plan account", async () => {
    const prisma = makePrisma({ accountStatus: "ACTIVE", subscriptionPlan: "FREE" });
    const service = new SubscriptionPlanLimitService(prisma as any);

    const limits = await service.getLimitsForAccount("acct_1");
    expect(limits).toBe(PLAN_LIMITS[Plan.FREE]);
  });

  it("returns PRO limits for a PRO-plan account", async () => {
    const prisma = makePrisma({ accountStatus: "ACTIVE", subscriptionPlan: "PRO" });
    const service = new SubscriptionPlanLimitService(prisma as any);

    const limits = await service.getLimitsForAccount("acct_1");
    expect(limits).toBe(PLAN_LIMITS[Plan.PRO]);
  });

  it("returns ENTERPRISE limits for an ENTERPRISE-plan account", async () => {
    const prisma = makePrisma({ accountStatus: "ACTIVE", subscriptionPlan: "ENTERPRISE" });
    const service = new SubscriptionPlanLimitService(prisma as any);

    const limits = await service.getLimitsForAccount("acct_1");
    expect(limits).toBe(PLAN_LIMITS[Plan.ENTERPRISE]);
  });

  it("uses the most recently created Subscription row when more than one exists", async () => {
    const prisma = makePrisma({ accountStatus: "ACTIVE", subscriptionPlan: "PRO" });
    const service = new SubscriptionPlanLimitService(prisma as any);

    await service.getLimitsForAccount("acct_1");

    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
  });

  it("defaults to FREE when the account has no Subscription row at all (brand-new signup)", async () => {
    const prisma = makePrisma({ accountStatus: "ACTIVE", subscriptionPlan: null });
    const service = new SubscriptionPlanLimitService(prisma as any);

    const limits = await service.getLimitsForAccount("acct_1");
    expect(limits).toBe(PLAN_LIMITS[Plan.FREE]);
  });

  it("keeps the real plan's limits during PAST_DUE (grace period)", async () => {
    const prisma = makePrisma({ accountStatus: "PAST_DUE", subscriptionPlan: "PRO" });
    const service = new SubscriptionPlanLimitService(prisma as any);

    const limits = await service.getLimitsForAccount("acct_1");
    expect(limits).toBe(PLAN_LIMITS[Plan.PRO]);
  });

  it.each(["SUSPENDED", "RESTRICTED", "CANCELED", "DELETED"])(
    "downgrades to FREE limits when account status is %s, even on a PRO subscription",
    async (status) => {
      const prisma = makePrisma({ accountStatus: status, subscriptionPlan: "PRO" });
      const service = new SubscriptionPlanLimitService(prisma as any);

      const limits = await service.getLimitsForAccount("acct_1");
      expect(limits).toBe(PLAN_LIMITS[Plan.FREE]);
      // Downgraded accounts shouldn't even need the subscription lookup.
      expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    },
  );

  it("defaults to FREE if the account row itself can't be found (data-integrity fallback)", async () => {
    const prisma = makePrisma({ accountStatus: null, subscriptionPlan: "PRO" });
    const service = new SubscriptionPlanLimitService(prisma as any);

    const limits = await service.getLimitsForAccount("acct_missing");
    expect(limits).toBe(PLAN_LIMITS[Plan.FREE]);
  });
});
