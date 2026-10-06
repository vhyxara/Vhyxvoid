// /api/v1/mocks — a workspace's hosted mock APIs (internal-tools/shared/api-platform-plan.md, phase 1).
//
//   GET    /:accountId                  list, plan limits, templates
//   POST   /:accountId                  create { label, name, template? | openapi? } (owners/admins; plan maxMockApis)
//   GET    /:accountId/:id              one mock with its endpoints
//   PUT    /:accountId/:id              save { name, description, label, enabled, mode, cors, latencyMs, endpoints, expectedVersion } (owners/admins)
//   DELETE /:accountId/:id              remove (owners/admins)
//   POST   /:accountId/:id/import       { document (or openapi): text|object, replace? } OpenAPI, Postman, Mockoon, HAR or VhyxVoid file (owners/admins)
//   GET    /:accountId/:id/openapi      OpenAPI 3 export (?format=yaml)
//   GET    /:accountId/:id/export       ?format=openapi|openapi-json|msw|postman|mockoon|vhyxvoid
//   POST   /:accountId/:id/record       { label, ids } endpoints from requests captured by the inspector (owners/admins)
//   GET    /:accountId/:id/data/:rid    a resource's current items (members)
//   DELETE /:accountId/:id/data/:rid    reset a resource to its seed (owners/admins)
//   POST   /:accountId/:id/try          { method, path, headers?, body?, definition? } what the mock answers (members;
//                                       resources answer from their live data, like the URL)
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
  RedisResourceStore,
  endpointsFromCaptures,
  exportMockoon,
  exportMsw,
  exportNative,
  exportPostman,
  importMockDocument,
  inspectorKeys,
  mockDefinitionProblem,
  mockHandles,
  mockLabelProblem,
  parseInspectedRequests,
  resolveMock,
  resolveResource,
  resourceHandles,
  resourceStoreKey,
  resourcesProblem,
  type CapturedExchange,
  type MockApiDefinition,
  type MockEndpoint,
  type MockImport,
  type MockResource,
  type ResourceRedis,
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
  /** Any supported document (OpenAPI, Postman, Mockoon, HAR, VhyxVoid export); "openapi" is the older name. */
  document: openapiInput.optional(),
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
  resources: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  /** The version the editor loaded; a newer save in between is refused (409). */
  expectedVersion: z.number().int().min(1).optional(),
});
const importBody = z
  .object({ document: openapiInput.optional(), openapi: openapiInput.optional(), replace: z.boolean().default(false) })
  .refine((b) => b.document !== undefined || b.openapi !== undefined, { message: "document is required" });
const recordBody = z.object({
  label: z.string().trim().min(1).max(63),
  /** Inspector entry ids to turn into endpoints. */
  ids: z.array(z.string().max(80)).min(1).max(200),
});
const exportQuery = z.object({ format: z.enum(["openapi", "openapi-json", "msw", "postman", "mockoon", "vhyxvoid"]).default("openapi") });
const dataParams = z.object({ accountId: z.string().uuid(), id: z.string().uuid(), rid: z.string().min(1).max(80) });
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
  resources: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Parses a document given as JSON or YAML text, or already parsed. */
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

