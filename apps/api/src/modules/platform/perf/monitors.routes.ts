// /api/v1/monitors — scheduled collection runs (phase 4).
//
//   GET    /:accountId                 monitors with 24 h uptime, limits, collections and environments to pick from
//   POST   /:accountId                 { name, collectionId, environmentId?, folderId?, intervalMinutes, enabled? } (owners/admins; plan maxMonitors)
//   GET    /:accountId/:id?window=24h|7d|30d   uptime bars, latency per check, recent checks
//   PUT    /:accountId/:id             change it (owners/admins; plan minMonitorIntervalMinutes)
//   DELETE /:accountId/:id             (owners/admins)
//   POST   /:accountId/:id/run         run it now (owners/admins)
//   GET    /:accountId/:id/results/:rid   one check, with its report when it failed
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { MONITOR_INTERVALS, currentPlanOverrides, getEffectivePlanLimitsForAccount, nextMonitorRun, uptimeSummary } from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import { runMonitor } from "./monitors.worker";

const params = z.object({ accountId: z.string().uuid() });
const idParams = params.extend({ id: z.string().uuid() });
const interval = z.number().int().refine((n) => (MONITOR_INTERVALS as readonly number[]).includes(n), `Run every ${MONITOR_INTERVALS.join(", ")} minutes`);
const fields = {
  name: z.string().trim().min(1).max(80),
  collectionId: z.string().uuid(),
  environmentId: z.string().uuid().nullable().optional(),
  folderId: z.string().max(64).nullable().optional(),
  intervalMinutes: interval,
  enabled: z.boolean().optional(),
};
const createBody = z.object(fields);
const saveBody = z.object(fields).partial();
const WINDOWS = { "24h": { ms: 86_400_000, bars: 48 }, "7d": { ms: 7 * 86_400_000, bars: 42 }, "30d": { ms: 30 * 86_400_000, bars: 30 } } as const;

