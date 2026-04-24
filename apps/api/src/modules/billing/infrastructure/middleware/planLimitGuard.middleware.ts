// ─────────────────────────────────────────────────────────────────────────────
// src/modules/billing/infrastructure/middleware/planLimitGuard.ts
//
// Fastify middleware that checks plan limits before executing a route.
// Use this in routes that have per-plan limits.
//
// Usage:
//   fastify.post('/api-keys', {
//     onRequest: [fastify.userAuthGuard, planLimitGuard('apiKeys')],
//   }, handler)
// ─────────────────────────────────────────────────────────────────────────────

import {
  ForbiddenError,
  PlanLimitExceededError,
} from "@/core/errors/error.format";
import { FastifyRequest, FastifyReply } from "fastify";

export type PlanLimitKey = "maxAgents" | "maxApiKeys" | "maxMembers";

/**
 * Build a plan limit guard for a specific limit key.
 * The guard reads the current subscription from the DB and checks the limit.
 *
 * @param limitKey - which limit to check
 * @param getCurrentCount - function to get the current count for this account
 */
export function buildPlanLimitGuard(
  limitKey: PlanLimitKey,
  getCurrentCount: (accountId: string) => Promise<number>,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = (request.params as any).accountId;
    if (!accountId) return; // guard only applies to account-scoped routes

    const checkPlanLimits = (request.server as any).checkPlanLimitsService;
    if (!checkPlanLimits) return; // plugin not registered — skip

    const limits = await checkPlanLimits.getLimits(accountId);
    const currentCount = await getCurrentCount(accountId);
    const maxAllowed = limits[limitKey];

    if (currentCount >= maxAllowed) {
      throw new PlanLimitExceededError({
        limit: maxAllowed,
        current: currentCount,
        limitKey,
        plan: limits.plan,
      });
      // return reply.code(402).send({
      //   error: "Plan limit reached",
      //   limit: maxAllowed,
      //   current: currentCount,
      //   limitKey,
      //   plan: limits.plan,
      //   upgradeUrl: "/billing/upgrade",
      //   message: `Your ${limits.plan} plan allows up to ${maxAllowed === Infinity ? "unlimited" : maxAllowed} ${limitKey.replace("max", "").toLowerCase()}. Please upgrade to add more.`,
      // });
    }
  };
}
