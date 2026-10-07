// /api/v1/public/specs — published API docs for readers (phase 5). No login.
//
//   GET  /by-host/:hostname                  which docs a verified custom domain serves
//   GET  /:workspace/:slug                   the docs model of the latest (or ?version=N) published version,
//                                            401 { passwordRequired } for PASSWORD docs without a token (x-docs-token)
//   POST /:workspace/:slug/unlock            { password } -> { token } (12 h)
//   GET  /:workspace/:slug/openapi           the published document (?format=yaml|json)
//   POST /:workspace/:slug/try               { method, path, headers?, body? } sent to the linked mock API
//
// <workspace> is the account slug (or its id when it has none). Only PUBLIC
// and PASSWORD docs answer; PRIVATE, unknown and switched-off docs are 404.
// Any origin may call these, without cookies (docs can live on a customer's
// domain): the CORS delegator in identity/presentation/plugins/register.plugin.ts.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "@/core/errors/app-error";
import { NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { specModel } from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import { checkDocsPassword, sendToMock, signDocsToken, specToText, verifyDocsToken, DOCS_TOKEN_HOURS } from "./specDocs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const where = z.object({ workspace: z.string().min(1).max(63), slug: z.string().min(1).max(50) });
const tryBody = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).default("GET"),
  path: z.string().min(1).max(2000).regex(/^\//, "The path must start with /"),
  headers: z.record(z.string().max(256), z.string().max(8192)).default({}),
  body: z.string().max(200_000).optional(),
});

type Spec = { id: string; accountId: string; name: string; slug: string; visibility: string; passwordHash: string | null; tryMockId: string | null; customDomain: string | null; customDomainVerifiedAt: Date | null };

