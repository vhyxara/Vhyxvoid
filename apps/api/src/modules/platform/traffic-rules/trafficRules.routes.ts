// /api/v1/traffic-rules — a workspace's traffic rules, per tunnel label.
//
//   GET    /:accountId               every tunnel's rules, plan limit, live tunnels
//   PUT    /:accountId/:label        { rules, expectedVersion? } replace the ordered list (owners/admins)
//   DELETE /:accountId/:label        remove all rules of a tunnel (owners/admins)
//   POST   /:accountId/:label/test   { method, path, headers?, online? } what the rules would do (members)
//
// Rules are checked and evaluated by packages/shared/src/trafficRules.ts,
// the same code the hub runs. A save tells the hub at once (the access-rule
// invalidation call also drops cached traffic rules).
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ConflictError, ForbiddenError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  TRAFFIC_RULE_METHODS,
  currentPlanOverrides,
  describeTrafficRule,
  evaluateTrafficRules,
  getEffectivePlanLimitsForAccount,
  normalizeTrafficRules,
  trafficRulesProblem,
  type TrafficRule,
} from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import type { HubClient } from "../shared/hubClient";

const params = z.object({ accountId: z.string().uuid() });
const labelParams = params.extend({ label: z.string().min(1).max(63).regex(/^[A-Za-z0-9._-]+$/, "Invalid tunnel label") });
const putBody = z.object({
  rules: z.array(z.record(z.string(), z.unknown())).max(500),
  /** The version the editor loaded; a newer save in between is refused (409). */
  expectedVersion: z.number().int().min(0).optional(),
});
const testBody = z.object({
  method: z.enum(TRAFFIC_RULE_METHODS).default("GET"),
  path: z.string().min(1).max(2000).regex(/^\//, "The path must start with /"),
  headers: z.record(z.string(), z.string()).default({}),
  online: z.boolean().default(true),
});

/** Gives rules without an id one, so API callers need not invent ids. */
function withIds(rules: Array<Record<string, unknown>>): unknown[] {
  return rules.map((r) => (typeof r.id === "string" && r.id ? r : { ...r, id: `r_${randomBytes(6).toString("hex")}` }));
}

export async function trafficRuleRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);

  async function role(request: FastifyRequest, accountId: string): Promise<number> {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return m.roleLevel;
  }

  async function limits(accountId: string) {
    const [enabled, l] = await Promise.all([
      fastify.platformSettings.get("features.trafficRules"),
      getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides()),
    ]);
    const max = Number.isFinite(l.maxTrafficRules) ? Math.max(0, Math.floor(l.maxTrafficRules)) : 200;
    return { enabled: Boolean(enabled), maxRules: max, plan: l.plan };
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const level = await role(request, accountId);
    const [rows, lim, live] = await Promise.all([
      prisma.tunnelRuleSet.findMany({ where: { accountId }, orderBy: { label: "asc" } }),
      limits(accountId),
      opts.hub.configured ? opts.hub.agents(accountId).catch(() => []) : Promise.resolve([]),
    ]);
    return successResponse(reply, "Success", 200, {
      enabled: lim.enabled,
      maxRules: lim.maxRules,
      canManage: level >= RoleLevel.ADMIN,
      liveLabels: [...new Set(live.map((a) => a.label))].sort(),
      tunnels: rows.map((r) => {
        const rules = (Array.isArray(r.rules) ? r.rules : []) as unknown as TrafficRule[];
        return { label: r.label, version: r.version, updatedAt: r.updatedAt, rules: rules.map((x) => ({ ...x, summary: describeTrafficRule(x) })) };
      }),
    });
  });

  fastify.put("/:accountId/:label", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    const body = putBody.parse(request.body ?? {});
    if ((await role(request, accountId)) < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can change traffic rules");
    const lim = await limits(accountId);
    const rules = withIds(body.rules);
    if (rules.length > lim.maxRules) {
      throw new PlanLimitExceededError({ limit: lim.maxRules, current: rules.length, limitKey: "maxTrafficRules", plan: lim.plan });
    }
    const problem = trafficRulesProblem(rules, lim.maxRules);
    if (problem) throw new ValidationError(problem);
    const clean = normalizeTrafficRules(rules as TrafficRule[]);
    const user = getUserContext(request);

    const existing = await prisma.tunnelRuleSet.findUnique({ where: { accountId_label: { accountId, label } } });
    if (body.expectedVersion !== undefined && (existing?.version ?? 0) !== body.expectedVersion) {
      throw new ConflictError("Someone changed this tunnel's rules after you opened them. Reload to see their version, then make your change again.");
    }

    let version = 0;
    if (clean.length === 0) {
      if (existing) await prisma.tunnelRuleSet.delete({ where: { id: existing.id } });
    } else if (existing) {
      // The version check and the write are one statement, so two saves cannot both win.
      const res = await prisma.tunnelRuleSet.updateMany({
        where: { id: existing.id, version: existing.version },
        data: { rules: clean as unknown as object, version: { increment: 1 }, updatedById: user.id },
      });
      if (res.count === 0) throw new ConflictError("Someone changed this tunnel's rules at the same moment. Reload and try again.");
      version = existing.version + 1;
    } else {
      const created = await prisma.tunnelRuleSet.create({ data: { accountId, label, rules: clean as unknown as object, updatedById: user.id } });
      version = created.version;
    }
    await opts.hub.invalidatePolicy(accountId, label);
    return successResponse(reply, clean.length ? "Rules saved" : "Rules removed", 200, {
      label,
      version,
      rules: clean.map((x) => ({ ...x, summary: describeTrafficRule(x) })),
      ...(lim.enabled ? {} : { warning: "Traffic rules are switched off on this platform right now; they apply once an operator turns them on." }),
    });
  });

  fastify.delete("/:accountId/:label", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    if ((await role(request, accountId)) < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can change traffic rules");
    await prisma.tunnelRuleSet.deleteMany({ where: { accountId, label } });
    await opts.hub.invalidatePolicy(accountId, label);
    return successResponse(reply, "Rules removed", 200, { label });
  });

  fastify.post("/:accountId/:label/test", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    const body = testBody.parse(request.body ?? {});
    await role(request, accountId);
    // Unsaved rules can be tested too: the editor sends what is on screen.
    const draft = (request.body as { rules?: unknown })?.rules;
    let rules: TrafficRule[];
    if (Array.isArray(draft)) {
      const withId = withIds(draft as Array<Record<string, unknown>>);
      const problem = trafficRulesProblem(withId, 500);
      if (problem) throw new ValidationError(problem);
      rules = withId as TrafficRule[];
    } else {
      const row = await prisma.tunnelRuleSet.findUnique({ where: { accountId_label: { accountId, label } } });
      rules = (Array.isArray(row?.rules) ? row.rules : []) as unknown as TrafficRule[];
    }
    const headers = Object.fromEntries(Object.entries(body.headers).map(([k, v]) => [k.toLowerCase(), v]));
    // Deterministic for "fail" rules: a test shows the failing branch.
    const plan = evaluateTrafficRules(rules, { method: body.method, path: body.path, headers }, { online: body.online, random: () => 0 });
    return successResponse(reply, "Success", 200, plan);
  });
}
