// /api/v1/admin/settings and /api/v1/admin/content
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { successResponse } from "@/core/utils/response.util";
import { getAdminContext } from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";
import { audit, page, pageQuerySchema, skipTake } from "../shared/http";
import { CONTENT_KINDS, slugSchema } from "../content/content.schemas";

export async function adminSettingsRoutes(fastify: FastifyInstance) {
  fastify.get("/", { onRequest: [fastify.requireAbility("settings.read")] }, async (_request, reply) => {
    return successResponse(reply, "Success", 200, await fastify.platformSettings.list());
  });

  /** Body: { changes: { "<key>": value | null } } — null resets to the default. */
  fastify.patch("/", { onRequest: [fastify.requireAbility("settings.update")] }, async (request, reply) => {
    const { changes } = z.object({ changes: z.record(z.string(), z.unknown()) }).parse(request.body);
    const admin = getAdminContext(request);
    const { before, after } = await fastify.platformSettings.update(changes, admin.id);
    await audit(fastify, request, { action: "settings.updated", targetType: "SystemSetting", targetId: Object.keys(changes).join(","), before, after });
    return successResponse(reply, "Settings saved", 200, await fastify.platformSettings.list());
  });
}

export async function adminContentRoutes(fastify: FastifyInstance) {
  const content = () => fastify.platformContent;

  fastify.get("/kinds", { onRequest: [fastify.requireAbility("content.read")] }, async (_request, reply) => {
    return successResponse(reply, "Success", 200, Object.entries(CONTENT_KINDS).map(([kind, v]) => ({ kind, label: v.label })));
  });

  fastify.get("/", { onRequest: [fastify.requireAbility("content.read")] }, async (request) => {
    const q = pageQuerySchema.extend({ kind: z.string().max(40).optional(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional() }).parse(request.query);
    const { items, total, available } = await content().list({ ...q, ...skipTake(q) });
    return page(items, total, q, { available });
  });

  fastify.get<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("content.read")] }, async (request, reply) => {
    return successResponse(reply, "Success", 200, await content().get(request.params.id));
  });

  fastify.post("/", { onRequest: [fastify.requireAbility("content.update")] }, async (request, reply) => {
    const body = z
      .object({ slug: slugSchema, kind: z.string(), title: z.string().trim().min(1).max(120), data: z.unknown().optional(), seoTitle: z.string().max(120).nullable().optional(), seoDescription: z.string().max(300).nullable().optional() })
      .parse(request.body);
    const admin = getAdminContext(request);
    const created = await content().create(body, admin.id);
    await audit(fastify, request, { action: "content.created", targetType: "ContentEntry", targetId: created.id, after: { slug: created.slug, kind: created.kind } });
    return successResponse(reply, "Content created", 201, created);
  });

  fastify.put<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("content.update")] }, async (request, reply) => {
    const body = z
      .object({ title: z.string().trim().min(1).max(120).optional(), data: z.unknown().optional(), seoTitle: z.string().max(120).nullable().optional(), seoDescription: z.string().max(300).nullable().optional(), expectedUpdatedAt: z.coerce.date().optional() })
      .parse(request.body);
    const admin = getAdminContext(request);
    const { before, after } = await content().update(request.params.id, body, admin.id);
    await audit(fastify, request, { action: "content.updated", targetType: "ContentEntry", targetId: after.id, before: { title: before.title }, after: { title: after.title } });
    return successResponse(reply, "Draft saved", 200, after);
  });

  fastify.post<{ Params: { id: string } }>("/:id/publish", { onRequest: [fastify.requireAbility("content.publish")] }, async (request, reply) => {
    const { note } = z.object({ note: z.string().max(300).optional() }).parse(request.body ?? {});
    const admin = getAdminContext(request);
    const published = await content().publish(request.params.id, admin.id, note);
    await audit(fastify, request, { action: "content.published", targetType: "ContentEntry", targetId: published.id, after: { slug: published.slug, version: published.version } });
    return successResponse(reply, "Published", 200, published);
  });

  fastify.post<{ Params: { id: string } }>("/:id/unpublish", { onRequest: [fastify.requireAbility("content.publish")] }, async (request, reply) => {
    const { archive } = z.object({ archive: z.boolean().default(false) }).parse(request.body ?? {});
    const admin = getAdminContext(request);
    const { before, after } = await content().setStatus(request.params.id, archive ? "ARCHIVED" : "DRAFT", admin.id);
    await audit(fastify, request, { action: archive ? "content.archived" : "content.unpublished", targetType: "ContentEntry", targetId: after.id, before: { status: before.status }, after: { status: after.status } });
    return successResponse(reply, archive ? "Archived" : "Unpublished", 200, after);
  });

  fastify.post<{ Params: { id: string; revisionId: string } }>("/:id/revisions/:revisionId/restore", { onRequest: [fastify.requireAbility("content.update")] }, async (request, reply) => {
    const admin = getAdminContext(request);
    const restored = await content().restoreRevision(request.params.id, request.params.revisionId, admin.id);
    await audit(fastify, request, { action: "content.revision_restored", targetType: "ContentEntry", targetId: restored.id, after: { revisionId: request.params.revisionId } });
    return successResponse(reply, "Revision restored to the draft. Publish to make it live.", 200, restored);
  });

  fastify.delete<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("content.delete")] }, async (request, reply) => {
    const removed = await content().remove(request.params.id);
    await audit(fastify, request, { action: "content.deleted", targetType: "ContentEntry", targetId: removed.id, before: { slug: removed.slug, title: removed.title } });
    return successResponse(reply, "Deleted", 200, { id: removed.id });
  });
}
