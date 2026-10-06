// Traffic charts from tunnel_minute_stats (per tunnel per minute, kept 7 days).
//
//   GET /api/v1/traffic/:accountId?range=1h|24h|7d&label=   members of the account
//   GET /api/v1/admin/traffic?range=1h|24h|7d               operators (system.read): all accounts
//
// Aggregation happens in Postgres (one GROUP BY per call), so a 7-day range of
// a busy account returns ~84 rows instead of ~10k minute rows per tunnel.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { Prisma, type PrismaClient } from "@/generated/prisma";
import { ForbiddenError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { TRAFFIC_RANGES, fillTrafficSeries, trafficTotals, trafficWindow, type TrafficRange, type TrafficRow } from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";

const rangeSchema = z.enum(Object.keys(TRAFFIC_RANGES) as [TrafficRange, ...TrafficRange[]]).default("24h");
const accountQuery = z.object({
  range: rangeSchema,
  label: z.string().trim().max(100).regex(/^[A-Za-z0-9._-]+$/, "Invalid tunnel label").optional(),
});
const adminQuery = z.object({ range: rangeSchema });
const params = z.object({ accountId: z.string().uuid() });

type RawBucket = { t: bigint | number; requests: bigint | number; errors4xx: bigint | number; errors5xx: bigint | number; totalMs: bigint | number };
type RawGroup = { key: string; requests: bigint | number; errors4xx: bigint | number; errors5xx: bigint | number; totalMs: bigint | number };

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Buckets and per-group totals for one window. `scope` limits rows (account/label); null = every account. */
export async function queryTraffic(
  prisma: PrismaClient,
  window: { from: number; to: number; bucketMs: number },
  scope: { accountId?: string; label?: string },
  groupBy: "label" | "accountId",
) {
  const conds: Prisma.Sql[] = [Prisma.sql`"minute" >= ${new Date(window.from)}`, Prisma.sql`"minute" < ${new Date(window.to)}`];
  if (scope.accountId) conds.push(Prisma.sql`"accountId" = ${scope.accountId}`);
  if (scope.label) conds.push(Prisma.sql`"label" = ${scope.label}`);
  const where = Prisma.join(conds, " AND ");
  const bucket = window.bucketMs;
  const groupCol = groupBy === "label" ? Prisma.sql`"label"` : Prisma.sql`"accountId"`;

  const [buckets, groups] = await Promise.all([
    prisma.$queryRaw<RawBucket[]>`
      SELECT (floor(extract(epoch from "minute") * 1000 / ${bucket}) * ${bucket})::bigint AS t,
             sum("requests")::bigint AS requests, sum("errors4xx")::bigint AS "errors4xx",
             sum("errors5xx")::bigint AS "errors5xx", sum("totalMs")::bigint AS "totalMs"
      FROM "tunnel_minute_stats" WHERE ${where}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<RawGroup[]>`
      SELECT ${groupCol} AS key, sum("requests")::bigint AS requests, sum("errors4xx")::bigint AS "errors4xx",
             sum("errors5xx")::bigint AS "errors5xx", sum("totalMs")::bigint AS "totalMs"
      FROM "tunnel_minute_stats" WHERE ${where}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
  ]);

  const rows: TrafficRow[] = buckets.map((b) => ({ t: num(b.t), requests: num(b.requests), errors4xx: num(b.errors4xx), errors5xx: num(b.errors5xx), totalMs: num(b.totalMs) }));
  const top = groups.map((g) => {
    const r = { requests: num(g.requests), errors4xx: num(g.errors4xx), errors5xx: num(g.errors5xx), totalMs: num(g.totalMs) };
    return { key: g.key, ...trafficTotals([r]) };
  });
  return {
    from: new Date(window.from).toISOString(),
    to: new Date(window.to).toISOString(),
    bucketMinutes: window.bucketMs / 60_000,
    series: fillTrafficSeries(rows, window.from, window.to, window.bucketMs),
    totals: trafficTotals(rows),
    top,
  };
}

export async function trafficRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  async function member(request: FastifyRequest, accountId: string) {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const { range, label } = accountQuery.parse(request.query);
    await member(request, accountId);
    const data = await queryTraffic(prisma, trafficWindow(range), { accountId, label }, "label");
    return successResponse(reply, "Success", 200, {
      range,
      label: label ?? null,
      ...data,
      top: data.top.map(({ key, ...t }) => ({ label: key, ...t })),
    });
  });
}

export async function adminTrafficRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  fastify.get("/", { onRequest: [fastify.requireAbility("system.read")] }, async (request, reply) => {
    const { range } = adminQuery.parse(request.query);
    const data = await queryTraffic(prisma, trafficWindow(range), {}, "accountId");
    const accounts = await prisma.account.findMany({ where: { id: { in: data.top.map((t) => t.key) } }, select: { id: true, name: true, slug: true } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return successResponse(reply, "Success", 200, {
      range,
      ...data,
      top: data.top.slice(0, 10).map(({ key, ...t }) => ({ accountId: key, name: byId.get(key)?.name ?? null, slug: byId.get(key)?.slug ?? null, ...t })),
    });
  });
}
