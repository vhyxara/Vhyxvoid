// /api/v1/admin/logs — what happened, across the product.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { orderBy, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";

const dateRange = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

function createdAtRange(r: z.infer<typeof dateRange>) {
  if (!r.from && !r.to) return {};
  return { createdAt: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function adminLogRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  /** API-key security events: bad signatures, replays, rate limits, scope violations. */
  fastify.get("/security-events", { onRequest: [fastify.requireAbility("logs.read")] }, async (request) => {
    const q = pageQuerySchema.merge(dateRange).extend({ type: z.string().max(40).optional(), accountId: z.string().uuid().optional() }).parse(request.query);
    const where = {
      ...createdAtRange(q),
      ...(q.type ? { type: q.type } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.search ? { OR: [{ ip: q.search }, { reason: { contains: q.search, mode: "insensitive" as const } }] } : {}),
    };
    const [rows, total, byType] = await Promise.all([
      prisma.securityEvent.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(q), include: { account: { select: { id: true, name: true } }, apiKey: { select: { keyId: true, name: true } } } }),
      prisma.securityEvent.count({ where }),
      prisma.securityEvent.groupBy({ by: ["type"], _count: { _all: true }, where: createdAtRange(q) }),
    ]);
    return page(rows, total, q, { byType: byType.map((r) => ({ type: r.type, count: r._count._all })) });
  });

  /** Customer-side audit trail (members, keys, invitations, settings changes in accounts). */
  fastify.get("/activity", { onRequest: [fastify.requireAbility("logs.read")] }, async (request) => {
    const q = pageQuerySchema.merge(dateRange).extend({ action: z.string().max(80).optional(), accountId: z.string().uuid().optional(), userId: z.string().uuid().optional() }).parse(request.query);
    const where = {
      ...createdAtRange(q),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.userId ? { OR: [{ userId: q.userId }, { targetUserId: q.userId }] } : {}),
      ...(q.search ? { OR: [{ action: { contains: q.search } }, { resourceId: q.search }, { ipAddress: q.search }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(q), include: { user: { select: { id: true, email: true } }, account: { select: { id: true, name: true } } } }),
      prisma.auditLog.count({ where }),
    ]);
    return page(rows, total, q);
  });

  /** Tunnelled requests recorded by the hub (SDK path). */
  fastify.get("/requests", { onRequest: [fastify.requireAbility("logs.read")] }, async (request) => {
    const q = pageQuerySchema.merge(dateRange).extend({ accountId: z.string().uuid().optional(), failed: z.coerce.boolean().optional() }).parse(request.query);
    const where = {
      ...createdAtRange(q),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.failed ? { OR: [{ status: null }, { status: { gte: 500 } }] } : {}),
      ...(q.search ? { path: { contains: q.search } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.tunnelRequest.findMany({ where, orderBy: orderBy(q, ["createdAt", "durationMs", "status"] as const, "createdAt"), ...skipTake(q), include: { account: { select: { id: true, name: true } } } }),
      prisma.tunnelRequest.count({ where }),
    ]);
    return page(rows, total, q);
  });

  /** Admin actions as CSV (for compliance exports). At most 50,000 rows per file. */
  fastify.get("/admin-audit.csv", { onRequest: [fastify.requireAbility("audit.export")] }, async (request, reply) => {
    const q = dateRange.extend({ adminId: z.string().uuid().optional(), action: z.string().max(80).optional() }).parse(request.query);
    const rows = await prisma.adminAuditLog.findMany({
      where: { ...createdAtRange(q), ...(q.adminId ? { adminId: q.adminId } : {}), ...(q.action ? { action: { startsWith: q.action } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50_000,
      include: { admin: { select: { email: true } } },
    });
    const header = ["createdAt", "admin", "action", "targetType", "targetId", "changes", "metadata"];
    const lines = [header.join(","), ...rows.map((r) => [r.createdAt.toISOString(), r.admin?.email ?? r.adminId, r.action, r.targetType, r.targetId, r.changes, r.metadata].map(csvCell).join(","))];
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="admin-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(lines.join("\n"));
  });
}
