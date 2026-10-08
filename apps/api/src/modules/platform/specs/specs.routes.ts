// /api/v1/specs — a workspace's API documentation (internal-tools/shared/api-platform-plan.md, phase 5).
//
//   GET    /:accountId                          specs, limits, the workspace part of public URLs
//   POST   /:accountId                          { name, slug?, description?, document? (text|object) | mockId? } (plan maxApiSpecs)
//   POST   /:accountId/validate                 { text } problems + the docs model (nothing saved)
//   GET    /:accountId/:id                      one spec: draft, problems, latest version, sharing
//   PUT    /:accountId/:id                      { name?, slug?, description?, text? | doc?, expectedVersion? } save the draft (broken drafts are kept)
//   POST   /:accountId/:id/preview              { text? } problems, the parsed doc (for the form view), model and changes against the latest version
//   POST   /:accountId/:id/publish              { notes? } freeze the draft as the next version (errors refuse it)
//   GET    /:accountId/:id/versions             published versions (no text)
//   GET    /:accountId/:id/versions/:vid        one version with its text and changes
//   POST   /:accountId/:id/versions/:vid/restore  copy a version back into the draft
//   GET    /:accountId/:id/diff?from=&to=       changes between two versions (a version id, "latest" or "draft")
//   GET    /:accountId/:id/export               ?format=yaml|json&version=draft|latest|<id>
//   PUT    /:accountId/:id/sharing              { visibility, password?, tryMockId? } (owners/admins; PASSWORD needs protectedDocs)
//   PUT    /:accountId/:id/domain               { hostname | null } (owners/admins; docsCustomDomains)
//   POST   /:accountId/:id/domain/check         read DNS now
//   DELETE /:accountId/:id                      (owners/admins)
//
// Every member edits and publishes (a team tool, like the API client);
// sharing, domains and deleting are for owners and admins. Readers of public
// docs only ever see published versions (specs.public.routes.ts).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ConflictError, ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  SPEC_SLUG_RE,
  changeCounts,
  checkCustomDomain,
  currentPlanOverrides,
  diffSpecs,
  exportOpenApi,
  getEffectivePlanLimitsForAccount,
  newVerificationToken,
  readSetting,
  specModel,
  specSlugFrom,
  starterSpec,
  validateCustomHostname,
  verificationRecord,
  type DnsResolverLike,
  type MockApiDefinition,
} from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import { lockedCreate } from "../shared/createLock";
import type { HubClient } from "../shared/hubClient";
import { errorsOf, hashDocsPassword, parseSpecText, specToText } from "./specDocs";

type Json = Record<string, unknown>;
const params = z.object({ accountId: z.string().uuid() });
const idParams = params.extend({ id: z.string().uuid() });
const verParams = idParams.extend({ vid: z.string().uuid() });
const slug = z.string().trim().toLowerCase().regex(SPEC_SLUG_RE, "Use 1–50 lowercase letters, digits and dashes");
const docInput = z.union([z.string().min(2).max(5_000_000), z.record(z.string(), z.unknown())]);
const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slug.optional(),
  description: z.string().trim().max(500).optional(),
  document: docInput.optional(),
  mockId: z.string().uuid().optional(),
});
const saveBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  slug: slug.optional(),
  description: z.string().trim().max(500).optional(),
  text: z.string().max(5_000_000).optional(),
  /** A form edit: the whole document, written back in the draft's format. */
  doc: z.record(z.string(), z.unknown()).optional(),
  expectedVersion: z.number().int().min(1).optional(),
});
const sharingBody = z.object({
  visibility: z.enum(["PRIVATE", "PUBLIC", "PASSWORD"]),
  /** Required to turn on PASSWORD the first time; omit to keep the current one. */
  password: z.string().min(6).max(200).optional(),
  tryMockId: z.string().uuid().nullable().optional(),
});
const ref = z.union([z.literal("draft"), z.literal("latest"), z.string().uuid()]);
const validateBody = z.object({ text: z.string().max(5_000_000) });
/** No text: the saved draft. */
const previewBody = z.object({ text: z.string().max(5_000_000).optional() });
const publishBody = z.object({ notes: z.string().trim().max(2000).default("") });
const diffQuery = z.object({ from: ref, to: ref.default("draft") });
const exportQuery = z.object({ format: z.enum(["yaml", "json"]).default("yaml"), version: ref.default("draft") });

