// /api/v1/admin/accounts — support view of customer accounts.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { CONNECTABLE_ACCOUNT_STATUSES, currentPlanOverrides, getEffectivePlanLimitsForAccount, validateLimitOverrides } from "@vhyxvoid/shared";
import { NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { audit, orderBy, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";
import type { HubClient } from "../shared/hubClient";
import { invalidateKeyCache } from "../shared/keyCache";

const listQuery = pageQuerySchema.extend({
  status: z.enum(["ACTIVE", "PAST_DUE", "RESTRICTED", "SUSPENDED", "CANCELED", "DELETED"]).optional(),
  type: z.enum(["PERSONAL", "ORGANIZATION"]).optional(),
  plan: z.enum(["FREE", "PRO", "ENTERPRISE"]).optional(),
});

const updateBody = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    status: z.enum(["ACTIVE", "RESTRICTED", "SUSPENDED"]).optional(),
    statusReason: z.string().trim().max(500).nullable().optional(),
    adminNotes: z.string().trim().max(5000).nullable().optional(),
    limitOverrides: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

const serializeLimits = (o: object) => JSON.parse(JSON.stringify(o, (_k, v) => (v === Infinity ? null : v)));

export async function adminAccountRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);

  fastify.get("/", { onRequest: [fastify.requireAbility("account.read")] }, async (request) => {
    const q = listQuery.parse(request.query);
    const where = {
      ...(q.status ? { status: q.status } : { deletedAt: null }),
      ...(q.type ? { type: q.type } : {}),
      ...(q.plan ? (q.plan === "FREE" ? { subscriptions: { none: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] as const } } } } : { subscriptions: { some: { plan: q.plan, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] as const } } } }) : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" as const } },
              { slug: { contains: q.search, mode: "insensitive" as const } },
              { id: q.search },
              { stripeCustomerId: q.search },
              { members: { some: { user: { email: { contains: q.search, mode: "insensitive" as const } } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.account.findMany({
        where: where as any,
        orderBy: orderBy(q, ["createdAt", "name", "status"] as const, "createdAt"),
        ...skipTake(q),
        select: {
          id: true, name: true, slug: true, type: true, status: true, createdAt: true, graceEndsAt: true, stripeCustomerId: true,
          createdBy: { select: { id: true, email: true } },
          _count: { select: { members: true, apiKeys: true } },
          subscriptions: { orderBy: { createdAt: "desc" }, take: 1, select: { plan: true, status: true, currentPeriodEnd: true } },
        },
      }),
      prisma.account.count({ where: where as any }),
    ]);
    return page(
      rows.map(({ subscriptions, _count, ...a }) => ({ ...a, members: _count.members, apiKeys: _count.apiKeys, subscription: subscriptions[0] ?? null })),
      total,
      q,
    );
  });

  fastify.get<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("account.read")] }, async (request, reply) => {
    const { id } = request.params;
    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, email: true, firstName: true, lastName: true } },
        members: { include: { user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } }, role: { select: { name: true } } }, orderBy: { roleLevel: "desc" } },
        subscriptions: { orderBy: { createdAt: "desc" }, take: 5 },
        invoices: { orderBy: { createdAt: "desc" }, take: 10 },
        apiKeys: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, keyId: true, name: true, environment: true, status: true, createdAt: true, lastUsedAt: true, expiresAt: true, createdBy: { select: { email: true } } } },
        tunnelSessions: { orderBy: { connectedAt: "desc" }, take: 20, select: { id: true, agentId: true, label: true, status: true, connectedAt: true, disconnectedAt: true, metadata: true } },
      },
    });
    if (!account) throw new NotFoundError("Account not found");

    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const [usage, securityEvents, limits, liveAgents] = await Promise.all([
      prisma.usageAggregate.aggregate({ _sum: { quantity: true }, where: { accountId: id, metric: "requests", periodStart: { gte: monthStart } } }),
      prisma.securityEvent.findMany({ where: { accountId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
      getEffectivePlanLimitsForAccount(prisma as any, id, await currentPlanOverrides()),
      opts.hub.configured ? opts.hub.agents(id).catch(() => null) : Promise.resolve(null),
    ]);

    return successResponse(reply, "Success", 200, {
      ...account,
      usage: { requestsThisMonth: Number(usage._sum.quantity ?? 0), since: monthStart.toISOString() },
      limits: serializeLimits(limits),
      securityEvents,
      liveAgents,
    });
  });

  fastify.patch<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("account.update")] }, async (request, reply) => {
    const { id } = request.params;
    const body = updateBody.parse(request.body);
    if (body.limitOverrides) {
      const err = validateLimitOverrides(body.limitOverrides);
      if (err) throw new ValidationError(`limitOverrides: ${err}`);
    }
    if ((body.status === "SUSPENDED" || body.status === "RESTRICTED") && !body.statusReason) {
      throw new ValidationError("A reason is required to suspend or restrict an account");
    }
    const before = await prisma.account.findUnique({ where: { id } });
    if (!before || before.status === "DELETED") throw new NotFoundError("Account not found");

    const after = await prisma.account.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.status !== undefined ? { status: body.status, statusReason: body.status === "ACTIVE" ? null : body.statusReason ?? null } : {}),
        ...(body.statusReason !== undefined && body.status === undefined ? { statusReason: body.statusReason } : {}),
        ...(body.adminNotes !== undefined ? { adminNotes: body.adminNotes } : {}),
        // null clears the column (Prisma.DbNull); `undefined` would leave it as it was.
        ...(body.limitOverrides !== undefined ? { limitOverrides: body.limitOverrides === null ? Prisma.DbNull : (body.limitOverrides as object) } : {}),
      },
    });
    if (body.limitOverrides === null) await prisma.$executeRaw`UPDATE "Account" SET "limitOverrides" = NULL WHERE id = ${id}`;

    // Status and limits reach the hub through each key's cache entry; drop them
    // so the change applies within seconds, and disconnect live agents now
    // rather than waiting for the hub's sweep.
    let disconnected = 0;
    if (body.status !== undefined && body.status !== before.status) {
      await invalidateKeyCache(fastify, await prisma.apiKey.findMany({ where: { accountId: id }, select: { keyId: true } }));
      if (!(CONNECTABLE_ACCOUNT_STATUSES as readonly string[]).includes(body.status)) disconnected = await opts.hub.disconnectAccount(id);
    } else if (body.limitOverrides !== undefined) {
      await invalidateKeyCache(fastify, await prisma.apiKey.findMany({ where: { accountId: id }, select: { keyId: true } }));
    }

    await audit(fastify, request, {
      action: body.status && body.status !== before.status ? `account.${body.status.toLowerCase()}` : "account.updated",
      targetType: "Account",
      targetId: id,
      before: { name: before.name, status: before.status, statusReason: before.statusReason, limitOverrides: before.limitOverrides, adminNotes: before.adminNotes },
      after: { name: after.name, status: after.status, statusReason: after.statusReason, limitOverrides: body.limitOverrides === null ? null : after.limitOverrides, adminNotes: after.adminNotes },
      reason: body.statusReason ?? undefined,
    });
    return successResponse(reply, "Account updated", 200, { id, status: after.status, disconnectedAgents: disconnected });
  });

  /**
   * Soft-delete: status DELETED, keys revoked, agents disconnected, invitations
   * cancelled. Data stays for billing/audit; members keep their user accounts.
   */
  fastify.delete<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("account.delete")] }, async (request, reply) => {
    const { id } = request.params;
    const reason = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body ?? {}).reason;
    const account = await prisma.account.findUnique({ where: { id }, select: { id: true, status: true, name: true, subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, select: { id: true } } } });
    if (!account || account.status === "DELETED") throw new NotFoundError("Account not found");
    if (account.subscriptions.length) throw new ValidationError("Cancel the account's subscription in Stripe before deleting it");

    const keys = await prisma.apiKey.findMany({ where: { accountId: id }, select: { keyId: true } });
    await prisma.$transaction([
      prisma.account.update({ where: { id }, data: { status: "DELETED", statusReason: reason, deletedAt: new Date() } }),
      prisma.apiKey.updateMany({ where: { accountId: id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } }),
      prisma.accountInvitation.updateMany({ where: { accountId: id, status: "PENDING" }, data: { status: "CANCELED" } }),
    ]);
    await invalidateKeyCache(fastify, keys);
    const disconnected = await opts.hub.disconnectAccount(id);
    await audit(fastify, request, { action: "account.deleted", targetType: "Account", targetId: id, before: { status: account.status, name: account.name }, after: { status: "DELETED" }, reason });
    return successResponse(reply, "Account deleted", 200, { id, revokedKeys: keys.length, disconnectedAgents: disconnected });
  });
}