export async function monitorRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const db = prisma as unknown as { apiMonitor: any; apiMonitorResult: any; apiCollection: any; apiEnvironment: any; accountMember: any };

  async function member(request: FastifyRequest, accountId: string) {
    const user = getUserContext(request);
    const m = await db.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return { userId: user.id, admin: m.roleLevel >= RoleLevel.ADMIN };
  }
  async function admin(request: FastifyRequest, accountId: string) {
    const m = await member(request, accountId);
    if (!m.admin) throw new ForbiddenError("Only owners and admins can change monitors");
    return m;
  }
  async function limits(accountId: string) {
    const [enabled, l] = await Promise.all([fastify.platformSettings.get("features.performance"), getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides())]);
    const fin = (n: number, cap: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : cap);
    return { enabled: Boolean(enabled), max: fin(l.maxMonitors, 10_000), minInterval: Math.max(1, fin(l.minMonitorIntervalMinutes, 1)), plan: l.plan };
  }
  async function checkRefs(accountId: string, b: { collectionId?: string; environmentId?: string | null; folderId?: string | null }, current?: { collectionId: string }) {
    const collectionId = b.collectionId ?? current?.collectionId;
    const col = collectionId ? await db.apiCollection.findFirst({ where: { id: collectionId, accountId }, select: { folders: true } }) : null;
    if (!col) throw new ValidationError("Pick a collection of this workspace");
    if (b.folderId && !(Array.isArray(col.folders) && col.folders.some((f: { id: string }) => f.id === b.folderId))) throw new ValidationError("That folder is not in the collection");
    if (b.environmentId && !(await db.apiEnvironment.findFirst({ where: { id: b.environmentId, accountId }, select: { id: true } }))) throw new ValidationError("Pick an environment of this workspace");
  }
  const view = (m: any, uptime24h?: number | null) => ({
    id: m.id,
    name: m.name,
    collectionId: m.collectionId,
    collectionName: m.collection?.name,
    environmentId: m.environmentId,
    folderId: m.folderId,
    intervalMinutes: m.intervalMinutes,
    enabled: m.enabled,
    status: m.status,
    consecutiveFailures: m.consecutiveFailures,
    lastRunAt: m.lastRunAt,
    nextRunAt: m.nextRunAt,
    lastDurationMs: m.lastDurationMs,
    lastError: m.lastError,
    uptime24h: uptime24h ?? null,
  });

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const m = await member(request, accountId);
    const since = new Date(Date.now() - 86_400_000);
    const [monitors, lim, collections, environments, counts] = await Promise.all([
      db.apiMonitor.findMany({ where: { accountId }, orderBy: { createdAt: "asc" }, include: { collection: { select: { name: true } } } }),
      limits(accountId),
      db.apiCollection.findMany({ where: { accountId }, select: { id: true, name: true, folders: true }, orderBy: { name: "asc" } }),
      db.apiEnvironment.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.apiMonitorResult.groupBy({ by: ["monitorId", "ok"], where: { accountId, at: { gte: since } }, _count: { _all: true } }),
    ]);
    const uptime = (id: string) => {
      const rows = counts.filter((c: { monitorId: string }) => c.monitorId === id);
      const total = rows.reduce((n: number, c: { _count: { _all: number } }) => n + c._count._all, 0);
      const ok = rows.filter((c: { ok: boolean }) => c.ok).reduce((n: number, c: { _count: { _all: number } }) => n + c._count._all, 0);
      return total ? Math.round((ok / total) * 10000) / 100 : null;
    };
    return successResponse(reply, "Success", 200, {
      enabled: lim.enabled,
      canManage: m.admin,
      limits: { max: lim.max, minInterval: lim.minInterval, intervals: MONITOR_INTERVALS.filter((i) => i >= lim.minInterval) },
      collections: collections.map((c: { id: string; name: string; folders: unknown }) => ({ id: c.id, name: c.name, folders: Array.isArray(c.folders) ? (c.folders as Array<{ id: string; name: string }>).map((f) => ({ id: f.id, name: f.name })) : [] })),
      environments,
      monitors: monitors.map((x: any) => view(x, uptime(x.id))),
    });
  });

  fastify.post("/:accountId", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = createBody.parse(request.body ?? {});
    const m = await admin(request, accountId);
    const lim = await limits(accountId);
    if (!lim.enabled) throw new ForbiddenError("Monitors are switched off on this platform right now");
    const count = await db.apiMonitor.count({ where: { accountId } });
    if (count >= lim.max) throw new PlanLimitExceededError({ limit: lim.max, current: count, limitKey: "maxMonitors", plan: lim.plan });
    if (body.intervalMinutes < lim.minInterval) throw new ValidationError(`Your plan runs monitors every ${lim.minInterval} minutes at most`);
    await checkRefs(accountId, body);
    const row = await db.apiMonitor.create({
      data: { accountId, name: body.name, collectionId: body.collectionId, environmentId: body.environmentId ?? null, folderId: body.folderId ?? null, intervalMinutes: body.intervalMinutes, enabled: body.enabled ?? true, nextRunAt: new Date(), createdById: m.userId },
      include: { collection: { select: { name: true } } },
    });
    return successResponse(reply, "Monitor created", 201, view(row));
  });

  async function find(accountId: string, id: string) {
    const row = await db.apiMonitor.findFirst({ where: { id, accountId }, include: { collection: { select: { name: true } } } });
    if (!row) throw new NotFoundError("Monitor not found");
    return row;
  }

  fastify.get("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const q = z.object({ window: z.enum(["24h", "7d", "30d"]).default("24h") }).parse(request.query ?? {});
    await member(request, accountId);
    const row = await find(accountId, id);
    const w = WINDOWS[q.window];
    const to = new Date();
    const from = new Date(to.getTime() - w.ms);
    const results = await db.apiMonitorResult.findMany({ where: { monitorId: id, at: { gte: from } }, orderBy: { at: "asc" }, select: { id: true, at: true, ok: true, total: true, passed: true, failed: true, errored: true, durationMs: true }, take: 50_000 });
    const sum = uptimeSummary(results, from, to, w.bars);
    return successResponse(reply, "Success", 200, {
      monitor: view(row, sum.uptime),
      window: q.window,
      uptime: sum,
      // The latest 300 checks for the latency chart, newest last.
      checks: results.slice(-300).map((r: any) => ({ id: r.id, at: r.at, ok: r.ok, durationMs: r.durationMs, passed: r.passed, total: r.total })),
      recent: results.slice(-20).reverse(),
    });
  });

  fastify.get("/:accountId/:id/results/:rid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id, rid } = idParams.extend({ rid: z.string().uuid() }).parse(request.params);
    await member(request, accountId);
    const r = await db.apiMonitorResult.findFirst({ where: { id: rid, monitorId: id, accountId } });
    if (!r) throw new NotFoundError("Check not found");
    return successResponse(reply, "Success", 200, r);
  });

  fastify.put("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = saveBody.parse(request.body ?? {});
    await admin(request, accountId);
    const cur = await find(accountId, id);
    const lim = await limits(accountId);
    if (body.intervalMinutes !== undefined && body.intervalMinutes < lim.minInterval) throw new ValidationError(`Your plan runs monitors every ${lim.minInterval} minutes at most`);
    if (body.collectionId || body.environmentId || body.folderId) await checkRefs(accountId, body, cur);
    const intervalMinutes = body.intervalMinutes ?? cur.intervalMinutes;
    const row = await db.apiMonitor.update({
      where: { id },
      data: {
        ...body,
        ...(body.collectionId && !("folderId" in body) ? { folderId: null } : {}),
        // Switched on, or a new interval: next check on the new schedule.
        ...(body.enabled === true && !cur.enabled ? { nextRunAt: new Date() } : body.intervalMinutes !== undefined ? { nextRunAt: nextMonitorRun(intervalMinutes, Date.now()) } : {}),
      },
      include: { collection: { select: { name: true } } },
    });
    return successResponse(reply, "Monitor saved", 200, view(row));
  });

  fastify.delete("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await admin(request, accountId);
    await find(accountId, id);
    await db.apiMonitor.delete({ where: { id } });
    return successResponse(reply, "Monitor deleted", 200, { id });
  });

  fastify.post("/:accountId/:id/run", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await admin(request, accountId);
    const lim = await limits(accountId);
    if (!lim.enabled) throw new ForbiddenError("Monitors are switched off on this platform right now");
    const row = await find(accountId, id);
    const r = await runMonitor(prisma as never, row);
    return successResponse(reply, r.ok ? "Passed" : "Failed", 200, { ok: r.ok, consecutiveFailures: r.failures, report: r.report });
  });
}
