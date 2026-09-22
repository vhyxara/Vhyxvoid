// packages/shared/src/planResolver.ts
//
// Which plan (and therefore which limits) an account is on right now. This is
// the ONE implementation of the rule; apps/api's SubscriptionPlanLimitService
// (API key creation) delegates here and apps/hub uses it for the agent limit
// and for the rate limit it caches per key. It was moved out of apps/api on
// 2026-09-22 (shared/decision.md, "S3"); the rule itself is the one decided
// 2026-09-13 (api/decision.md), unchanged:
//
//   - account missing, or its status is SUSPENDED / RESTRICTED / CANCELED /
//     DELETED  -> FREE (not entitled to a paid plan)
//   - PAST_DUE deliberately keeps the real plan (the grace period)
//   - otherwise the plan of the account's most recently created subscription,
//     whatever that subscription's own status is
//   - no subscription -> FREE
//
// NOT the same as apps/api's CheckPlanLimitsService.getLimits (FREE unless the
// subscription is active/trialing). That one has no callers that matter and is
// the non-canonical rule.
//
// Prisma-free like the rest of this package: the caller passes its own client,
// typed structurally.

import { Plan, PLAN_LIMITS, type PlanLimits } from "./planLimits";

export const NOT_ENTITLED_ACCOUNT_STATUSES: ReadonlySet<string> = new Set([
  "SUSPENDED",
  "RESTRICTED",
  "CANCELED",
  "DELETED",
]);

/** The two Prisma calls the rule needs. A PrismaClient or a transaction client both fit. */
export interface PlanPrismaLike {
  account: {
    findUnique(args: {
      where: { id: string };
      select: { status: true };
    }): Promise<{ status: string } | null>;
  };
  subscription: {
    findFirst(args: {
      where: { accountId: string };
      orderBy: { createdAt: "desc" };
      select: { plan: true };
    }): Promise<{ plan: string } | null>;
  };
}

export async function resolvePlanForAccount(
  prisma: PlanPrismaLike,
  accountId: string,
): Promise<Plan> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { status: true },
  });
  if (!account) return Plan.FREE;
  if (NOT_ENTITLED_ACCOUNT_STATUSES.has(account.status)) return Plan.FREE;

  const subscription = await prisma.subscription.findFirst({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    select: { plan: true },
  });
  if (!subscription) return Plan.FREE;

  // A plan name this code does not know (e.g. a value added to the database
  // enum before a deploy) must not become `undefined` limits.
  return subscription.plan in PLAN_LIMITS ? (subscription.plan as Plan) : Plan.FREE;
}

export async function getPlanLimitsForAccount(
  prisma: PlanPrismaLike,
  accountId: string,
): Promise<PlanLimits & { plan: Plan }> {
  const plan = await resolvePlanForAccount(prisma, accountId);
  return { plan, ...PLAN_LIMITS[plan] };
}
