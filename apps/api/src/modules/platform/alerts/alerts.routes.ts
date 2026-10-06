// /api/v1/alerts — an account's alert rules and their history.
//
//   GET    /:accountId              rules (with what is firing), recent events, limits
//   POST   /:accountId              create (owners/admins; plan maxAlertRules)
//   PATCH  /:accountId/:id          change (owners/admins)
//   DELETE /:accountId/:id          remove (owners/admins)
//   POST   /:accountId/:id/test     send a test notification on every channel (owners/admins)
//   GET    /:accountId/events       history (?ruleId=)
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { ALERT_BOUNDS, ALERT_TYPES, currentPlanOverrides, describeAlertRule, getEffectivePlanLimitsForAccount } from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import type { AlertRuleRow, AlertService } from "./alerts.service";
import { validateWebhookUrl } from "./webhook";

const params = z.object({ accountId: z.string().uuid() });
const idParams = params.extend({ id: z.string().uuid() });

const ruleFields = {
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  label: z.string().trim().max(63).regex(/^[A-Za-z0-9._-]*$/, "Invalid tunnel label").nullable(),
  threshold: z.number().int().min(ALERT_BOUNDS.threshold.min).max(ALERT_BOUNDS.threshold.max).nullable(),
  windowMinutes: z.number().int().min(ALERT_BOUNDS.windowMinutes.min).max(ALERT_BOUNDS.windowMinutes.max).nullable(),
  minRequests: z.number().int().min(ALERT_BOUNDS.minRequests.min).max(ALERT_BOUNDS.minRequests.max).nullable(),
  notifyMembers: z.boolean(),
  emails: z.array(z.string().trim().toLowerCase().email()).max(ALERT_BOUNDS.emails),
  webhookUrl: z.string().trim().max(2000).nullable(),
};
const createBody = z.object({ type: z.enum(ALERT_TYPES), ...ruleFields }).partial({ enabled: true, label: true, threshold: true, windowMinutes: true, minRequests: true, notifyMembers: true, emails: true, webhookUrl: true });
const patchBody = z.object(ruleFields).partial();

/** Fields that mean nothing for a type are stored as null, so the rule reads the same everywhere. */
function normalise<T extends { type?: string; label?: string | null; threshold?: number | null; windowMinutes?: number | null; minRequests?: number | null; webhookUrl?: string | null }>(type: string, b: T): T {
  const out = { ...b };
  if (out.label === "") out.label = null;
  if (out.webhookUrl === "") out.webhookUrl = null;
  if (type === "TUNNEL_OFFLINE") Object.assign(out, { threshold: null, minRequests: null });
  if (type === "USAGE") Object.assign(out, { label: null, windowMinutes: null, minRequests: null });
  if (type === "INBOX_FAILED") Object.assign(out, { threshold: null, windowMinutes: null, minRequests: null });
  if (type === "DOMAIN") Object.assign(out, { label: null, threshold: null, windowMinutes: null, minRequests: null });
  return out;
}

