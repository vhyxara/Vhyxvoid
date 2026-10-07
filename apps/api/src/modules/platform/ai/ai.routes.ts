// /api/v1/ai — AI assist (internal-tools/shared/api-platform-plan.md, phase 7).
//
//   GET  /:accountId          is it on, the model, drafts used this month and the plan's allowance
//   POST /:accountId/mock     { description?, trafficLabel?, mockId? }  endpoints for a mock API
//   POST /:accountId/tests    { description?, trafficLabel?, specId?, baseUrl? }  a test collection
//
// Drafts are returned, never saved: the dashboard opens them in the editor,
// the CLI writes a file. Each successful draft counts against the plan limit
// aiRequestsPerMonth (calendar month, UTC); failed ones are logged but free.
// Any member may draft; API keys need the ai:use scope. Captured traffic is
// read from the request inspector with credentials already masked.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "@/core/errors/app-error";
import { ForbiddenError, NotFoundError, PlanLimitExceededError, ServiceUnavailableError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  AI_BOUNDS,
  AI_MOCK_SYSTEM,
  AI_TESTS_SYSTEM,
  aiMonthStart,
  aiUserPrompt,
  collectionFromDraft,
  currentPlanOverrides,
  getEffectivePlanLimitsForAccount,
  inspectorKeys,
  mockFromDraft,
  parseInspectedRequests,
  trafficForPrompt,
  type AiKind,
  type AiSource,
  type MockEndpoint,
} from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import { AiDraftError, anthropicModel, type AiModel } from "./aiModel";

const params = z.object({ accountId: z.string().uuid() });
const label = z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/, "Invalid tunnel label");
const description = z.string().trim().max(AI_BOUNDS.descriptionLength).optional();
const mockBody = z.object({ description, trafficLabel: label.optional(), mockId: z.string().uuid().optional() });
const testsBody = z.object({ description, trafficLabel: label.optional(), specId: z.string().uuid().optional(), baseUrl: z.string().trim().url().max(500).optional() });

type RedisLike = { lrange(key: string, start: number, stop: number): Promise<unknown[]> };

