// /api/v1/mocks — a workspace's hosted mock APIs (internal-tools/shared/api-platform-plan.md, phase 1).
//
//   GET    /:accountId                  list, plan limits, templates
//   POST   /:accountId                  create { label, name, template? | openapi? } (owners/admins; plan maxMockApis)
//   GET    /:accountId/:id              one mock with its endpoints
//   PUT    /:accountId/:id              save { name, description, label, enabled, mode, cors, latencyMs, endpoints, expectedVersion } (owners/admins)
//   DELETE /:accountId/:id              remove (owners/admins)
//   POST   /:accountId/:id/import       { openapi: text|object, replace? } add endpoints from an OpenAPI document (owners/admins)
//   GET    /:accountId/:id/openapi      OpenAPI 3 export (?format=yaml)
//   POST   /:accountId/:id/try          { method, path, headers?, body?, definition? } what the mock answers (members)
//
// Definitions are checked and served by packages/shared/src/mockApi.ts, the
// same code the hub runs. Saving tells the hub at once (the policy
// invalidation call also drops the cached mock).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ConflictError, ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  MOCK_METHODS,
  MOCK_MODES,
  MOCK_TEMPLATES,
  currentPlanOverrides,
  exportOpenApi,
  getEffectivePlanLimitsForAccount,
  importOpenApi,
  mockDefinitionProblem,
  mockLabelProblem,
  resolveMock,
  type MockApiDefinition,
  type MockEndpoint,
} from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import type { HubClient } from "../shared/hubClient";

const params = z.object({ accountId: z.string().uuid() });
const idParams = params.extend({ id: z.string().uuid() });

const label = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((v, ctx) => {
    const p = mockLabelProblem(v);
    if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p });
  });
const openapiInput = z.union([z.string().min(2).max(5_000_000), z.record(z.string(), z.unknown())]);

const createBody = z.object({
  label,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  template: z.string().max(40).optional(),
  openapi: openapiInput.optional(),
  mode: z.enum(MOCK_MODES).optional(),
});
const saveBody = z.object({
  label: label.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
  mode: z.enum(MOCK_MODES).optional(),
  cors: z.boolean().optional(),
  latencyMs: z.number().int().min(0).max(30_000).optional(),
  endpoints: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
  /** The version the editor loaded; a newer save in between is refused (409). */
  expectedVersion: z.number().int().min(1).optional(),
});
const importBody = z.object({ openapi: openapiInput, replace: z.boolean().default(false) });
const tryBody = z.object({
  method: z.enum(MOCK_METHODS.filter((m) => m !== "ANY") as [string, ...string[]]).default("GET"),
  path: z.string().min(1).max(2000).regex(/^\//, "The path must start with /"),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(1_000_000).optional(),
  /** Unsaved changes from the editor; otherwise the saved mock. */
  definition: z.record(z.string(), z.unknown()).optional(),
});

type Row = {
  id: string;
  label: string;
  name: string;
  description: string;
  enabled: boolean;
  mode: "ALWAYS" | "OFFLINE";
  cors: boolean;
  latencyMs: number;
  endpoints: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Parses an OpenAPI document given as JSON or YAML text, or already parsed. */
function parseOpenApi(input: string | Record<string, unknown>): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    try {
      return parseYaml(input, { maxAliasCount: 100 });
    } catch (err) {
      throw new ValidationError(`Could not read the document as JSON or YAML: ${(err as Error).message.split("\n")[0]}`);
    }
  }
}

function importOrThrow(input: string | Record<string, unknown>) {
  try {
    return importOpenApi(parseOpenApi(input));
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError((err as Error).message);
  }
}

