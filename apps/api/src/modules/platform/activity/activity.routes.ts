// /api/v1/activity — a workspace's team activity feed.
//
//   GET /:accountId?category=&before=&limit=&connections=   members (IP and user agent: owners/admins only)
//   GET /:accountId/export?days=                            CSV, owners/admins
//
// Merges AuditLog rows (who changed what) with tunnel connects/disconnects
// from tunnel_sessions, newest first, paged by a `before` timestamp cursor.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma";
import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { prismaOf } from "../shared/http";

export const ACTIVITY_CATEGORIES = {
  members: ["ACCOUNT_", "ORGANIZATION_"],
  keys: ["API_KEY_"],
  tunnels: ["TUNNEL_", "INBOX_", "INSPECTOR_", "REQUEST_", "DOMAIN_"],
  alerts: ["ALERT_"],
} as const;
export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;

const params = z.object({ accountId: z.string().uuid() });
const listQuery = z.object({
  category: z.enum(["all", ...(Object.keys(ACTIVITY_CATEGORIES) as ActivityCategory[])]).default("all"),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  connections: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});
const exportQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

export interface ActivityItem {
  id: string;
  at: string;
  action: string;
  category: ActivityCategory | "other";
  actor: { id: string; name: string; email: string } | null;
  /** The member an action was about (removed, role changed, ...). */
  target?: { id: string; name: string; email: string } | null;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function categoryOf(action: string): ActivityCategory | "other" {
  for (const [cat, prefixes] of Object.entries(ACTIVITY_CATEGORIES) as Array<[ActivityCategory, readonly string[]]>) {
    if (prefixes.some((p) => action.startsWith(p))) return cat;
  }
  return "other";
}

/** Newest first, ties broken by id so pages are stable; at most `limit`. */
export function mergeActivity(lists: ActivityItem[][], limit: number): ActivityItem[] {
  return lists
    .flat()
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

function auditWhere(accountId: string, category: string, before?: Date, after?: Date): Prisma.AuditLogWhereInput {
  const prefixes = category === "all" ? Object.values(ACTIVITY_CATEGORIES).flat() : ACTIVITY_CATEGORIES[category as ActivityCategory];
  return {
    accountId,
    OR: prefixes.map((p) => ({ action: { startsWith: p } })),
    createdAt: { ...(before ? { lt: before } : {}), ...(after ? { gte: after } : {}) },
  };
}

const fullName = (u: { firstName: string; lastName: string; email: string }) => `${u.firstName} ${u.lastName}`.trim() || u.email;

export async function activityRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  async function roleLevel(request: FastifyRequest, accountId: string): Promise<number> {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return m.roleLevel;
  }

  async function load(accountId: string, q: { category: string; before?: Date; after?: Date; limit: number; connections: boolean }, withNetwork: boolean): Promise<ActivityItem[]> {
    const audits = await prisma.auditLog.findMany({
      where: auditWhere(accountId, q.category, q.before, q.after),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    const targetIds = [...new Set(audits.map((a) => a.targetUserId).filter((v): v is string => !!v))];
    const targets = new Map(
      (targetIds.length ? await prisma.user.findMany({ where: { id: { in: targetIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : []).map((u) => [
        u.id,
        { id: u.id, name: fullName(u), email: u.email },
      ]),
    );
    const items: ActivityItem[] = audits.map((a) => ({
      id: a.id,
      at: a.createdAt.toISOString(),
      action: a.action,
      category: categoryOf(a.action),
      actor: a.user ? { id: a.user.id, name: fullName(a.user), email: a.user.email } : null,
      target: a.targetUserId ? (targets.get(a.targetUserId) ?? null) : null,
      resourceType: a.resourceType,
      resourceId: a.resourceId,
      metadata: (a.metadata as Record<string, unknown> | null) ?? {},
      ...(withNetwork ? { ipAddress: a.ipAddress, userAgent: a.userAgent } : {}),
    }));

    const lists = [items];
    if (q.connections && (q.category === "all" || q.category === "tunnels")) {
      const range = { ...(q.before ? { lt: q.before } : {}), ...(q.after ? { gte: q.after } : {}) };
      const select = { id: true, label: true, agentId: true, connectedAt: true, disconnectedAt: true, status: true, apiKey: { select: { name: true, keyId: true } } } as const;
      const [connects, disconnects] = await Promise.all([
        prisma.tunnelSession.findMany({ where: { accountId, connectedAt: range }, orderBy: { connectedAt: "desc" }, take: q.limit, select }),
        prisma.tunnelSession.findMany({ where: { accountId, disconnectedAt: { not: null, ...range } }, orderBy: { disconnectedAt: "desc" }, take: q.limit, select }),
      ]);
      const meta = (s: (typeof connects)[number]) => ({ label: s.label, agentId: s.agentId, key: s.apiKey?.name ?? null, keyId: s.apiKey?.keyId ?? null });
      lists.push(
        connects.map((s) => ({ id: `${s.id}:c`, at: s.connectedAt.toISOString(), action: "TUNNEL_CONNECTED", category: "tunnels" as const, actor: null, resourceType: "Tunnel", resourceId: s.label, metadata: meta(s) })),
        disconnects.map((s) => ({
          id: `${s.id}:d`,
          at: s.disconnectedAt!.toISOString(),
          action: s.status === "EVICTED" ? "TUNNEL_EVICTED" : "TUNNEL_DISCONNECTED",
          category: "tunnels" as const,
          actor: null,
          resourceType: "Tunnel",
          resourceId: s.label,
          metadata: { ...meta(s), durationMs: s.disconnectedAt!.getTime() - s.connectedAt.getTime() },
        })),
      );
    }
    return mergeActivity(lists, q.limit);
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const q = listQuery.parse(request.query);
    const level = await roleLevel(request, accountId);
    const items = await load(accountId, q, level >= RoleLevel.ADMIN);
    return successResponse(reply, "Success", 200, {
      items,
      nextBefore: items.length === q.limit ? items[items.length - 1].at : null,
      canExport: level >= RoleLevel.ADMIN,
    });
  });

  fastify.get("/:accountId/export", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const { days } = exportQuery.parse(request.query);
    if ((await roleLevel(request, accountId)) < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can export activity");
    const items = await load(accountId, { category: "all", after: new Date(Date.now() - days * 86_400_000), limit: 10_000, connections: true }, true);
    const rows = [
      ["time", "action", "actor", "actor_email", "target_email", "resource_type", "resource", "details", "ip", "user_agent"],
      ...items.map((i) => [i.at, i.action, i.actor?.name ?? "", i.actor?.email ?? "", i.target?.email ?? "", i.resourceType, i.resourceId ?? "", JSON.stringify(i.metadata), i.ipAddress ?? "", i.userAgent ?? ""]),
    ];
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="activity-${accountId}-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(csv);
  });
}

/** RFC 4180 quoting, and a leading quote for cells a spreadsheet would run as a formula. */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