export async function aiRoutes(fastify: FastifyInstance, opts: { model?: AiModel | null } = {}) {
  const prisma = prismaOf(fastify);
  const db = prisma;
  const redis = (fastify as unknown as { redis: RedisLike }).redis;
  const model = opts.model === undefined ? anthropicModel() : opts.model;

  async function member(request: FastifyRequest, accountId: string) {
    const user = getUserContext(request);
    const m = await db.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return user.id;
  }

  async function status(accountId: string) {
    const [enabled, l] = await Promise.all([fastify.platformSettings.get("features.aiAssist"), getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides())]);
    const { start, resetsAt } = aiMonthStart();
    const used = await db.aiDraft.count({ where: { accountId, ok: true, createdAt: { gte: start } } });
    const limit = Number.isFinite(l.aiRequestsPerMonth) ? Math.max(0, Math.floor(l.aiRequestsPerMonth)) : null;
    return { enabled: Boolean(enabled), configured: Boolean(model), model: model?.model ?? null, used, limit, resetsAt, plan: l.plan };
  }

  async function usable(accountId: string) {
    const s = await status(accountId);
    if (!s.enabled) throw new ForbiddenError("AI assist is switched off on this platform right now");
    if (s.limit === 0) throw new ForbiddenError("AI assist isn't included in your plan");
    if (!model) throw new ServiceUnavailableError("AI assist isn't set up on this server (the operator needs to set ANTHROPIC_API_KEY)");
    if (s.limit !== null && s.used >= s.limit) {
      const err = new PlanLimitExceededError({ limit: s.limit, current: s.used, limitKey: "aiRequestsPerMonth", plan: s.plan });
      err.message = `You used all ${s.limit} AI drafts of this month; more on ${s.resetsAt.toISOString().slice(0, 10)}, or upgrade your plan`;
      throw err;
    }
    return { ...s, model };
  }

  async function traffic(accountId: string, tunnel: string) {
    const entries = parseInspectedRequests(await redis.lrange(inspectorKeys.list(accountId, tunnel), 0, AI_BOUNDS.trafficRequests - 1));
    const t = trafficForPrompt(entries);
    if (!t.requests) throw new ValidationError(`No captured requests on ${tunnel} to learn from: send some traffic through the tunnel with the request inspector on, then try again`);
    return t;
  }

  /** Run one draft, log it (tokens, outcome) and turn model failures into user-facing errors. */
  async function draft<T>(request: FastifyRequest, accountId: string, userId: string, kind: AiKind, source: AiSource, fn: () => Promise<{ value: T; model: string; inputTokens: number; outputTokens: number }>) {
    const log = (data: { model: string; ok: boolean; inputTokens?: number; outputTokens?: number; error?: string }) =>
      db.aiDraft.create({ data: { accountId, userId, keyId: request.apiKey?.keyId ?? null, kind, source, ...data } }).catch((err: unknown) => request.log.error({ err }, "ai draft log failed"));
    try {
      const r = await fn();
      await log({ model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ok: true });
      return r.value;
    } catch (err) {
      await log({ model: model?.model ?? "", ok: false, error: String((err as Error).message).slice(0, 300) });
      if (err instanceof AiDraftError) {
        if (err.code === "rate_limited") throw new AppError(err.message, 429, "RATE_LIMITED");
        if (err.code === "unavailable") throw new AppError(err.message, 503, "SERVICE_UNAVAILABLE");
        throw new AppError(err.message, 422, "VALIDATION_ERROR");
      }
      throw err;
    }
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "ai:use" } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    await member(request, accountId);
    const s = await status(accountId);
    return successResponse(reply, "Success", 200, { ...s, available: s.enabled && s.configured && s.limit !== 0 });
  });

  fastify.post("/:accountId/mock", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "ai:use", rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const b = mockBody.parse(request.body ?? {});
    if (!b.description && !b.trafficLabel) throw new ValidationError("Describe the API, or pick a tunnel whose captured traffic to learn from");
    const userId = await member(request, accountId);
    const s = await usable(accountId);
    let existing: MockEndpoint[] = [];
    if (b.mockId) {
      const mock = await db.mockApi.findFirst({ where: { id: b.mockId, accountId }, select: { endpoints: true } });
      if (!mock) throw new NotFoundError("Mock API not found");
      existing = (mock.endpoints as unknown as MockEndpoint[]) ?? [];
    }
    const t = b.trafficLabel ? await traffic(accountId, b.trafficLabel) : null;
    const prompt = aiUserPrompt("mock", { description: b.description, traffic: t?.text });
    const d = await draft(request, accountId, userId, "mock", t ? "traffic" : "description", async () => {
      const r = await s.model.mock(AI_MOCK_SYSTEM, prompt);
      return { ...r, value: r.draft };
    });
    const limits = await getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides());
    const maxEndpoints = Number.isFinite(limits.maxMockEndpoints) ? limits.maxMockEndpoints : 1000;
    const taken = new Set(existing.map((e) => `${e.method} ${e.path}`));
    const { endpoints, warnings } = mockFromDraft(d, { maxEndpoints, existing: existing.length });
    const fresh = endpoints.filter((e) => !taken.has(`${(e as MockEndpoint).method} ${(e as MockEndpoint).path}`));
    if (fresh.length < endpoints.length) warnings.push(`${endpoints.length - fresh.length} endpoint(s) already in the mock were left out`);
    if (!fresh.length) throw new AppError(warnings[0] ?? "The draft had no usable endpoints; describe the API in more detail", 422, "VALIDATION_ERROR");
    return successResponse(reply, "Drafted", 200, { summary: d.summary, endpoints: fresh, warnings, traffic: t ? { groups: t.groups, requests: t.requests } : null, usage: { used: s.used + 1, limit: s.limit, resetsAt: s.resetsAt } });
  });

  fastify.post("/:accountId/tests", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "ai:use", rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const b = testsBody.parse(request.body ?? {});
    if (!b.description && !b.trafficLabel && !b.specId) throw new ValidationError("Describe what to test, or pick API docs or a tunnel to learn from");
    const userId = await member(request, accountId);
    const s = await usable(accountId);
    let spec: string | undefined;
    if (b.specId) {
      const row = await db.apiSpec.findFirst({ where: { id: b.specId, accountId }, select: { draftText: true } });
      if (!row) throw new NotFoundError("API spec not found");
      spec = row.draftText;
    }
    const t = b.trafficLabel ? await traffic(accountId, b.trafficLabel) : null;
    const prompt = aiUserPrompt("tests", { description: b.description, traffic: t?.text, spec, baseUrl: b.baseUrl });
    const d = await draft(request, accountId, userId, "tests", spec ? "spec" : t ? "traffic" : "description", async () => {
      const r = await s.model.tests(AI_TESTS_SYSTEM, prompt);
      return { ...r, value: r.draft };
    });
    const limits = await getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides());
    const maxRequests = Number.isFinite(limits.maxApiCollectionRequests) ? limits.maxApiCollectionRequests : 5000;
    const { collection, warnings } = collectionFromDraft(d, { maxRequests, baseUrl: b.baseUrl });
    if (!collection.requests.length) throw new AppError(warnings[0] ?? "The draft had no usable requests; describe the API in more detail", 422, "VALIDATION_ERROR");
    return successResponse(reply, "Drafted", 200, { summary: d.summary, collection, warnings, traffic: t ? { groups: t.groups, requests: t.requests } : null, usage: { used: s.used + 1, limit: s.limit, resetsAt: s.resetsAt } });
  });
}