export async function publicSpecRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const db = prisma as unknown as { apiSpec: any; apiSpecVersion: any; mockApi: any };
  const hubDomain = () => process.env.HUB_DOMAIN ?? "vhyxvoid.com";
  const enabled = async () => Boolean(await fastify.platformSettings.get("features.apiDocs"));
  const select = { id: true, accountId: true, name: true, slug: true, visibility: true, passwordHash: true, tryMockId: true, customDomain: true, customDomainVerifiedAt: true, account: { select: { slug: true, status: true } } };

  async function findSpec(workspace: string, slug: string): Promise<Spec & { workspace: string }> {
    if (!(await enabled())) throw new NotFoundError("No docs here");
    const account = UUID_RE.test(workspace) ? { id: workspace } : { slug: workspace.toLowerCase() };
    const row = await db.apiSpec.findFirst({ where: { slug: slug.toLowerCase(), visibility: { not: "PRIVATE" }, account }, select });
    if (!row || ["DELETED", "SUSPENDED"].includes(row.account?.status)) throw new NotFoundError("No docs here");
    return { ...row, workspace: row.account?.slug ?? row.accountId };
  }
  function locked(spec: Spec, request: FastifyRequest): boolean {
    if (spec.visibility !== "PASSWORD") return false;
    if (!spec.passwordHash) return true;
    const token = request.headers["x-docs-token"];
    return !verifyDocsToken(spec.id, spec.passwordHash, typeof token === "string" ? token : undefined);
  }
  const refuseLocked = (reply: FastifyReply, spec: Spec) => reply.code(401).send({ success: false, code: "PASSWORD_REQUIRED", message: "These docs are protected by a password", data: { passwordRequired: true, name: spec.name } });
  async function version(specId: string, n?: number) {
    return db.apiSpecVersion.findFirst({ where: { specId, ...(n ? { number: n } : {}) }, orderBy: { number: "desc" } });
  }

  fastify.get("/by-host/:hostname", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { hostname } = z.object({ hostname: z.string().min(1).max(253) }).parse(request.params);
    if (!(await enabled())) throw new NotFoundError("No docs here");
    const row = await db.apiSpec.findFirst({ where: { customDomain: hostname.toLowerCase().replace(/\.$/, ""), customDomainVerifiedAt: { not: null }, visibility: { not: "PRIVATE" } }, select });
    if (!row || ["DELETED", "SUSPENDED"].includes(row.account?.status)) throw new NotFoundError("No docs here");
    return successResponse(reply, "Success", 200, { workspace: row.account?.slug ?? row.accountId, slug: row.slug, name: row.name });
  });

  fastify.get("/:workspace/:slug", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
    const p = where.parse(request.params);
    const q = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(request.query ?? {});
    const spec = await findSpec(p.workspace, p.slug);
    if (locked(spec, request)) return refuseLocked(reply, spec);
    const v = await version(spec.id, q.version);
    if (!v) throw new NotFoundError(q.version ? "No such version" : "These docs aren't published yet");
    const versions = await db.apiSpecVersion.findMany({ where: { specId: spec.id }, orderBy: { number: "desc" }, take: 50, select: { number: true, version: true, createdAt: true, breaking: true, notes: true } });
    reply.header("cache-control", spec.visibility === "PUBLIC" ? "public, max-age=30" : "private, no-store");
    return successResponse(reply, "Success", 200, {
      name: spec.name,
      workspace: spec.workspace,
      slug: spec.slug,
      number: v.number,
      version: v.version,
      publishedAt: v.createdAt,
      versions,
      canTry: Boolean(spec.tryMockId),
      changes: v.changes,
      model: specModel(v.doc),
    });
  });

  fastify.post("/:workspace/:slug/unlock", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const p = where.parse(request.params);
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(request.body ?? {});
    const spec = await findSpec(p.workspace, p.slug);
    if (spec.visibility !== "PASSWORD") return successResponse(reply, "Not protected", 200, { token: null });
    if (!spec.passwordHash || !checkDocsPassword(spec.id, spec.passwordHash, password)) throw new AppError("Wrong password", 401, "UNAUTHORIZED");
    return successResponse(reply, "Unlocked", 200, { token: signDocsToken(spec.id, spec.passwordHash), hours: DOCS_TOKEN_HOURS });
  });

  fastify.get("/:workspace/:slug/openapi", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const p = where.parse(request.params);
    const q = z.object({ format: z.enum(["yaml", "json"]).default("yaml"), version: z.coerce.number().int().min(1).optional(), token: z.string().max(200).optional() }).parse(request.query ?? {});
    const spec = await findSpec(p.workspace, p.slug);
    // A download link can't send a header, so the token may come in the query too.
    if (spec.visibility === "PASSWORD" && !(spec.passwordHash && verifyDocsToken(spec.id, spec.passwordHash, (request.headers["x-docs-token"] as string | undefined) ?? q.token))) return refuseLocked(reply, spec);
    const v = await version(spec.id, q.version);
    if (!v) throw new NotFoundError("These docs aren't published yet");
    return reply
      .header("content-type", q.format === "json" ? "application/json; charset=utf-8" : "application/yaml; charset=utf-8")
      .header("content-disposition", `attachment; filename="${spec.slug}-v${v.number}.${q.format}"`)
      .send(specToText(v.doc, q.format));
  });

  fastify.post("/:workspace/:slug/try", { bodyLimit: 300 * 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const p = where.parse(request.params);
    const body = tryBody.parse(request.body ?? {});
    const spec = await findSpec(p.workspace, p.slug);
    if (locked(spec, request)) return refuseLocked(reply, spec);
    if (!spec.tryMockId) throw new ValidationError("Try it isn't set up for these docs");
    const mock = await db.mockApi.findFirst({ where: { id: spec.tryMockId, accountId: spec.accountId }, select: { label: true, enabled: true, account: { select: { slug: true } } } });
    if (!mock?.account?.slug) throw new ValidationError("The mock API behind try-it is gone");
    try {
      const res = await sendToMock(`${mock.account.slug}--${mock.label}.${hubDomain()}`, body);
      return successResponse(reply, "Sent", 200, res);
    } catch (err) {
      throw new AppError(`The mock didn't answer: ${(err as Error).message}`, 502, "SERVICE_UNAVAILABLE");
    }
  });
}
