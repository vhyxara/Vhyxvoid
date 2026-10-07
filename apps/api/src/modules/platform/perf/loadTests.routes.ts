// /api/v1/load-tests — load tests against the workspace's own targets (phase 4).
//
//   GET    /:accountId                 runs (latest 50, no timeline), limits, the targets you can pick
//   POST   /:accountId                 start { name, target, method, headers, body?, vus, durationSec, rampUpSec, thinkTimeMs, maxRps, thresholds?, count4xxAsErrors? }
//   GET    /:accountId/:id             one run with its timeline (live while RUNNING)
//   POST   /:accountId/:id/cancel      stop a running test
//   DELETE /:accountId/:id             delete a finished run
//   GET    /:accountId/compare?a=&b=   two finished runs side by side
//
// Every member can run them (like the API client). Limits per plan:
// maxLoadTestVus (0 = off), maxLoadTestSeconds, maxLoadTestRps,
// loadTestsPerDay; one running test per account.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "@/core/errors/app-error";
import { ConflictError, ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { compareLoadTests, currentPlanOverrides, getEffectivePlanLimitsForAccount, loadTestConfigProblem, type LoadTestConfig, type LoadTestSummary } from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import { loadTestInstance, maxConcurrent, runningHere, startLoadTest, targetFor } from "./loadRunner";

const params = z.object({ accountId: z.string().uuid() });
const idParams = params.extend({ id: z.string().uuid() });
const KEEP = 100;

const startBody = z.object({
  name: z.string().trim().min(1).max(80).default("Load test"),
  target: z.string().trim().min(3).max(2000),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).default("GET"),
  headers: z.array(z.tuple([z.string().min(1).max(256), z.string().max(8192)])).max(50).default([]),
  body: z.string().max(100_000).optional(),
  vus: z.number().int().min(1).max(1000),
  durationSec: z.number().int().min(5).max(3600),
  rampUpSec: z.number().int().min(0).max(600).default(0),
  thinkTimeMs: z.number().int().min(0).max(60_000).default(0),
  maxRps: z.number().int().min(0).max(10_000).default(0),
  count4xxAsErrors: z.boolean().default(false),
  thresholds: z
    .object({
      p95Ms: z.number().positive().max(600_000).optional(),
      p99Ms: z.number().positive().max(600_000).optional(),
      avgMs: z.number().positive().max(600_000).optional(),
      errorRatePct: z.number().min(0).max(100).optional(),
      minRps: z.number().min(0).max(100_000).optional(),
    })
    .default({}),
});

