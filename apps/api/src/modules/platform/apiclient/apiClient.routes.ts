// /api/v1/api-client — collections, environments, sending and test runs
// (internal-tools/shared/api-platform-plan.md, phase 3). Every member can use
// the API client; it is a team tool, like the inspector.
//
//   GET    /:accountId                              overview: limits, collections, environments (secrets masked)
//   POST   /:accountId/collections                  { name } | { document } | { mockId } (plan maxApiCollections)
//   GET    /:accountId/collections/:id              one collection
//   PUT    /:accountId/collections/:id              { name?, description?, auth?, variables?, folders?, requests?, expectedVersion? }
//   DELETE /:accountId/collections/:id
//   GET    /:accountId/collections/:id/export       ?format=vhyxvoid|postman (&environmentId= adds it, secrets empty)
//   POST   /:accountId/collections/:id/run          { environmentId?, folderId?, requestIds?, bail?, runtime? } 202 { id }: runs in the background
//   GET    /:accountId/collections/:id/runs         the latest runs (no report)
//   GET    /:accountId/runs/:runId                  one run: status running | done | failed, and its report when done
//   POST   /:accountId/environments                 { name, variables }
//   PUT    /:accountId/environments/:id             { name?, variables?, expectedVersion? } (secret + keep: true keeps the stored value)
//   DELETE /:accountId/environments/:id
//   POST   /:accountId/parse                        { document } curl / Postman / OpenAPI / HAR / VhyxVoid -> collection (not saved)
//   POST   /:accountId/send                         { request, collectionId?, collection?, environmentId?, runtime? } send it now
//   POST   /:accountId/snippet                      { request, lang, ... } code with secrets kept as {{name}}
//   GET    /:accountId/history                      my latest sends
//   GET    /:accountId/history/:hid                 one, with the request to open again and the response
//   DELETE /:accountId/history                      clear mine
//
// Sending goes through runner.ts (public addresses only). Each request sent,
// in a run too, counts against apiClientSendsPerMinute.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { AppError } from "@/core/errors/app-error";
import { ConflictError, ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  API_CLIENT_BOUNDS,
  SNIPPET_LANGUAGES,
  SendError,
  apiCollectionProblem,
  apiRequestProblem,
  apiVariablesProblem,
  applyCaptures,
  buildRequest,
  codeSnippet,
  collectionFromMock,
  currentPlanOverrides,
  evaluateAssertions,
  exportPostmanCollection,
  getEffectivePlanLimitsForAccount,
  importApiCollection,
  makeScope,
  nativeCollectionFile,
  runCollection,
  type ApiAuth,
  type ApiCollection,
  type ApiFolder,
  type ApiRequest,
  type ApiResponse,
  type ApiVariable,
  type ImportedCollection,
  type MockApiDefinition,
  type SnippetLanguage,
} from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import { guardedSend } from "./runner";
import { decryptSecret, encryptSecret } from "./secrets";

const params = z.object({ accountId: z.string().uuid() });
const idParams = params.extend({ id: z.string().uuid() });
const runParams = params.extend({ runId: z.string().uuid() });
const historyParams = params.extend({ hid: z.string().uuid() });

const json = z.record(z.string(), z.unknown());
const documentInput = z.union([z.string().min(2).max(10_000_000), json]);
const variablesInput = z.array(z.object({ key: z.string(), value: z.string(), enabled: z.boolean().default(true), secret: z.boolean().optional(), keep: z.boolean().optional() })).max(API_CLIENT_BOUNDS.variables);

const createBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(2000).optional(),
  /** curl, Postman, OpenAPI (JSON or YAML), HAR or a VhyxVoid collection file. */
  document: documentInput.optional(),
  /** Make a test collection for one of the workspace's mock APIs. */
  mockId: z.string().uuid().optional(),
});
const saveBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(2000).optional(),
  auth: json.optional(),
  variables: z.array(json).max(API_CLIENT_BOUNDS.variables).optional(),
  folders: z.array(json).max(API_CLIENT_BOUNDS.folders).optional(),
  requests: z.array(json).max(5000).optional(),
  expectedVersion: z.number().int().min(1).optional(),
});
const envBody = z.object({ name: z.string().trim().min(1).max(80), variables: variablesInput.default([]) });
const envSaveBody = z.object({ name: z.string().trim().min(1).max(80).optional(), variables: variablesInput.optional(), expectedVersion: z.number().int().min(1).optional() });
const contextFields = {
  /** Saved collection whose variables and auth apply. */
  collectionId: z.string().uuid().optional(),
  /** Unsaved variables and auth from the editor (win over the saved collection's). */
  collection: z.object({ variables: z.array(json).max(API_CLIENT_BOUNDS.variables).optional(), auth: json.optional() }).optional(),
  environmentId: z.string().uuid().nullable().optional(),
  /** Values captured earlier in this session; highest priority. */
  runtime: z.record(z.string(), z.string().max(API_CLIENT_BOUNDS.valueLength)).optional(),
};
const sendBody = z.object({
  request: json,
  ...contextFields,
  followRedirects: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(API_CLIENT_BOUNDS.maxTimeoutMs).optional(),
  /** Keep it out of my history. */
  noHistory: z.boolean().default(false),
});
const snippetBody = z.object({ request: json, lang: z.enum(SNIPPET_LANGUAGES.map((l) => l.id) as [SnippetLanguage, ...SnippetLanguage[]]), ...contextFields });
const runBody = z.object({
  environmentId: z.string().uuid().nullable().optional(),
  folderId: z.string().max(64).nullable().optional(),
  requestIds: z.array(z.string().max(64)).max(5000).optional(),
  bail: z.boolean().default(false),
  runtime: z.record(z.string(), z.string().max(API_CLIENT_BOUNDS.valueLength)).optional(),
});
const exportQuery = z.object({ format: z.enum(["vhyxvoid", "postman"]).default("vhyxvoid"), environmentId: z.string().uuid().optional() });

const HISTORY_KEEP = 200;
const RUNS_KEEP = 50;
const RUN_DEADLINE_MS = 120_000;
/** How long after its deadline a run still marked running is treated as interrupted. */
const RUN_GRACE_MS = 5 * 60_000;
const HISTORY_BODY_BYTES = 64 * 1024;

type CollectionRow = { id: string; accountId: string; name: string; description: string; auth: unknown; variables: unknown; folders: unknown; requests: unknown; version: number; createdAt: Date; updatedAt: Date };
type EnvRow = { id: string; accountId: string; name: string; variables: unknown; version: number; updatedAt: Date };
type StoredVar = ApiVariable;

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function parseDocument(input: string | Record<string, unknown>): unknown {
  if (typeof input !== "string") return input;
  const t = input.trim();
  if (/^curl(\.exe)?\s/i.test(t)) return t;
  try {
    return JSON.parse(t);
  } catch {
    try {
      return parseYaml(t, { maxAliasCount: 100 });
    } catch (err) {
      throw new ValidationError(`Could not read the document as JSON, YAML or a curl command: ${(err as Error).message.split("\n")[0]}`);
    }
  }
}

function importOrThrow(input: string | Record<string, unknown>): ImportedCollection {
  try {
    return importApiCollection(parseDocument(input));
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError((err as Error).message);
  }
}

/** A JSON-safe response summary for history (body cut). */
function historyResponse(r: ApiResponse) {
  const cut = r.body.length > HISTORY_BODY_BYTES;
  return { status: r.status, statusText: r.statusText, headers: r.headers, body: cut ? r.body.slice(0, HISTORY_BODY_BYTES) : r.body, bodyEncoding: r.bodyEncoding, size: r.size, truncated: r.truncated || cut, timings: r.timings, httpVersion: r.httpVersion, remoteAddress: r.remoteAddress };
}