function importOrThrow(input: string | Record<string, unknown>): MockImport {
  try {
    return importMockDocument(parseOpenApi(input));
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
    resourceCount: Array.isArray(r.resources) ? r.resources.length : 0,
    version: r.version,
    updatedAt: r.updatedAt,
    url: url(slug, r.label),
  });
  const full = (r: Row, slug: string | null) => ({ ...summary(r, slug), endpoints: Array.isArray(r.endpoints) ? r.endpoints : [], resources: Array.isArray(r.resources) ? r.resources : [], createdAt: r.createdAt });
  async function find(accountId: string, id: string): Promise<Row> {
    const row = (await db.mockApi.findFirst({ where: { id, accountId } })) as Row | null;
    if (!row) throw new NotFoundError("Mock API not found");
    return row;
  }
  const definitionOf = (r: Row): MockApiDefinition => ({
    id: r.id,
    mode: r.mode,
    cors: r.cors,
    latencyMs: r.latencyMs,
    endpoints: (Array.isArray(r.endpoints) ? r.endpoints : []) as MockEndpoint[],
    resources: (Array.isArray(r.resources) ? r.resources : []) as MockResource[],
  });
  const redis = (fastify as unknown as { redis?: ResourceRedis }).redis;
  const store = () => {
    if (!redis) throw new ValidationError("Resource data needs Redis, which is not configured");
    return new RedisResourceStore(redis);
  };
  /** Both the definition and the resources must pass; used on every write. */
  const problemOf = (def: MockApiDefinition, maxEndpoints: number) => mockDefinitionProblem(def, maxEndpoints) ?? resourcesProblem(def.resources);
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
    let resources: MockResource[] = [];
    let description = body.description ?? "";
    let settings: MockImport["settings"] = {};
    const doc = body.document ?? body.openapi;
    if (doc !== undefined) {
      const imported = importOrThrow(doc);
      endpoints = imported.endpoints;
      resources = imported.resources;
      settings = imported.settings ?? {};
      description ||= imported.description;
    } else {
      const t = MOCK_TEMPLATES.find((x) => x.key === (body.template ?? "blank"));
      if (!t) throw new ValidationError(`Unknown template ${body.template}`);
      endpoints = t.endpoints();
    }
    const def: MockApiDefinition = { mode: body.mode ?? settings?.mode ?? "ALWAYS", cors: settings?.cors ?? true, latencyMs: settings?.latencyMs ?? 0, endpoints, resources };
    const problem = problemOf(def, lim.maxEndpoints);
    if (problem) throw new ValidationError(problem);
    try {
      const row = (await db.mockApi.create({
        data: {
          accountId,
          label: body.label,
          name: body.name,
          description,
          mode: def.mode,
          cors: def.cors,
          latencyMs: def.latencyMs,
          endpoints: endpoints as never,
          resources: resources as never,
          createdById: m.userId,
          updatedById: m.userId,
        },
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
      resources: (body.resources ?? existing.resources ?? []) as MockResource[],
    };
    const problem = problemOf(def, lim.maxEndpoints);
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
          resources: def.resources as never,
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
    // The data goes too (it would expire after 30 idle days anyway).
    if (redis) for (const r of definitionOf(row).resources ?? []) await new RedisResourceStore(redis).reset(resourceStoreKey(row.id, r.id)).catch(() => undefined);
    return successResponse(reply, "Mock API removed", 200, { id, label: row.label });
  });

  fastify.post("/:accountId/:id/import", { onRequest: [fastify.userAuthGuard], bodyLimit: 6 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = importBody.parse(request.body ?? {});
    const m = await admin(request, accountId);
    const existing = await find(accountId, id);
    const imported = importOrThrow((body.document ?? body.openapi)!);
    const cur = definitionOf(existing);
    // Append skips routes and resource paths the mock already has, so importing twice is harmless.
    const key = (e: MockEndpoint) => `${e.method} ${e.path}`;
    const have = new Set(cur.endpoints.map(key));
    const havePaths = new Set((cur.resources ?? []).map((r) => r.path));
    const added = body.replace ? imported.endpoints : imported.endpoints.filter((e) => !have.has(key(e)));
    const addedResources = body.replace ? imported.resources : imported.resources.filter((r) => !havePaths.has(r.path));
    const endpoints = body.replace ? added : [...cur.endpoints, ...added];
    const resources = body.replace ? addedResources : [...(cur.resources ?? []), ...addedResources];
    const lim = await limits(accountId);
    const problem = problemOf({ ...cur, endpoints, resources }, lim.maxEndpoints);
    if (problem) throw new ValidationError(problem);
    const res = await db.mockApi.updateMany({
      where: { id, accountId, version: existing.version },
      data: { endpoints: endpoints as never, resources: resources as never, version: { increment: 1 }, updatedById: m.userId },
    });
    if (res.count === 0) throw new ConflictError("Someone saved this mock at the same moment. Reload and try again.");
    await invalidate(accountId, existing.label);
    const row = await find(accountId, id);
    return successResponse(reply, `Imported ${added.length} endpoint${added.length === 1 ? "" : "s"}`, 200, {
      mock: full(row, m.slug),
      format: imported.format,
      added: added.length,
      addedResources: addedResources.length,
      skipped: imported.endpoints.length - added.length + (imported.resources.length - addedResources.length),
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
    const mreq = { method: body.method, url: body.path, headers, body: body.body };
    // Endpoints win over resources, as at the hub. Resources use their live data.
    const answer = mockHandles(def, mreq)
      ? resolveMock(def, mreq, { sequence: new Map() })
      : resourceHandles(def, mreq)
        ? await resolveResource(def, mreq, store(), { mockId: row.id })
        : null;
    return successResponse(reply, "Success", 200, answer ? { matched: true, ...answer } : { matched: false });
  });

  fastify.get("/:accountId/:id/export", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const { format } = exportQuery.parse(request.query);
    const m = await member(request, accountId);
    const row = await find(accountId, id);
    const def = definitionOf(row);
    const base = url(m.slug, row.label) ?? undefined;
    const meta = { name: row.name, title: row.name, description: row.description || undefined, serverUrl: base, baseUrl: base };
    const send = (file: string, type: string, body: string) => {
      reply.header("content-disposition", `attachment; filename="${file}"`);
      return reply.type(type).send(body);
    };
    switch (format) {
      case "openapi":
        return send(`${row.label}.openapi.yaml`, "application/yaml; charset=utf-8", stringifyYaml(exportOpenApi(def, meta)));
      case "openapi-json":
        return send(`${row.label}.openapi.json`, "application/json; charset=utf-8", JSON.stringify(exportOpenApi(def, meta), null, 2));
      case "msw":
        return send(`${row.label}.handlers.ts`, "text/plain; charset=utf-8", exportMsw(def, { name: row.name, baseUrl: base }));
      case "postman":
        return send(`${row.label}.postman_collection.json`, "application/json; charset=utf-8", JSON.stringify(exportPostman(def, meta), null, 2));
      case "mockoon":
        return send(`${row.label}.mockoon.json`, "application/json; charset=utf-8", JSON.stringify(exportMockoon(def, { name: row.name }), null, 2));
      case "vhyxvoid":
        return send(`${row.label}.vhyxvoid-mock.json`, "application/json; charset=utf-8", JSON.stringify(exportNative(def, { name: row.name, description: row.description || undefined }), null, 2));
    }
  });

  fastify.post("/:accountId/:id/record", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = recordBody.parse(request.body ?? {});
    const m = await admin(request, accountId);
    const existing = await find(accountId, id);
    if (!redis) throw new ValidationError("Recording needs the request inspector, which is not configured");
    const entries = parseInspectedRequests(await (redis as unknown as { lrange(k: string, a: number, b: number): Promise<unknown[]> }).lrange(inspectorKeys.list(accountId, body.label), 0, -1));
    const wanted = new Set(body.ids);
    const picked = entries.filter((e) => wanted.has(e.id) && e.response);
    if (!picked.length) throw new ValidationError("None of those captured requests are still kept (captures last 24 hours)");
    const captures: CapturedExchange[] = picked.map((e) => ({
      method: e.method,
      path: e.path,
      status: e.response!.status,
      responseHeaders: e.response!.headers,
      responseBody: e.response!.body.encoding === "base64" ? null : e.response!.body.data,
      truncated: e.response!.body.truncated,
    }));
    const { endpoints: recorded, warnings } = endpointsFromCaptures(captures);
    const cur = definitionOf(existing);
    const key = (e: MockEndpoint) => `${e.method} ${e.path}`;
    const have = new Set(cur.endpoints.map(key));
    const added = recorded.filter((e) => !have.has(key(e)));
    const endpoints = [...cur.endpoints, ...added];
    const lim = await limits(accountId);
    const problem = problemOf({ ...cur, endpoints }, lim.maxEndpoints);
    if (problem) throw new ValidationError(problem);
    const res = await db.mockApi.updateMany({
      where: { id, accountId, version: existing.version },
      data: { endpoints: endpoints as never, version: { increment: 1 }, updatedById: m.userId },
    });
    if (res.count === 0) throw new ConflictError("Someone saved this mock at the same moment. Reload and try again.");
    await invalidate(accountId, existing.label);
    const row = await find(accountId, id);
    return successResponse(reply, `Recorded ${added.length} endpoint${added.length === 1 ? "" : "s"}`, 200, {
      mock: full(row, m.slug),
      added: added.length,
      skipped: recorded.length - added.length,
      warnings,
    });
  });

  fastify.get("/:accountId/:id/data/:rid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id, rid } = dataParams.parse(request.params);
    await member(request, accountId);
    const row = await find(accountId, id);
    const resource = definitionOf(row).resources?.find((r) => r.id === rid);
    if (!resource) throw new NotFoundError("Resource not found (save the mock first if you just added it)");
    const s = store();
    const k = resourceStoreKey(row.id, resource.id);
    // Same seeding the URL does, so the first look shows the seed.
    const answer = await resolveResource({ ...definitionOf(row), resources: [{ ...resource, enabled: true }], cors: false, latencyMs: 0 }, { method: "GET", url: resource.path, headers: {} }, s, { mockId: row.id });
    const items = answer ? JSON.parse(answer.body || "[]") : [];
    return successResponse(reply, "Success", 200, { resourceId: resource.id, items, count: await s.count(k) });
  });

  fastify.delete("/:accountId/:id/data/:rid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id, rid } = dataParams.parse(request.params);
    await admin(request, accountId);
    const row = await find(accountId, id);
    const resource = definitionOf(row).resources?.find((r) => r.id === rid);
    if (!resource) throw new NotFoundError("Resource not found");
    await store().reset(resourceStoreKey(row.id, resource.id));
    return successResponse(reply, `${resource.name} reset to its seed data`, 200, { resourceId: resource.id });
  });
}