export async function loadTestRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const db = prisma as unknown as { loadTest: any; customDomain: any; account: any; accountMember: any; tunnelSession: any; mockApi: any };
  const hubDomain = () => process.env.HUB_DOMAIN ?? "vhyxvoid.com";

  async function member(request: FastifyRequest, accountId: string) {
    const user = getUserContext(request);
    const m = await db.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true, account: { select: { slug: true } } } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return { userId: user.id, slug: m.account.slug as string | null };
  }
  async function limits(accountId: string) {
    const [enabled, l] = await Promise.all([fastify.platformSettings.get("features.performance"), getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides())]);
    const fin = (n: number, cap: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : cap);
    return { enabled: Boolean(enabled), maxVus: fin(l.maxLoadTestVus, 1000), maxSeconds: fin(l.maxLoadTestSeconds, 3600), maxRps: fin(l.maxLoadTestRps, 10_000), perDay: fin(l.loadTestsPerDay, 100_000), plan: l.plan };
  }
  const summaryOf = (r: any) => ({
    id: r.id,
    name: r.name,
    target: r.target,
    status: r.status,
    config: r.config,
    summary: r.summary,
    error: r.error,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    createdById: r.createdById,
  });

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const m = await member(request, accountId);
    const [rows, lim, labels, mocks, domains, today] = await Promise.all([
      db.loadTest.findMany({ where: { accountId }, orderBy: { startedAt: "desc" }, take: 50, select: { id: true, name: true, target: true, status: true, config: true, summary: true, error: true, startedAt: true, finishedAt: true, createdById: true } }),
      limits(accountId),
      db.tunnelSession.findMany({ where: { accountId }, distinct: ["label"], select: { label: true }, orderBy: { label: "asc" }, take: 100 }),
      db.mockApi.findMany({ where: { accountId }, select: { label: true, name: true }, orderBy: { name: "asc" } }),
      db.customDomain.findMany({ where: { accountId, verifiedAt: { not: null } }, select: { hostname: true, label: true }, orderBy: { hostname: "asc" } }),
      db.loadTest.count({ where: { accountId, startedAt: { gte: dayStart() } } }),
    ]);
    const url = (label: string) => (m.slug ? `https://${m.slug}--${label}.${hubDomain()}` : null);
    return successResponse(reply, "Success", 200, {
      enabled: lim.enabled,
      limits: { maxVus: lim.maxVus, maxSeconds: lim.maxSeconds, maxRps: lim.maxRps, perDay: lim.perDay, usedToday: today },
      targets: [
        ...labels.map((l: { label: string }) => ({ kind: "tunnel", name: l.label, url: url(l.label) })),
        ...mocks.map((x: { label: string; name: string }) => ({ kind: "mock", name: x.name, url: url(x.label) })),
        ...domains.map((d: { hostname: string; label: string }) => ({ kind: "domain", name: d.hostname, url: `https://${d.hostname}` })),
      ].filter((t) => t.url),
      runs: rows.map(summaryOf),
    });
  });

  fastify.post("/:accountId", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = startBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    const lim = await limits(accountId);
    if (!lim.enabled) throw new ForbiddenError("Load tests are switched off on this platform right now");
    if (lim.maxVus === 0) throw new ForbiddenError("Load tests aren't included in your plan");
    const config: LoadTestConfig = {
      request: { method: body.method, url: body.target, headers: body.headers, ...(body.body !== undefined && body.method !== "GET" && body.method !== "HEAD" ? { body: body.body } : {}) },
      vus: body.vus,
      durationSec: body.durationSec,
      rampUpSec: body.rampUpSec,
      thinkTimeMs: body.thinkTimeMs,
      // 0 means "as fast as the plan allows".
      maxRps: body.maxRps > 0 ? Math.min(body.maxRps, lim.maxRps) : lim.maxRps,
      count4xxAsErrors: body.count4xxAsErrors,
      thresholds: Object.fromEntries(Object.entries(body.thresholds).filter(([, v]) => v !== undefined)),
    };
    const problem = loadTestConfigProblem(config, lim);
    if (problem) throw new ValidationError(problem);
    const target = await targetFor(db, accountId, body.target, hubDomain());
    if ("problem" in target) throw new ValidationError(target.problem);
    const today = await db.loadTest.count({ where: { accountId, startedAt: { gte: dayStart() } } });
    if (today >= lim.perDay) throw new PlanLimitExceededError({ limit: lim.perDay, current: today, limitKey: "loadTestsPerDay", plan: lim.plan });
    if (await db.loadTest.count({ where: { accountId, status: "RUNNING" } })) throw new ConflictError("A load test is already running in this workspace. Wait for it or cancel it.");
    if (runningHere() >= maxConcurrent()) throw new AppError("The load-test runners are busy; try again in a minute", 503, "SERVICE_UNAVAILABLE");
    const row = await db.loadTest.create({ data: { accountId, name: body.name, target: body.target, config: config as never, status: "RUNNING", instance: loadTestInstance, createdById: m.userId } });
    startLoadTest(db, row, target, config);
    void prune(accountId);
    return successResponse(reply, "Load test started", 201, summaryOf(row));
  });

  async function prune(accountId: string) {
    const old = await db.loadTest.findMany({ where: { accountId, status: { not: "RUNNING" } }, orderBy: { startedAt: "desc" }, skip: KEEP, select: { id: true } }).catch(() => []);
    if (old.length) await db.loadTest.deleteMany({ where: { id: { in: old.map((o: { id: string }) => o.id) } } }).catch(() => undefined);
  }

  fastify.get("/:accountId/compare", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const q = z.object({ a: z.string().uuid(), b: z.string().uuid() }).parse(request.query ?? {});
    await member(request, accountId);
    const [a, b] = await Promise.all([q.a, q.b].map((id) => db.loadTest.findFirst({ where: { id, accountId } })));
    if (!a || !b) throw new NotFoundError("Load test not found");
    if (!a.summary || !b.summary || a.status === "RUNNING" || b.status === "RUNNING") throw new ValidationError("Compare finished runs");
    return successResponse(reply, "Success", 200, { a: { ...summaryOf(a), timeline: a.timeline }, b: { ...summaryOf(b), timeline: b.timeline }, rows: compareLoadTests(a.summary as LoadTestSummary, b.summary as LoadTestSummary) });
  });

  fastify.get("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await member(request, accountId);
    const row = await db.loadTest.findFirst({ where: { id, accountId } });
    if (!row) throw new NotFoundError("Load test not found");
    return successResponse(reply, "Success", 200, { ...summaryOf(row), timeline: row.timeline, cancelRequested: row.cancelRequested });
  });

  fastify.post("/:accountId/:id/cancel", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await member(request, accountId);
    const { count } = await db.loadTest.updateMany({ where: { id, accountId, status: "RUNNING" }, data: { cancelRequested: true } });
    if (!count) throw new ConflictError("That load test is not running");
    return successResponse(reply, "Stopping", 200, { id });
  });

  fastify.delete("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await member(request, accountId);
    const { count } = await db.loadTest.deleteMany({ where: { id, accountId, status: { not: "RUNNING" } } });
    if (!count) throw new NotFoundError("No finished load test with that id");
    return successResponse(reply, "Deleted", 200, { id });
  });
}

function dayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