export async function alertRoutes(fastify: FastifyInstance, opts: { alerts: AlertService }) {
  const prisma = prismaOf(fastify);

  async function role(request: FastifyRequest, accountId: string): Promise<number> {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return m.roleLevel;
  }
  async function requireAdmin(request: FastifyRequest, accountId: string) {
    if ((await role(request, accountId)) < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can change alerts");
  }
  function checkWebhook(url: string | null | undefined) {
    if (!url) return;
    const err = validateWebhookUrl(url);
    if (err) throw new ValidationError(`Webhook URL: ${err}`);
  }
  async function maxRules(accountId: string) {
    const l = await getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides());
    return { plan: l.plan, max: Number.isFinite(l.maxAlertRules) ? l.maxAlertRules : 10_000 };
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const level = await role(request, accountId);
    const [rules, events, lim, enabled, labels] = await Promise.all([
      prisma.alertRule.findMany({ where: { accountId }, orderBy: { createdAt: "asc" }, include: { states: { where: { firing: true }, select: { subject: true, since: true } } } }),
      prisma.alertEvent.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, take: 50 }),
      maxRules(accountId),
      fastify.platformSettings.get("features.alerts"),
      prisma.tunnelSession.findMany({ where: { accountId }, distinct: ["label"], select: { label: true }, orderBy: { label: "asc" }, take: 200 }),
    ]);
    return successResponse(reply, "Success", 200, {
      available: Boolean(enabled) && lim.max > 0,
      maxRules: lim.max,
      canManage: level >= RoleLevel.ADMIN,
      tunnelLabels: labels.map((l) => l.label),
      rules: rules.map(({ states, ...r }) => ({ ...r, description: describeAlertRule(r as never), firing: states })),
      events: events.map((e) => ({ ...e, ruleName: rules.find((r) => r.id === e.ruleId)?.name ?? "" })),
    });
  });

  fastify.post("/:accountId", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const raw = createBody.parse(request.body ?? {});
    await requireAdmin(request, accountId);
    const lim = await maxRules(accountId);
    const count = await prisma.alertRule.count({ where: { accountId } });
    if (count >= lim.max) throw new PlanLimitExceededError({ limit: lim.max, current: count, limitKey: "maxAlertRules", plan: lim.plan });
    const b = normalise(raw.type, raw);
    checkWebhook(b.webhookUrl);
    const rule = await prisma.alertRule.create({
      data: {
        accountId,
        type: b.type,
        name: b.name,
        enabled: b.enabled ?? true,
        label: b.label ?? null,
        threshold: b.threshold ?? null,
        windowMinutes: b.windowMinutes ?? null,
        minRequests: b.minRequests ?? null,
        notifyMembers: b.notifyMembers ?? true,
        emails: b.emails ?? [],
        webhookUrl: b.webhookUrl ?? null,
        createdById: getUserContext(request).id,
        cursorAt: new Date(),
      },
    });
    return successResponse(reply, "Alert created", 201, { ...rule, description: describeAlertRule(rule as never), firing: [] });
  });

  fastify.patch("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const raw = patchBody.parse(request.body ?? {});
    await requireAdmin(request, accountId);
    const existing = await prisma.alertRule.findFirst({ where: { id, accountId } });
    if (!existing) throw new NotFoundError("Alert not found");
    const b = normalise(existing.type, raw);
    checkWebhook(b.webhookUrl);
    // Changing what is watched starts the rule over (no stale "resolved" notices).
    const conditionChanged = ["label", "threshold", "windowMinutes", "minRequests"].some((k) => k in raw);
    const rule = await prisma.$transaction(async (tx) => {
      if (conditionChanged || b.enabled === false) await tx.alertState.deleteMany({ where: { ruleId: id } });
      return tx.alertRule.update({ where: { id }, data: b as never });
    });
    return successResponse(reply, "Alert updated", 200, { ...rule, description: describeAlertRule(rule as never) });
  });

  fastify.delete("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await requireAdmin(request, accountId);
    const res = await prisma.alertRule.deleteMany({ where: { id, accountId } });
    if (!res.count) throw new NotFoundError("Alert not found");
    return successResponse(reply, "Alert removed", 200, { id });
  });

  fastify.post("/:accountId/:id/test", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await requireAdmin(request, accountId);
    const rule = await prisma.alertRule.findFirst({ where: { id, accountId } });
    if (!rule) throw new NotFoundError("Alert not found");
    const res = await opts.alerts.notify(rule as unknown as AlertRuleRow, {
      kind: "EVENT",
      subject: "test",
      title: `Test: ${rule.name}`,
      message: `This is a test of the alert “${rule.name}” (${describeAlertRule(rule as never)}). If you can read this, the channel works.`,
      path: `/organizations/${accountId}/alerts`,
    });
    const event = await prisma.alertEvent.findFirst({ where: { ruleId: id }, orderBy: { createdAt: "desc" } });
    return successResponse(reply, res.suppressed ? "Too many notifications this hour; not sent" : "Test sent", 200, { suppressed: res.suppressed, deliveries: event?.deliveries ?? null });
  });

  fastify.get("/:accountId/events", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const q = z.object({ ruleId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
    await role(request, accountId);
    const events = await prisma.alertEvent.findMany({ where: { accountId, ...(q.ruleId ? { ruleId: q.ruleId } : {}) }, orderBy: { createdAt: "desc" }, take: q.limit });
    return successResponse(reply, "Success", 200, { events });
  });
}