type Row = {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  description: string;
  draftText: string;
  draftFormat: string;
  version: number;
  visibility: "PRIVATE" | "PUBLIC" | "PASSWORD";
  passwordHash: string | null;
  customDomain: string | null;
  customDomainToken: string | null;
  customDomainVerifiedAt: Date | null;
  tryMockId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
type VersionRow = { id: string; number: number; version: string; text: string; doc: Json; changes: unknown; breaking: number; notes: string; publishedById: string | null; createdAt: Date };

export async function specRoutes(fastify: FastifyInstance, opts: { hub: HubClient; dns: DnsResolverLike }) {
  const prisma = prismaOf(fastify);
  const db = prisma as unknown as { apiSpec: any; apiSpecVersion: any; mockApi: any; customDomain: any; accountMember: any };
  const appUrl = () => (process.env.APP_URL ?? "https://www.vhyxvoid.com").replace(/\/$/, "");
  const hubDomain = () => process.env.HUB_DOMAIN ?? "vhyxvoid.com";

  async function member(request: FastifyRequest, accountId: string) {
    const user = getUserContext(request);
    const m = await db.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true, account: { select: { slug: true } } } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return { userId: user.id, level: m.roleLevel as number, slug: m.account.slug as string | null, workspace: (m.account.slug as string | null) ?? accountId };
  }
  async function admin(request: FastifyRequest, accountId: string) {
    const m = await member(request, accountId);
    if (m.level < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can change how docs are shared");
    return m;
  }
  async function limits(accountId: string) {
    const [enabled, l] = await Promise.all([fastify.platformSettings.get("features.apiDocs"), getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides())]);
    return { enabled: Boolean(enabled), maxSpecs: Number.isFinite(l.maxApiSpecs) ? Math.max(0, Math.floor(l.maxApiSpecs)) : 10_000, protectedDocs: Boolean(l.protectedDocs), customDomains: Boolean(l.docsCustomDomains), plan: l.plan };
  }
  async function usable(accountId: string) {
    const lim = await limits(accountId);
    if (!lim.enabled) throw new ForbiddenError("API documentation is switched off on this platform right now");
    return lim;
  }
  async function find(accountId: string, id: string): Promise<Row> {
    const row = (await db.apiSpec.findFirst({ where: { id, accountId } })) as Row | null;
    if (!row) throw new NotFoundError("API spec not found");
    return row;
  }
  const latestOf = (specId: string): Promise<VersionRow | null> => db.apiSpecVersion.findFirst({ where: { specId }, orderBy: { number: "desc" } });
  const publicUrl = (workspace: string, r: Pick<Row, "slug">) => `${appUrl()}/api-docs/${workspace}/${r.slug}`;
  const versionSummary = (v: VersionRow | null) => (v ? { id: v.id, number: v.number, version: v.version, breaking: v.breaking, notes: v.notes, createdAt: v.createdAt, publishedById: v.publishedById } : null);
  const sharing = (r: Row, workspace: string) => ({
    visibility: r.visibility,
    hasPassword: Boolean(r.passwordHash),
    tryMockId: r.tryMockId,
    publicUrl: publicUrl(workspace, r),
    customDomain: r.customDomain,
    customDomainVerified: Boolean(r.customDomainVerifiedAt),
    customDomainUrl: r.customDomain && r.customDomainVerifiedAt ? `https://${r.customDomain}` : null,
  });
  const domainRecords = async (r: Row) => {
    if (!r.customDomain || !r.customDomainToken) return null;
    const target = String((await readSetting("tunnels.customDomainTarget")) ?? "").trim().toLowerCase().replace(/\.$/, "");
    const txt = verificationRecord(r.customDomain, r.customDomainToken);
    return { verification: { type: "TXT", name: txt.name, value: txt.value }, routing: target ? { type: "CNAME", name: r.customDomain, value: target } : null };
  };
  const summary = (r: Row, latest: VersionRow | null, workspace: string) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    version: r.version,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
    latest: versionSummary(latest),
    /** The draft has changes nobody published yet. */
    unpublished: !latest || latest.text !== r.draftText,
    ...sharing(r, workspace),
  });

  /** Text of a "draft" / "latest" / version-id reference, parsed. */
  async function resolveRef(r: Row, which: string): Promise<{ label: string; doc: Json | null; text: string; format: "yaml" | "json" }> {
    if (which === "draft") {
      const p = parseSpecText(r.draftText);
      return { label: "draft", doc: p.doc, text: r.draftText, format: p.format };
    }
    const v: VersionRow | null = which === "latest" ? await latestOf(r.id) : await db.apiSpecVersion.findFirst({ where: { id: which, specId: r.id } });
    if (!v) throw new NotFoundError(which === "latest" ? "Nothing is published yet" : "Version not found");
    return { label: `v${v.number}`, doc: v.doc, text: v.text, format: v.text.trimStart().startsWith("{") ? "json" : "yaml" };
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "specs:read", apiDoc: { summary: "List API specs", description: "Each spec with its slug, draft version, latest published version and sharing." } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const m = await member(request, accountId);
    const [rows, lim] = await Promise.all([db.apiSpec.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } }) as Promise<Row[]>, limits(accountId)]);
    const latest = await Promise.all(rows.map((r) => latestOf(r.id)));
    return successResponse(reply, "Success", 200, {
      enabled: lim.enabled,
      limits: { maxSpecs: lim.maxSpecs, protectedDocs: lim.protectedDocs, customDomains: lim.customDomains },
      canManage: m.level >= RoleLevel.ADMIN,
      workspace: m.workspace,
      specs: rows.map((r, i) => summary(r, latest[i], m.workspace)),
    });
  });

  fastify.post("/:accountId", { onRequest: [fastify.userAuthGuard], bodyLimit: 6 * 1024 * 1024, config: { apiKeyScope: "specs:write", apiDoc: { summary: "Create an API spec", description: "From a starter, a document (OpenAPI 3.x or Swagger 2, text or object), or a mock API (mockId).", body: createBody, status: 201 }, rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = createBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    const lim = await usable(accountId);
    const count = await db.apiSpec.count({ where: { accountId } });
    if (count >= lim.maxSpecs) throw new PlanLimitExceededError({ limit: lim.maxSpecs, current: count, limitKey: "maxApiSpecs", plan: lim.plan });
    let text: string;
    let format: "yaml" | "json" = "yaml";
    if (body.document !== undefined) {
      if (typeof body.document === "string") {
        const p = parseSpecText(body.document);
        if (!p.doc) throw new ValidationError(p.problems[0]?.message ?? "Not an OpenAPI document");
        format = p.format;
        // Swagger 2 is stored converted, so the editor shows what the docs show.
        text = p.converted ? specToText(p.doc, p.format) : body.document;
      } else {
        const p = parseSpecText(JSON.stringify(body.document));
        if (!p.doc) throw new ValidationError(p.problems[0]?.message ?? "Not an OpenAPI document");
        text = specToText(p.doc, "yaml");
      }
    } else if (body.mockId) {
      const mock = await db.mockApi.findFirst({ where: { id: body.mockId, accountId } });
      if (!mock) throw new NotFoundError("Mock API not found");
      const arr = (v: unknown) => (Array.isArray(v) ? v : []);
      const def: MockApiDefinition = { mode: mock.mode, cors: mock.cors, latencyMs: mock.latencyMs, endpoints: arr(mock.endpoints), resources: arr(mock.resources) };
      text = specToText(exportOpenApi(def, { title: body.name, description: mock.description || undefined, serverUrl: m.slug ? `https://${m.slug}--${mock.label}.${hubDomain()}` : undefined }), "yaml");
    } else {
      text = specToText(starterSpec(body.name), "yaml");
    }
    const base = body.slug ?? specSlugFrom(body.name);
    // Under the lock, the free slug is picked by reading the taken ones: a
    // failed insert would end the transaction.
    const row = await lockedCreate(prisma, accountId, "apiSpec", async (tx: typeof db) => {
      const now = await tx.apiSpec.count({ where: { accountId } });
      if (now >= lim.maxSpecs) throw new PlanLimitExceededError({ limit: lim.maxSpecs, current: now, limitKey: "maxApiSpecs", plan: lim.plan });
      const candidates = [base, ...Array.from({ length: 19 }, (_, i) => `${base.slice(0, 46)}-${i + 2}`)];
      const taken = new Set((await tx.apiSpec.findMany({ where: { accountId, slug: { in: candidates } }, select: { slug: true } })).map((r: { slug: string }) => r.slug));
      if (body.slug && taken.has(body.slug)) throw new ConflictError(`This workspace already has docs at /${body.slug}`);
      const slug = candidates.find((c) => !taken.has(c));
      if (!slug) throw new ConflictError("Pick another slug");
      try {
        return (await tx.apiSpec.create({
          data: { accountId, name: body.name, slug, description: body.description ?? "", draftText: text, draftFormat: format, tryMockId: body.mockId ?? null, createdById: m.userId, updatedById: m.userId },
        })) as Row;
      } catch (err) {
        // A rename to this slug got there first.
        if ((err as { code?: string }).code === "P2002") throw new ConflictError("Pick another slug");
        throw err;
      }
    });
    return successResponse(reply, "API spec created", 201, summary(row, null, m.workspace));
  });

  fastify.post("/:accountId/validate", { onRequest: [fastify.userAuthGuard], bodyLimit: 6 * 1024 * 1024, config: { apiKeyScope: "specs:read", apiDoc: { summary: "Validate a document", description: "Problems (with their location and severity) and the docs model of an OpenAPI document. Nothing is saved.", body: validateBody }, rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const { text } = validateBody.parse(request.body ?? {});
    await member(request, accountId);
    const p = parseSpecText(text);
    return successResponse(reply, "Success", 200, { problems: p.problems, converted: p.converted, format: p.format, model: p.doc ? specModel(p.doc) : null });
  });

  fastify.get("/:accountId/:id", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "specs:read", apiDoc: { summary: "Get an API spec", description: "The draft text, its problems, the latest published version and sharing." } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const m = await member(request, accountId);
    const [r, lim] = await Promise.all([find(accountId, id), limits(accountId)]);
    const latest = await latestOf(r.id);
    const p = parseSpecText(r.draftText);
    return successResponse(reply, "Success", 200, {
      ...summary(r, latest, m.workspace),
      draftText: r.draftText,
      draftFormat: r.draftFormat,
      problems: p.problems,
      canManage: m.level >= RoleLevel.ADMIN,
      enabledOnPlatform: lim.enabled,
      limits: { protectedDocs: lim.protectedDocs, customDomains: lim.customDomains },
      domainRecords: await domainRecords(r),
    });
  });

  fastify.put("/:accountId/:id", { onRequest: [fastify.userAuthGuard], bodyLimit: 6 * 1024 * 1024, config: { apiKeyScope: "specs:write", apiDoc: { summary: "Save the draft", description: "text (YAML or JSON) or doc (an object), plus name, slug or description. A draft with errors is kept. Pass expectedVersion to refuse a save over a newer one (409).", body: saveBody }, rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = saveBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    await usable(accountId);
    const existing = await find(accountId, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== existing.version) {
      throw new ConflictError("Someone saved this spec after you opened it. Reload to see their version, then make your change again.");
    }
    let text: string | undefined = body.text;
    if (body.doc !== undefined) text = specToText(body.doc, existing.draftFormat === "json" ? "json" : "yaml");
    const format = text !== undefined ? parseSpecText(text).format : existing.draftFormat;
    try {
      const res = await db.apiSpec.updateMany({
        where: { id, accountId, version: existing.version },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(text !== undefined ? { draftText: text, draftFormat: format } : {}),
          version: { increment: 1 },
          updatedById: m.userId,
        },
      });
      if (res.count === 0) throw new ConflictError("Someone saved this spec at the same moment. Reload and try again.");
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError(`This workspace already has docs at /${body.slug}`);
      throw err;
    }
    const r = await find(accountId, id);
    const p = parseSpecText(r.draftText);
    return successResponse(reply, "Saved", 200, { ...summary(r, await latestOf(r.id), m.workspace), draftText: r.draftText, draftFormat: r.draftFormat, problems: p.problems });
  });

  fastify.post("/:accountId/:id/preview", { onRequest: [fastify.userAuthGuard], bodyLimit: 6 * 1024 * 1024, config: { apiKeyScope: "specs:read", apiDoc: { summary: "Check a document against the latest version", description: "Problems and the changes for clients (breaking, warning, info) against the latest published version, for the given text or the saved draft. Nothing is saved. What vhyxvoid spec check calls.", body: previewBody }, rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const { text } = previewBody.parse(request.body ?? {});
    await member(request, accountId);
    const r = await find(accountId, id);
    const p = parseSpecText(text ?? r.draftText);
    const latest = await latestOf(r.id);
    const changes = p.doc && latest ? diffSpecs(latest.doc, p.doc) : [];
    return successResponse(reply, "Success", 200, { problems: p.problems, converted: p.converted, doc: p.doc, model: p.doc ? specModel(p.doc) : null, against: versionSummary(latest), changes, counts: changeCounts(changes) });
  });

  fastify.post("/:accountId/:id/publish", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "specs:write", apiDoc: { summary: "Publish the draft", description: "Freezes the draft as the next version with its change report. Refused with errors in the document; 409 when nothing changed since the latest version.", body: publishBody, status: 201 }, rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const { notes } = publishBody.parse(request.body ?? {});
    const m = await member(request, accountId);
    await usable(accountId);
    const r = await find(accountId, id);
    const p = parseSpecText(r.draftText);
    const errors = errorsOf(p.problems);
    if (!p.doc || errors.length) throw new ValidationError(`Fix ${errors.length === 1 ? "this error" : `these ${errors.length} errors`} before publishing: ${errors.slice(0, 3).map((e) => `${e.path ? `${e.path}: ` : ""}${e.message}`).join("; ")}`);
    let text = r.draftText;
    if (p.converted) {
      text = specToText(p.doc, p.format);
      await db.apiSpec.update({ where: { id }, data: { draftText: text, version: { increment: 1 } } });
    }
    const latest = await latestOf(r.id);
    if (latest && latest.text === text) throw new ConflictError(`Nothing changed since version ${latest.number}`);
    const changes = latest ? diffSpecs(latest.doc, p.doc) : [];
    const info = (p.doc.info ?? {}) as Json;
    try {
      const v = (await db.apiSpecVersion.create({
        data: { specId: r.id, accountId, number: (latest?.number ?? 0) + 1, version: String(info.version ?? "").slice(0, 80), text, doc: p.doc as never, changes: changes as never, breaking: changeCounts(changes).breaking, notes, publishedById: m.userId },
      })) as VersionRow;
      return successResponse(reply, `Published version ${v.number}`, 201, { ...versionSummary(v), changes, counts: changeCounts(changes) });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError("Someone published at the same moment. Reload and try again.");
      throw err;
    }
  });

  fastify.get("/:accountId/:id/versions", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "specs:read", apiDoc: { summary: "List published versions" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await member(request, accountId);
    await find(accountId, id);
    const rows = (await db.apiSpecVersion.findMany({ where: { specId: id }, orderBy: { number: "desc" }, take: 200, select: { id: true, number: true, version: true, breaking: true, notes: true, publishedById: true, createdAt: true, changes: true } })) as Array<VersionRow>;
    return successResponse(reply, "Success", 200, { versions: rows.map((v) => ({ ...versionSummary(v), counts: changeCounts(Array.isArray(v.changes) ? (v.changes as never) : []) })) });
  });

  fastify.get("/:accountId/:id/versions/:vid", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "specs:read", apiDoc: { summary: "Get a published version", description: "Its text and its changes against the version before." } } }, async (request, reply) => {
    const { accountId, id, vid } = verParams.parse(request.params);
    await member(request, accountId);
    await find(accountId, id);
    const v = (await db.apiSpecVersion.findFirst({ where: { id: vid, specId: id } })) as VersionRow | null;
    if (!v) throw new NotFoundError("Version not found");
    return successResponse(reply, "Success", 200, { ...versionSummary(v), text: v.text, changes: v.changes, model: specModel(v.doc) });
  });

  fastify.post("/:accountId/:id/versions/:vid/restore", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id, vid } = verParams.parse(request.params);
    const m = await member(request, accountId);
    await usable(accountId);
    await find(accountId, id);
    const v = (await db.apiSpecVersion.findFirst({ where: { id: vid, specId: id } })) as VersionRow | null;
    if (!v) throw new NotFoundError("Version not found");
    await db.apiSpec.update({ where: { id }, data: { draftText: v.text, draftFormat: v.text.trimStart().startsWith("{") ? "json" : "yaml", version: { increment: 1 }, updatedById: m.userId } });
    return successResponse(reply, `Version ${v.number} copied into the draft`, 200, { id, number: v.number });
  });

  fastify.get("/:accountId/:id/diff", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "specs:read", apiDoc: { summary: "Compare two versions", description: "from and to are a version id, latest or draft.", query: diffQuery } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const q = diffQuery.parse(request.query ?? {});
    await member(request, accountId);
    const r = await find(accountId, id);
    const [a, b] = await Promise.all([resolveRef(r, q.from), resolveRef(r, q.to)]);
    if (!a.doc || !b.doc) throw new ValidationError(`The ${!a.doc ? a.label : b.label} doesn't parse; fix it first`);
    const changes = diffSpecs(a.doc, b.doc);
    return successResponse(reply, "Success", 200, { from: a.label, to: b.label, changes, counts: changeCounts(changes) });
  });

  fastify.get("/:accountId/:id/export", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "specs:read", apiDoc: { summary: "Export a spec", description: "The draft, the latest version or a given version, as YAML or JSON.", query: exportQuery, file: "The OpenAPI document." } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const q = exportQuery.parse(request.query ?? {});
    await member(request, accountId);
    const r = await find(accountId, id);
    const x = await resolveRef(r, q.version);
    const body = x.doc && x.format !== q.format ? specToText(x.doc, q.format) : x.text;
    return reply
      .header("content-type", q.format === "json" ? "application/json; charset=utf-8" : "application/yaml; charset=utf-8")
      .header("content-disposition", `attachment; filename="${r.slug}${x.label === "draft" ? "" : `-${x.label}`}.${q.format === "json" ? "json" : "yaml"}"`)
      .send(body);
  });

  fastify.put("/:accountId/:id/sharing", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const body = sharingBody.parse(request.body ?? {});
    const m = await admin(request, accountId);
    const lim = await usable(accountId);
    const r = await find(accountId, id);
    const data: Record<string, unknown> = { visibility: body.visibility };
    if (body.password !== undefined || (body.visibility === "PASSWORD" && r.visibility !== "PASSWORD")) {
      if (!lim.protectedDocs) throw new ForbiddenError("Password-protected docs aren't included in your plan");
    }
    if (body.password !== undefined) data.passwordHash = hashDocsPassword(r.id, body.password);
    if (body.visibility === "PASSWORD" && !r.passwordHash && body.password === undefined) throw new ValidationError("Set a password to protect the docs");
    if (body.tryMockId !== undefined) {
      if (body.tryMockId && !(await db.mockApi.findFirst({ where: { id: body.tryMockId, accountId }, select: { id: true } }))) throw new NotFoundError("Mock API not found");
      data.tryMockId = body.tryMockId;
    }
    const updated = (await db.apiSpec.update({ where: { id }, data })) as Row;
    if (updated.customDomain) await opts.hub.invalidateDomain(updated.customDomain);
    return successResponse(reply, "Sharing updated", 200, sharing(updated, m.workspace));
  });

  fastify.put("/:accountId/:id/domain", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const { hostname } = z.object({ hostname: z.string().trim().max(253).nullable() }).parse(request.body ?? {});
    const m = await admin(request, accountId);
    const lim = await usable(accountId);
    const r = await find(accountId, id);
    if (hostname === null || hostname === "") {
      await db.apiSpec.update({ where: { id }, data: { customDomain: null, customDomainToken: null, customDomainVerifiedAt: null } });
      if (r.customDomain) await opts.hub.invalidateDomain(r.customDomain);
      return successResponse(reply, "Domain removed", 200, { customDomain: null });
    }
    if (!lim.customDomains) throw new ForbiddenError("Docs on your own domain aren't included in your plan");
    const v = validateCustomHostname(hostname, hubDomain(), process.env.NODE_ENV !== "production");
    if (!v.ok) throw new ValidationError(v.error);
    if (await db.customDomain.findFirst({ where: { hostname: v.hostname, verifiedAt: { not: null } }, select: { id: true } })) throw new ConflictError(`${v.hostname} already serves a tunnel; use another hostname for the docs`);
    try {
      const updated = (await db.apiSpec.update({ where: { id }, data: { customDomain: v.hostname, customDomainToken: newVerificationToken(), customDomainVerifiedAt: null } })) as Row;
      if (r.customDomain) await opts.hub.invalidateDomain(r.customDomain);
      return successResponse(reply, "Domain added; create the DNS records, then check", 200, { ...sharing(updated, m.workspace), domainRecords: await domainRecords(updated) });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError(`${v.hostname} is already used by other docs`);
      throw err;
    }
  });

  fastify.post("/:accountId/:id/domain/check", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const m = await member(request, accountId);
    const r = await find(accountId, id);
    if (!r.customDomain || !r.customDomainToken) throw new ValidationError("Add a domain first");
    const target = String((await readSetting("tunnels.customDomainTarget")) ?? "").trim().toLowerCase().replace(/\.$/, "");
    const result = await checkCustomDomain(opts.dns, r.customDomain, r.customDomainToken, target);
    let updated = r;
    if (result.verified && !r.customDomainVerifiedAt) {
      updated = (await db.apiSpec.update({ where: { id }, data: { customDomainVerifiedAt: new Date() } })) as Row;
      await opts.hub.invalidateDomain(r.customDomain);
    }
    return successResponse(reply, updated.customDomainVerifiedAt ? "Verified" : "Not verified yet", 200, { ...sharing(updated, m.workspace), routed: result.routed, error: result.error, domainRecords: await domainRecords(updated) });
  });

  fastify.delete("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await admin(request, accountId);
    const r = await find(accountId, id);
    await db.apiSpec.delete({ where: { id } });
    if (r.customDomain) await opts.hub.invalidateDomain(r.customDomain);
    return successResponse(reply, "Deleted", 200, { id });
  });
}
