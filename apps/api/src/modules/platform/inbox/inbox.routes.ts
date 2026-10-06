// /api/v1/inbox — the webhook inbox of an account's tunnels. The hub stores
// and delivers (apps/hub InboxService); this lists and manages.
//
//   GET    /:accountId                          tunnels with an inbox, counts, plan limit
//   PUT    /:accountId/:label                   { enabled } (owners/admins)
//   GET    /:accountId/:label?status=           requests, newest first (no bodies)
//   GET    /:accountId/:label/:id               one request, body included
//   POST   /:accountId/:label/:id/redeliver     queue again and deliver now (owners/admins)
//   DELETE /:accountId/:label/:id               delete one (owners/admins)
//   DELETE /:accountId/:label?status=           delete many, e.g. everything delivered (owners/admins)
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError, NotFoundError, PlanLimitExceededError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  currentPlanOverrides,
  getEffectivePlanLimitsForAccount,
  INBOX_BODY_MAX_BYTES,
  INBOX_MAX_ATTEMPTS,
  INBOX_RETENTION_DAYS,
  isBinaryForInspector,
  maskHeaders,
} from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import type { HubClient } from "../shared/hubClient";

const STATUSES = ["QUEUED", "DELIVERING", "DELIVERED", "FAILED"] as const;
const params = z.object({ accountId: z.string().uuid() });
const labelParams = params.extend({ label: z.string().min(1).max(63).regex(/^[A-Za-z0-9._-]+$/, "Invalid tunnel label") });
const idParams = labelParams.extend({ id: z.string().uuid() });
const listQuery = z.object({ status: z.enum(STATUSES).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
const purgeQuery = z.object({ status: z.enum(["DELIVERED", "FAILED"]).optional() });

export async function inboxRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);

  async function role(request: FastifyRequest, accountId: string): Promise<number> {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return m.roleLevel;
  }
  async function requireAdmin(request: FastifyRequest, accountId: string) {
    if ((await role(request, accountId)) < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can change the inbox");
  }
  async function keepLimit(accountId: string) {
    const limits = await getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides());
    return { plan: limits.plan, keep: Number.isFinite(limits.inboxRequests) ? limits.inboxRequests : 100_000 };
  }
  function log(request: FastifyRequest, accountId: string, action: string, label: string, metadata: Record<string, unknown> = {}) {
    void prisma.auditLog
      .create({ data: { accountId, userId: getUserContext(request).id, action, resourceType: "tunnel", resourceId: label, metadata: metadata as object, ipAddress: request.ip } })
      .catch(() => {});
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const level = await role(request, accountId);
    const [inboxes, counts, limit, enabledGlobally, live] = await Promise.all([
      prisma.tunnelInbox.findMany({ where: { accountId }, orderBy: { label: "asc" } }),
      prisma.inboxRequest.groupBy({ by: ["label", "status"], where: { accountId }, _count: { _all: true } }),
      keepLimit(accountId),
      fastify.platformSettings.get("features.webhookInbox"),
      opts.hub.configured ? opts.hub.agents(accountId).catch(() => []) : Promise.resolve([]),
    ]);
    const labels = new Set([...inboxes.map((i) => i.label), ...counts.map((c) => c.label)]);
    const liveLabels = [...new Set(live.map((a) => a.label))].sort();
    return successResponse(reply, "Success", 200, {
      available: Boolean(enabledGlobally) && limit.keep > 0,
      keepPerTunnel: limit.keep,
      retentionDays: INBOX_RETENTION_DAYS,
      bodyLimitBytes: INBOX_BODY_MAX_BYTES,
      maxAttempts: INBOX_MAX_ATTEMPTS,
      canManage: level >= RoleLevel.ADMIN,
      liveLabels,
      tunnels: [...labels].sort().map((label) => {
        const row = inboxes.find((i) => i.label === label);
        const by = (s: string) => counts.find((c) => c.label === label && c.status === s)?._count._all ?? 0;
        return {
          label,
          enabled: row?.enabled ?? false,
          connected: liveLabels.includes(label),
          queued: by("QUEUED") + by("DELIVERING"),
          delivered: by("DELIVERED"),
          failed: by("FAILED"),
        };
      }),
    });
  });

  fastify.put("/:accountId/:label", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body ?? {});
    await requireAdmin(request, accountId);
    if (enabled) {
      const limit = await keepLimit(accountId);
      if (limit.keep <= 0) throw new PlanLimitExceededError({ limit: 0, current: 0, limitKey: "inboxRequests", plan: limit.plan });
    }
    const user = getUserContext(request);
    const row = await prisma.tunnelInbox.upsert({
      where: { accountId_label: { accountId, label } },
      create: { accountId, label, enabled, updatedById: user.id },
      update: { enabled, updatedById: user.id },
    });
    await opts.hub.inbox(enabled ? "drain" : "invalidate", accountId, label);
    log(request, accountId, enabled ? "tunnel.inbox.enabled" : "tunnel.inbox.disabled", label);
    return successResponse(reply, enabled ? "Inbox on" : "Inbox off", 200, { label, enabled: row.enabled });
  });

  fastify.get("/:accountId/:label", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    const { status, limit } = listQuery.parse(request.query);
    await role(request, accountId);
    const rows = await prisma.inboxRequest.findMany({
      where: { accountId, label, ...(status ? { status } : {}) },
      orderBy: { receivedAt: "desc" },
      take: limit,
      select: {
        id: true,
        method: true,
        path: true,
        bodySize: true,
        receivedAt: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
        lastError: true,
        responseStatus: true,
        deliveredAt: true,
      },
    });
    return successResponse(reply, "Success", 200, { label, requests: rows });
  });

  fastify.get("/:accountId/:label/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label, id } = idParams.parse(request.params);
    await role(request, accountId);
    const row = await prisma.inboxRequest.findFirst({ where: { id, accountId, label } });
    if (!row) throw new NotFoundError("Request not found");
    const headers = (row.headers ?? {}) as Record<string, string>;
    const binary = isBinaryForInspector(headers["content-type"]);
    const body = row.body ? Buffer.from(row.body) : null;
    return successResponse(reply, "Success", 200, {
      ...row,
      headers: maskHeaders(headers),
      body: body ? { data: body.toString(binary ? "base64" : "utf8"), encoding: binary ? "base64" : "utf8", size: body.length, truncated: false } : null,
    });
  });

  fastify.post("/:accountId/:label/:id/redeliver", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label, id } = idParams.parse(request.params);
    await requireAdmin(request, accountId);
    const res = await prisma.inboxRequest.updateMany({
      where: { id, accountId, label, status: { in: ["DELIVERED", "FAILED", "QUEUED"] } },
      data: { status: "QUEUED", attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
    if (!res.count) throw new NotFoundError("Request not found, or it is being delivered right now");
    const hub = await opts.hub.inbox("drain", accountId, label);
    log(request, accountId, "tunnel.inbox.redeliver", label, { id });
    return successResponse(reply, "Queued for delivery", 200, { id, connected: hub?.connected ?? false });
  });

  fastify.delete("/:accountId/:label/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label, id } = idParams.parse(request.params);
    await requireAdmin(request, accountId);
    const res = await prisma.inboxRequest.deleteMany({ where: { id, accountId, label, status: { not: "DELIVERING" } } });
    if (!res.count) throw new NotFoundError("Request not found, or it is being delivered right now");
    return successResponse(reply, "Deleted", 200, { id });
  });

  fastify.delete("/:accountId/:label", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    const { status } = purgeQuery.parse(request.query);
    await requireAdmin(request, accountId);
    const res = await prisma.inboxRequest.deleteMany({
      where: { accountId, label, status: status ? status : { not: "DELIVERING" } },
    });
    log(request, accountId, "tunnel.inbox.purged", label, { status: status ?? "all", count: res.count });
    return successResponse(reply, "Deleted", 200, { deleted: res.count });
  });
}