export async function mockRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);
  const db = prisma as unknown as { mockApi: any };
  const hubDomain = () => process.env.HUB_DOMAIN ?? "vhyxvoid.com";

  async function member(request: FastifyRequest, accountId: string) {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({
      where: { userId_accountId: { userId: user.id, accountId } },
      select: { roleLevel: true, account: { select: { slug: true } } },
    });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return { level: m.roleLevel, slug: m.account.slug, userId: user.id };
  }
  async function admin(request: FastifyRequest, accountId: string) {
    const m = await member(request, accountId);
    if (m.level < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can change mock APIs");
    return m;
  }
  async function limits(accountId: string) {
    const [enabled, l] = await Promise.all([fastify.platformSettings.get("features.mockApis"), getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides())]);
    const fin = (n: number, cap: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : cap);
    return { enabled: Boolean(enabled), maxMocks: fin(l.maxMockApis, 10_000), maxEndpoints: fin(l.maxMockEndpoints, 1000), plan: l.plan };
  }
  const url = (slug: string | null, l: string) => (slug ? `https://${slug}--${l}.${hubDomain()}` : null);
  const summary = (r: Row, slug: string | null) => ({
    id: r.id,
    label: r.label,
    name: r.name,
    description: r.description,
    enabled: r.enabled,
    mode: r.mode,
    cors: r.cors,
    latencyMs: r.latencyMs,
    endpointCount: Array.isArray(r.endpoints) ? r.endpoints.length : 0,
    version: r.version,
    updatedAt: r.updatedAt,
    url: url(slug, r.label),
  });
  const full = (r: Row, slug: string | null) => ({ ...summary(r, slug), endpoints: Array.isArray(r.endpoints) ? r.endpoints : [], createdAt: r.createdAt });
  async function find(accountId: string, id: string): Promise<Row> {
    const row = (await db.mockApi.findFirst({ where: { id, accountId } })) as Row | null;
    if (!row) throw new NotFoundError("Mock API not found");
    return row;
  }
  const definitionOf = (r: Row): MockApiDefinition => ({ mode: r.mode, cors: r.cors, latencyMs: r.latencyMs, endpoints: (Array.isArray(r.endpoints) ? r.endpoints : []) as MockEndpoint[] });
  const invalidate = (accountId: string, l: string) => opts.hub.invalidatePolicy(accountId, l).catch(() => undefined);

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const m = await member(request, accountId);
    const [rows, lim] = await Promise.all([db.mockApi.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } }) as Promise<Row[]>, limits(accountId)]);
    return successResponse(reply, "Success", 200, {
      enabled: lim.enabled,
      maxMocks: lim.maxMocks,
      maxEndpoints: lim.maxEndpoints,
      canManage: m.level >= RoleLevel.ADMIN,
      templates: MOCK_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description })),
      mocks: rows.map((r) => summary(r, m.slug)),
    });
  });

  fastify.post("/:accountId", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = createBody.parse(request.body ?? {});
    const m = await admin(request, accountId);
    const lim = await limits(accountId);
    if (!lim.enabled) throw new ForbiddenError("Mock APIs are switched off on this platform right now");
    const count = await db.mockApi.count({ where: { accountId } });
    if (count >= lim.maxMocks) throw new PlanLimitExceededError({ limit: lim.maxMocks, current: count, limitKey: "maxMockApis", plan: lim.plan });

    let endpoints: MockEndpoint[];
    let description = body.description ?? "";
    if (body.openapi !== undefined) {
      const imported = importOrThrow(body.openapi);
      endpoints = imported.endpoints;
      description ||= imported.description;
    } else {
      const t = MOCK_TEMPLATES.find((x) => x.key === (body.template ?? "blank"));
      if (!t) throw new ValidationError(`Unknown template ${body.template}`);
      endpoints = t.endpoints();
    }
    const def: MockApiDefinition = { mode: body.mode ?? "ALWAYS", cors: true, latencyMs: 0, endpoints };
    const problem = mockDefinitionProblem(def, lim.maxEndpoints);
    if (problem) throw new ValidationError(problem);
    try {
      const row = (await db.mockApi.create({
        data: { accountId, label: body.label, name: body.name, description, mode: def.mode, cors: def.cors, latencyMs: 0, endpoints: endpoints as never, createdById: m.userId, updatedById: m.userId },
      })) as Row;
      await invalidate(accountId, row.label);
      return successResponse(reply, "Mock API created", 201, full(row, m.slug));
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError(`This workspace already has a mock API with the label "${body.label}"`);
      throw err;
    }
  });

  fastify.get("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const m = await member(request, accountId);
    const lim = await limits(accountId);
    return successResponse(reply, "Success", 200, { ...full(await find(accountId, id), m.slug), canManage: m.level >= RoleLevel.ADMIN, maxEndpoints: lim.maxEndpoints, enabledOnPlatform: lim.enabled });
  });

  fastify.put("/:accountId/:id", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = saveBody.parse(request.body ?? {});
    const m = await admin(request, accountId);
    const existing = await find(accountId, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== existing.version) {
      throw new ConflictError("Someone saved this mock after you opened it. Reload to see their version, then make your change again.");
    }
    const lim = await limits(accountId);
    const def: MockApiDefinition = {
      mode: body.mode ?? existing.mode,
      cors: body.cors ?? existing.cors,
      latencyMs: body.latencyMs ?? existing.latencyMs,
      endpoints: (body.endpoints ?? existing.endpoints) as MockEndpoint[],
    };
    const problem = mockDefinitionProblem(def, lim.maxEndpoints);
    if (problem) throw new ValidationError(problem);
    let row: Row;
    try {
      // The version check and the write are one statement, so two saves cannot both win.
      const res = await db.mockApi.updateMany({
        where: { id, accountId, version: existing.version },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          mode: def.mode,
          cors: def.cors,
          latencyMs: def.latencyMs,
          endpoints: def.endpoints as never,
          version: { increment: 1 },
          updatedById: m.userId,
        },
      });
      if (res.count === 0) throw new ConflictError("Someone saved this mock at the same moment. Reload and try again.");
      row = await find(accountId, id);
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError(`This workspace already has a mock API with the label "${body.label}"`);
      throw err;
    }
    await invalidate(accountId, existing.label);
    if (row.label !== existing.label) await invalidate(accountId, row.label);
    return successResponse(reply, "Mock API saved", 200, full(row, m.slug));
  });

  fastify.delete("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await admin(request, accountId);
    const row = await find(accountId, id);
    await db.mockApi.delete({ where: { id: row.id } });
    await invalidate(accountId, row.label);
    return successResponse(reply, "Mock API removed", 200, { id, label: row.label });
  });

  fastify.post("/:accountId/:id/import", { onRequest: [fastify.userAuthGuard], bodyLimit: 6 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = importBody.parse(request.body ?? {});
    const m = await admin(request, accountId);
    const existing = await find(accountId, id);
    const imported = importOrThrow(body.openapi);
    const current = (Array.isArray(existing.endpoints) ? existing.endpoints : []) as MockEndpoint[];
    // Append skips routes the mock already has (same method and path), so importing twice is harmless.
    const key = (e: MockEndpoint) => `${e.method} ${e.path}`;
    const have = new Set(current.map(key));
    const added = body.replace ? imported.endpoints : imported.endpoints.filter((e) => !have.has(key(e)));
    const endpoints = body.replace ? added : [...current, ...added];
    const lim = await limits(accountId);
    const problem = mockDefinitionProblem({ ...definitionOf(existing), endpoints }, lim.maxEndpoints);
    if (problem) throw new ValidationError(problem);
    const res = await db.mockApi.updateMany({
      where: { id, accountId, version: existing.version },
      data: { endpoints: endpoints as never, version: { increment: 1 }, updatedById: m.userId },
    });
    if (res.count === 0) throw new ConflictError("Someone saved this mock at the same moment. Reload and try again.");
    await invalidate(accountId, existing.label);
    const row = await find(accountId, id);
    return successResponse(reply, `Imported ${added.length} endpoint${added.length === 1 ? "" : "s"}`, 200, {
      mock: full(row, m.slug),
      added: added.length,
      skipped: imported.endpoints.length - added.length,
      warnings: imported.warnings,
    });
  });

  fastify.get("/:accountId/:id/openapi", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const { format } = z.object({ format: z.enum(["json", "yaml"]).default("json") }).parse(request.query);
    const m = await member(request, accountId);
    const row = await find(accountId, id);
    const doc = exportOpenApi(definitionOf(row), { title: row.name, description: row.description || undefined, serverUrl: url(m.slug, row.label) ?? undefined });
    const file = `${row.label}.openapi.${format}`;
    reply.header("content-disposition", `attachment; filename="${file}"`);
    if (format === "yaml") return reply.type("application/yaml; charset=utf-8").send(stringifyYaml(doc));
    return reply.type("application/json; charset=utf-8").send(JSON.stringify(doc, null, 2));
  });

  fastify.post("/:accountId/:id/try", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = tryBody.parse(request.body ?? {});
    await member(request, accountId);
    const row = await find(accountId, id);
    let def = definitionOf(row);
    if (body.definition) {
      const draft = { ...def, ...body.definition } as MockApiDefinition;
      const problem = mockDefinitionProblem(draft, 1000);
      if (problem) throw new ValidationError(problem);
      def = draft;
    }
    const headers = Object.fromEntries(Object.entries(body.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const answer = resolveMock(def, { method: body.method, url: body.path, headers, body: body.body }, { sequence: new Map() });
    return successResponse(reply, "Success", 200, answer ? { matched: true, ...answer } : { matched: false });
  });
}