export async function apiClientRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const db = prisma as unknown as { apiCollection: any; apiEnvironment: any; apiRequestHistory: any; apiTestRun: any; mockApi: any; accountMember: any };
  const hubDomain = () => process.env.HUB_DOMAIN ?? "vhyxvoid.com";

  async function member(request: FastifyRequest, accountId: string) {
    const user = getUserContext(request);
    const m = await db.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true, account: { select: { slug: true } } } });
    if (!m || m.roleLevel < RoleLevel.MEMBER) throw new ForbiddenError("You do not have access to this account");
    return { level: m.roleLevel as number, slug: m.account.slug as string | null, userId: user.id };
  }
  async function limits(accountId: string) {
    const [enabled, l] = await Promise.all([fastify.platformSettings.get("features.apiClient"), getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides())]);
    const fin = (n: number, cap: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : cap);
    return { enabled: Boolean(enabled), maxCollections: fin(l.maxApiCollections, 100_000), maxRequests: fin(l.maxApiCollectionRequests, 5000), sendsPerMinute: fin(l.apiClientSendsPerMinute, 100_000), plan: l.plan };
  }
  async function usable(accountId: string) {
    const lim = await limits(accountId);
    if (!lim.enabled) throw new ForbiddenError("The API client is switched off on this platform right now");
    if (lim.maxCollections === 0) throw new ForbiddenError("The API client isn't included in your plan");
    return lim;
  }

  // ── Per-account send budget (Redis when there is one, else this process) ──
  const redis = (fastify as unknown as { redis?: { incr(k: string): Promise<number>; expire(k: string, s: number): Promise<unknown> } }).redis;
  const local = new Map<string, { minute: number; n: number }>();
  async function takeSend(accountId: string, perMinute: number): Promise<boolean> {
    const minute = Math.floor(Date.now() / 60_000);
    if (redis) {
      try {
        const k = `apiclient:sends:${accountId}:${minute}`;
        const n = await redis.incr(k);
        if (n === 1) await redis.expire(k, 120);
        return n <= perMinute;
      } catch {
        /* fall through to the local counter */
      }
    }
    const cur = local.get(accountId);
    if (!cur || cur.minute !== minute) local.set(accountId, { minute, n: 1 });
    else cur.n++;
    return (local.get(accountId)!.n) <= perMinute;
  }
  const rateMessage = (perMinute: number) => `Your plan sends up to ${perMinute} requests a minute from the API client; wait a moment and try again`;

  // ── Rows ──
  const collectionOf = (r: CollectionRow): ApiCollection => ({
    name: r.name,
    description: r.description,
    auth: (r.auth as ApiAuth) ?? { type: "none" },
    variables: arr<ApiVariable>(r.variables),
    folders: arr<ApiFolder>(r.folders),
    requests: arr<ApiRequest>(r.requests),
  });
  const collectionSummary = (r: CollectionRow) => ({ id: r.id, name: r.name, description: r.description, requestCount: arr(r.requests).length, folderCount: arr(r.folders).length, version: r.version, updatedAt: r.updatedAt });
  const collectionFull = (r: CollectionRow) => ({ ...collectionSummary(r), ...collectionOf(r), createdAt: r.createdAt });
  /** What the dashboard sees: secret values never leave the server. */
  const envPublic = (r: EnvRow) => ({ id: r.id, name: r.name, version: r.version, updatedAt: r.updatedAt, variables: arr<StoredVar>(r.variables).map((v) => (v.secret ? { key: v.key, value: "", enabled: v.enabled, secret: true, hasValue: v.value !== "" } : { key: v.key, value: v.value, enabled: v.enabled })) });
  const envValues = (r: EnvRow | null): ApiVariable[] => (r ? arr<StoredVar>(r.variables).map((v) => (v.secret ? { ...v, value: decryptSecret(v.value) } : v)) : []);

  async function findCollection(accountId: string, id: string): Promise<CollectionRow> {
    const row = await db.apiCollection.findFirst({ where: { id, accountId } });
    if (!row) throw new NotFoundError("Collection not found");
    return row;
  }
  async function findEnv(accountId: string, id: string | null | undefined): Promise<EnvRow | null> {
    if (!id) return null;
    const row = await db.apiEnvironment.findFirst({ where: { id, accountId } });
    if (!row) throw new NotFoundError("Environment not found");
    return row;
  }

  /** Incoming variables -> stored: secrets encrypted, `keep` reuses the stored value. */
  function storeVariables(incoming: z.infer<typeof variablesInput>, existing: StoredVar[]): StoredVar[] {
    const problem = apiVariablesProblem(incoming.map(({ keep: _k, ...v }) => v));
    if (problem) throw new ValidationError(problem);
    return incoming.map((v) => {
      if (!v.secret) return { key: v.key, value: v.value, enabled: v.enabled };
      if (v.keep && v.value === "") {
        const prev = existing.find((e) => e.key === v.key);
        if (prev?.secret) return { key: v.key, value: prev.value, enabled: v.enabled, secret: true };
        if (prev) return { key: v.key, value: prev.value ? encryptSecret(prev.value) : "", enabled: v.enabled, secret: true };
      }
      return { key: v.key, value: v.value ? encryptSecret(v.value) : "", enabled: v.enabled, secret: true };
    });
  }

  /** Collection layer for a send/snippet: the editor's unsaved values win over the saved collection. */
  async function context(accountId: string, body: { collectionId?: string; collection?: { variables?: unknown[]; auth?: unknown }; environmentId?: string | null; runtime?: Record<string, string> }) {
    let variables: ApiVariable[] = [];
    let auth: ApiAuth = { type: "none" };
    if (body.collectionId) {
      const c = collectionOf(await findCollection(accountId, body.collectionId));
      variables = c.variables;
      auth = c.auth;
    }
    if (body.collection?.variables) {
      const p = apiVariablesProblem(body.collection.variables);
      if (p) throw new ValidationError(p);
      variables = body.collection.variables as ApiVariable[];
    }
    if (body.collection?.auth) auth = body.collection.auth as ApiAuth;
    const env = await findEnv(accountId, body.environmentId);
    // Values captured in the session (often tokens) are treated as secrets: kept as {{name}} in code and the sent view.
    const runtime = Object.entries(body.runtime ?? {}).map(([key, value]) => ({ key, value, enabled: true, secret: true }));
    return { variables, auth, env, envVars: envValues(env), runtime };
  }

  function checkedRequest(raw: Record<string, unknown>): ApiRequest {
    const req = { assertions: [], captures: [], params: [], headers: [], auth: { type: "inherit" }, body: { type: "none" }, name: "Request", id: "q_unsaved", ...raw } as unknown as ApiRequest;
    const p = apiRequestProblem(req);
    if (p) throw new ValidationError(p);
    return req;
  }

  // ── Overview ──
  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "collections:read" } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    await member(request, accountId);
    const [collections, environments, lim] = await Promise.all([
      db.apiCollection.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } }) as Promise<CollectionRow[]>,
      db.apiEnvironment.findMany({ where: { accountId }, orderBy: { name: "asc" } }) as Promise<EnvRow[]>,
      limits(accountId),
    ]);
    return successResponse(reply, "Success", 200, {
      enabled: lim.enabled,
      maxCollections: lim.maxCollections,
      maxRequests: lim.maxRequests,
      sendsPerMinute: lim.sendsPerMinute,
      maxEnvironments: API_CLIENT_BOUNDS.environments,
      snippetLanguages: SNIPPET_LANGUAGES,
      collections: collections.map(collectionSummary),
      environments: environments.map(envPublic),
    });
  });

  // ── Collections ──
  fastify.post("/:accountId/collections", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "tests:run", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = createBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    const lim = await usable(accountId);
    const count = await db.apiCollection.count({ where: { accountId } });
    if (count >= lim.maxCollections) throw new PlanLimitExceededError({ limit: lim.maxCollections, current: count, limitKey: "maxApiCollections", plan: lim.plan });

    let collection: ApiCollection;
    let warnings: string[] = [];
    let environments: ImportedCollection["environments"] = [];
    if (body.document !== undefined) {
      const imp = importOrThrow(body.document);
      collection = imp.collection;
      warnings = imp.warnings;
      environments = imp.environments;
    } else if (body.mockId) {
      const mock = await db.mockApi.findFirst({ where: { id: body.mockId, accountId } });
      if (!mock) throw new NotFoundError("Mock API not found");
      const def: MockApiDefinition = { mode: mock.mode, cors: mock.cors, latencyMs: mock.latencyMs, endpoints: arr(mock.endpoints), resources: arr(mock.resources) };
      collection = collectionFromMock(def, { name: `${mock.name} tests`, baseUrl: m.slug ? `https://${m.slug}--${mock.label}.${hubDomain()}` : "https://example.com" });
    } else {
      collection = { name: body.name ?? "New collection", description: "", auth: { type: "none" }, variables: [{ key: "baseUrl", value: "https://api.example.com", enabled: true }], folders: [], requests: [] };
    }
    if (body.name) collection.name = body.name;
    if (body.description !== undefined) collection.description = body.description;
    const problem = apiCollectionProblem(collection, lim.maxRequests);
    if (problem) throw new ValidationError(problem);
    const row = (await db.apiCollection.create({
      data: { accountId, name: collection.name, description: collection.description ?? "", auth: collection.auth as never, variables: collection.variables as never, folders: collection.folders as never, requests: collection.requests as never, createdById: m.userId, updatedById: m.userId },
    })) as CollectionRow;
    // Environments that came with a VhyxVoid file are added when the name is free.
    const createdEnvs: string[] = [];
    for (const e of environments.slice(0, 10)) {
      if ((await db.apiEnvironment.count({ where: { accountId } })) >= API_CLIENT_BOUNDS.environments) break;
      try {
        const vars = storeVariables(e.variables.map((v) => ({ key: v.key, value: v.value, enabled: v.enabled !== false, secret: v.secret })), []);
        await db.apiEnvironment.create({ data: { accountId, name: e.name, variables: vars as never, createdById: m.userId, updatedById: m.userId } });
        createdEnvs.push(e.name);
      } catch {
        warnings.push(`Environment "${e.name}" was not added (the name is taken or its variables are invalid)`);
      }
    }
    return successResponse(reply, "Collection created", 201, { ...collectionFull(row), warnings, environmentsCreated: createdEnvs });
  });

  fastify.get("/:accountId/collections/:id", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "collections:read" } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await member(request, accountId);
    const lim = await limits(accountId);
    return successResponse(reply, "Success", 200, { ...collectionFull(await findCollection(accountId, id)), maxRequests: lim.maxRequests });
  });

  fastify.put("/:accountId/collections/:id", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "tests:run", rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = saveBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    const existing = await findCollection(accountId, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== existing.version) throw new ConflictError("Someone saved this collection after you opened it. Reload to see their version, then make your change again.");
    const lim = await limits(accountId);
    const next: ApiCollection = {
      ...collectionOf(existing),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.auth ? { auth: body.auth as unknown as ApiAuth } : {}),
      ...(body.variables ? { variables: body.variables as unknown as ApiVariable[] } : {}),
      ...(body.folders ? { folders: body.folders as unknown as ApiFolder[] } : {}),
      ...(body.requests ? { requests: body.requests as unknown as ApiRequest[] } : {}),
    };
    const problem = apiCollectionProblem(next, lim.maxRequests);
    if (problem) throw new ValidationError(problem);
    const updated = await db.apiCollection.updateMany({
      where: { id, accountId, version: existing.version },
      data: { name: next.name, description: next.description ?? "", auth: next.auth as never, variables: next.variables as never, folders: next.folders as never, requests: next.requests as never, version: { increment: 1 }, updatedById: m.userId },
    });
    if (updated.count === 0) throw new ConflictError("Someone saved this collection at the same moment. Reload and try again.");
    return successResponse(reply, "Collection saved", 200, collectionFull(await findCollection(accountId, id)));
  });

  fastify.delete("/:accountId/collections/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await member(request, accountId);
    await findCollection(accountId, id);
    await db.apiCollection.delete({ where: { id } });
    return successResponse(reply, "Collection deleted", 200, { id });
  });

  fastify.get("/:accountId/collections/:id/export", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "collections:read" } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const q = exportQuery.parse(request.query ?? {});
    await member(request, accountId);
    const row = await findCollection(accountId, id);
    const col = collectionOf(row);
    const env = await findEnv(accountId, q.environmentId);
    const slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "collection";
    const doc = q.format === "postman" ? exportPostmanCollection(col) : nativeCollectionFile(col, env ? [{ name: env.name, variables: arr<StoredVar>(env.variables).map((v) => (v.secret ? { ...v, value: "" } : v)) }] : []);
    reply.header("content-disposition", `attachment; filename="${slug}.${q.format === "postman" ? "postman_collection" : "vhyxvoid"}.json"`);
    return reply.type("application/json").send(JSON.stringify(doc, null, 2));
  });

  // ── Running ──
  // A run can take up to RUN_DEADLINE_MS, longer than a proxy waits for one
  // response (Cloudflare cuts proxied requests at 100 s), so it is started
  // here and finishes in the background; the run row is the job. Clients poll
  // GET /runs/:runId until its status is no longer "running".
  fastify.post("/:accountId/collections/:id/run", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "tests:run", rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = runBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    const lim = await usable(accountId);
    const row = await findCollection(accountId, id);
    const env = await findEnv(accountId, body.environmentId);
    const started = await db.apiTestRun.create({
      data: {
        accountId,
        collectionId: id,
        environmentId: env?.id ?? null,
        environmentName: env?.name ?? null,
        // A run started with an API key comes from CI, a script or the editor.
        trigger: request.apiKey ? "api" : "dashboard",
        status: "running",
        total: 0,
        passed: 0,
        failed: 0,
        errored: 0,
        durationMs: 0,
        createdById: m.userId,
      },
    });
    void (async () => {
      let rateLimited = false;
      try {
        const report = await runCollection({
          collection: collectionOf(row),
          environment: envValues(env),
          environmentName: env?.name,
          overrides: body.runtime,
          folderId: body.folderId ?? undefined,
          requestIds: body.requestIds,
          bail: body.bail,
          deadlineMs: RUN_DEADLINE_MS,
          beforeEach: async () => ((await takeSend(accountId, lim.sendsPerMinute)) ? null : ((rateLimited = true), `Rate limit reached: ${lim.sendsPerMinute} sends a minute on your plan`)),
          send: (built) => guardedSend(built, { timeoutMs: API_CLIENT_BOUNDS.timeoutMs, maxBytes: 1_000_000, followRedirects: 0 }),
        });
        await db.apiTestRun.update({
          where: { id: started.id },
          data: {
            status: "done",
            rateLimited,
            total: report.total,
            passed: report.passed,
            failed: report.failed,
            errored: report.errored,
            skipped: report.skipped,
            assertionsPassed: report.assertions.passed,
            assertionsFailed: report.assertions.failed,
            durationMs: report.durationMs,
            report: report as never,
          },
        });
      } catch (err) {
        request.log.error({ err }, "[api-client] run failed");
        await db.apiTestRun.update({ where: { id: started.id }, data: { status: "failed", error: "The run stopped unexpectedly; try again" } }).catch(() => undefined);
      }
      await pruneRuns(id);
    })();
    return successResponse(reply, "Run started", 202, { id: started.id, status: "running", createdAt: started.createdAt });
  });

  async function pruneRuns(collectionId: string) {
    try {
      const old = await db.apiTestRun.findMany({ where: { collectionId }, orderBy: { createdAt: "desc" }, skip: RUNS_KEEP, select: { id: true } });
      if (old.length) await db.apiTestRun.deleteMany({ where: { id: { in: old.map((o: { id: string }) => o.id) } } });
    } catch (err) {
      fastify.log.warn({ err }, "[api-client] pruning runs failed");
    }
  }

  /** A run still "running" long after its deadline was cut off by a restart of the API instance running it. */
  const runStatus = (r: { status: string; error?: string | null; createdAt: Date }) =>
    r.status === "running" && Date.now() - new Date(r.createdAt).getTime() > RUN_DEADLINE_MS + RUN_GRACE_MS
      ? { status: "failed", error: "The run was interrupted (the server restarted); run it again" }
      : { status: r.status, error: r.error ?? null };
  const runSummary = (r: any) => ({ id: r.id, collectionId: r.collectionId, environmentName: r.environmentName, trigger: r.trigger, ...runStatus(r), rateLimited: r.rateLimited, total: r.total, passed: r.passed, failed: r.failed, errored: r.errored, skipped: r.skipped, assertionsPassed: r.assertionsPassed, assertionsFailed: r.assertionsFailed, durationMs: r.durationMs, createdAt: r.createdAt, createdById: r.createdById });

  fastify.get("/:accountId/collections/:id/runs", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "collections:read" } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await member(request, accountId);
    await findCollection(accountId, id);
    const rows = await db.apiTestRun.findMany({ where: { collectionId: id, accountId }, orderBy: { createdAt: "desc" }, take: RUNS_KEEP });
    return successResponse(reply, "Success", 200, { runs: rows.map(runSummary) });
  });

  fastify.get("/:accountId/runs/:runId", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "collections:read" } }, async (request, reply) => {
    const { accountId, runId } = runParams.parse(request.params);
    await member(request, accountId);
    const row = await db.apiTestRun.findFirst({ where: { id: runId, accountId } });
    if (!row) throw new NotFoundError("Run not found");
    return successResponse(reply, "Success", 200, { ...runSummary(row), report: row.report });
  });

  // ── Environments ──
  fastify.post("/:accountId/environments", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = envBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    await usable(accountId);
    const count = await db.apiEnvironment.count({ where: { accountId } });
    if (count >= API_CLIENT_BOUNDS.environments) throw new ValidationError(`A workspace can have up to ${API_CLIENT_BOUNDS.environments} environments`);
    try {
      const row = await db.apiEnvironment.create({ data: { accountId, name: body.name, variables: storeVariables(body.variables, []) as never, createdById: m.userId, updatedById: m.userId } });
      return successResponse(reply, "Environment created", 201, envPublic(row));
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError(`There is already an environment called "${body.name}"`);
      throw err;
    }
  });

  fastify.put("/:accountId/environments/:id", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = envSaveBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    const existing = (await findEnv(accountId, id))!;
    if (body.expectedVersion !== undefined && body.expectedVersion !== existing.version) throw new ConflictError("Someone saved this environment after you opened it. Reload and make your change again.");
    const variables = body.variables ? storeVariables(body.variables, arr<StoredVar>(existing.variables)) : arr<StoredVar>(existing.variables);
    try {
      const updated = await db.apiEnvironment.updateMany({ where: { id, accountId, version: existing.version }, data: { name: body.name ?? existing.name, variables: variables as never, version: { increment: 1 }, updatedById: m.userId } });
      if (updated.count === 0) throw new ConflictError("Someone saved this environment at the same moment. Reload and try again.");
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError(`There is already an environment called "${body.name}"`);
      throw err;
    }
    return successResponse(reply, "Environment saved", 200, envPublic((await findEnv(accountId, id))!));
  });

  fastify.delete("/:accountId/environments/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await member(request, accountId);
    await findEnv(accountId, id);
    await db.apiEnvironment.delete({ where: { id } });
    return successResponse(reply, "Environment deleted", 200, { id });
  });

  // ── Parse (import into the open collection) ──
  fastify.post("/:accountId/parse", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "tests:run", rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = z.object({ document: documentInput }).parse(request.body ?? {});
    await member(request, accountId);
    return successResponse(reply, "Success", 200, importOrThrow(body.document));
  });

  // ── Send ──
  fastify.post("/:accountId/send", { onRequest: [fastify.userAuthGuard], bodyLimit: 12 * 1024 * 1024, config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = sendBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    const lim = await usable(accountId);
    const req = checkedRequest(body.request);
    const ctx = await context(accountId, body);
    const layers = [ctx.variables, ctx.envVars, ctx.runtime];
    const built = buildRequest(req, makeScope(layers), { collectionAuth: ctx.auth });
    const masked = buildRequest(req, makeScope(layers, "mask"), { collectionAuth: ctx.auth });
    const shown = { method: masked.method, url: masked.url, headers: masked.headers, body: masked.bodyPreview?.slice(0, HISTORY_BODY_BYTES) };
    if (built.problems.length) return successResponse(reply, "Not sent", 200, { sent: false, problems: built.problems, warnings: built.warnings, missing: built.missing, request: shown });
    if (!(await takeSend(accountId, lim.sendsPerMinute))) throw new AppError(rateMessage(lim.sendsPerMinute), 429, "RATE_LIMITED");

    let response: ApiResponse | null = null;
    let error: { code: string; message: string } | null = null;
    try {
      response = await guardedSend(built, { timeoutMs: body.timeoutMs ?? API_CLIENT_BOUNDS.timeoutMs, maxBytes: API_CLIENT_BOUNDS.responseBytes, followRedirects: body.followRedirects ? API_CLIENT_BOUNDS.redirects : 0 });
    } catch (err) {
      error = { code: err instanceof SendError ? err.code : "ERROR", message: (err as Error).message };
    }
    const assertions = response ? evaluateAssertions(req.assertions, response, makeScope(layers)) : [];
    const captures = response ? applyCaptures(req.captures, response) : [];
    let historyId: string | null = null;
    if (!body.noHistory) {
      try {
        const h = await db.apiRequestHistory.create({
          data: { accountId, userId: m.userId, method: built.method, url: masked.url.slice(0, 4000), status: response?.status ?? null, durationMs: response ? Math.round(response.timings.total) : null, size: response?.size ?? null, error: error?.message.slice(0, 500) ?? null, request: req as never, response: response ? (historyResponse(response) as never) : undefined },
        });
        historyId = h.id;
        void pruneHistory(accountId, m.userId);
      } catch (err) {
        fastify.log.warn({ err }, "[api-client] history not saved");
      }
    }
    return successResponse(reply, error ? "Request failed" : "Sent", 200, { sent: true, response, error, assertions, captures, warnings: built.warnings, missing: built.missing, request: shown, historyId });
  });

  async function pruneHistory(accountId: string, userId: string) {
    try {
      const old = await db.apiRequestHistory.findMany({ where: { accountId, userId }, orderBy: { createdAt: "desc" }, skip: HISTORY_KEEP, select: { id: true } });
      if (old.length) await db.apiRequestHistory.deleteMany({ where: { id: { in: old.map((o: { id: string }) => o.id) } } });
    } catch (err) {
      fastify.log.warn({ err }, "[api-client] pruning history failed");
    }
  }

  fastify.post("/:accountId/snippet", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = snippetBody.parse(request.body ?? {});
    await member(request, accountId);
    const req = checkedRequest(body.request);
    const ctx = await context(accountId, body);
    const built = buildRequest(req, makeScope([ctx.variables, ctx.envVars, ctx.runtime], "mask"), { collectionAuth: ctx.auth });
    return successResponse(reply, "Success", 200, { lang: body.lang, code: built.problems.length ? null : codeSnippet(built, body.lang, req), problems: built.problems });
  });

  // ── History ──
  fastify.get("/:accountId/history", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const m = await member(request, accountId);
    const rows = await db.apiRequestHistory.findMany({ where: { accountId, userId: m.userId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, method: true, url: true, status: true, durationMs: true, size: true, error: true, createdAt: true } });
    return successResponse(reply, "Success", 200, { items: rows });
  });

  fastify.get("/:accountId/history/:hid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, hid } = historyParams.parse(request.params);
    const m = await member(request, accountId);
    const row = await db.apiRequestHistory.findFirst({ where: { id: hid, accountId, userId: m.userId } });
    if (!row) throw new NotFoundError("Not in your history");
    return successResponse(reply, "Success", 200, row);
  });

  fastify.delete("/:accountId/history", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const m = await member(request, accountId);
    const { count } = await db.apiRequestHistory.deleteMany({ where: { accountId, userId: m.userId } });
    return successResponse(reply, "History cleared", 200, { deleted: count });
  });
}
