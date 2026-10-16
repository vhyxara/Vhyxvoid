// /api/v1/admin/seo — the SEO screen. Site-wide defaults are settings (group
// "seo", saved through /admin/settings); this is everything else.
//
//   GET    /audit                 score, counts and issues to fix (seo.read)
//   GET    /pages                 every public address: what it says, its override, its issues (seo.read)
//   PUT    /pages                 { path, title?, description?, imageUrl?, noindex } set an address's override (seo.update)
//   DELETE /pages/:id             remove an override (seo.update)
//   GET    /redirects             all redirects, most used first (seo.read)
//   POST   /redirects             { from, to, permanent?, note? } (seo.update)
//   POST   /redirects/bulk        { lines } "from to [302]" per line: add or replace many (seo.update)
//   PATCH  /redirects/:id         (seo.update)
//   DELETE /redirects/:id         (seo.update)
//   GET    /not-found             addresses visitors asked for that don't exist, most asked first (seo.read)
//   DELETE /not-found/:id | /not-found   dismiss one, or clear the list (seo.update)
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { SEO_LIMITS } from "@vhyxvoid/content";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getAdminContext } from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";
import { notifyWebsite } from "../content/revalidate";
import { audit, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";
import { assertNoLoop, redirectTargetOr400, seoAudit, seoRows, sitePathOr400 } from "./seo.service";

const idParams = z.object({ id: z.string().uuid() });
const text = (max: number) => z.string().trim().max(max);
const image = text(500).refine((v) => !v || /^(https:\/\/\S+|\/(?![/\\])\S*)$/i.test(v), "Use an https:// URL or a path starting with /");

export async function adminSeoRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const settings = () => fastify.platformSettings.publicValues() as Promise<Record<string, unknown>>;
  const rules = async (exceptId?: string) =>
    (await prisma.seoRedirect.findMany({ where: exceptId ? { NOT: { id: exceptId } } : {}, select: { fromPath: true, toUrl: true, permanent: true } })).map((r) => ({ from: r.fromPath, to: r.toUrl, permanent: r.permanent }));

  fastify.get("/audit", { onRequest: [fastify.requireAbility("seo.read")] }, async (_request, reply) => {
    return successResponse(reply, "Success", 200, await seoAudit(prisma, await settings()));
  });

  // ── Addresses ──

  fastify.get("/pages", { onRequest: [fastify.requireAbility("seo.read")] }, async (_request, reply) => {
    return successResponse(reply, "Success", 200, { items: await seoRows(prisma, await settings()), limits: SEO_LIMITS });
  });

  const pageBody = z.object({
    path: z.string().max(300),
    title: text(120).optional(),
    description: text(320).optional(),
    imageUrl: image.optional(),
    noindex: z.boolean().default(false),
  });

  fastify.put("/pages", { onRequest: [fastify.requireAbility("seo.update")] }, async (request, reply) => {
    const b = pageBody.parse(request.body ?? {});
    const path = sitePathOr400(b.path);
    const data = { title: b.title || null, description: b.description || null, imageUrl: b.imageUrl || null, noindex: b.noindex, updatedById: getAdminContext(request).id };
    const before = await prisma.seoPage.findUnique({ where: { path } });
    // Nothing left to override: the address goes back to what the page says.
    if (!data.title && !data.description && !data.imageUrl && !data.noindex) {
      if (before) await prisma.seoPage.delete({ where: { id: before.id } });
      await audit(fastify, request, { action: "seo.page_cleared", targetType: "SeoPage", targetId: before?.id ?? path, before: before ?? undefined });
      notifyWebsite("seo page override");
      return successResponse(reply, "Override removed", 200, null);
    }
    const row = await prisma.seoPage.upsert({ where: { path }, create: { path, ...data }, update: data });
    await audit(fastify, request, { action: "seo.page_saved", targetType: "SeoPage", targetId: row.id, before: before ?? undefined, after: row });
    notifyWebsite("seo page override");
    return successResponse(reply, "Saved", 200, row);
  });

  fastify.delete("/pages/:id", { onRequest: [fastify.requireAbility("seo.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const row = await prisma.seoPage.delete({ where: { id } });
    await audit(fastify, request, { action: "seo.page_cleared", targetType: "SeoPage", targetId: id, before: row });
    notifyWebsite("seo page override");
    return successResponse(reply, "Override removed", 200, { id });
  });

  // ── Redirects ──

  fastify.get("/redirects", { onRequest: [fastify.requireAbility("seo.read")] }, async (request) => {
    const q = pageQuerySchema.parse(request.query);
    const where = q.search ? { OR: [{ fromPath: { contains: q.search, mode: "insensitive" as const } }, { toUrl: { contains: q.search, mode: "insensitive" as const } }] } : {};
    const [rows, total] = await Promise.all([prisma.seoRedirect.findMany({ where, orderBy: [{ hits: "desc" }, { createdAt: "desc" }], ...skipTake(q) }), prisma.seoRedirect.count({ where })]);
    return page(rows, total, q);
  });

  const redirectBody = z.object({ from: z.string().max(300), to: z.string().max(1000), permanent: z.boolean().default(true), note: text(200).default("") });

  /** Checks a rule against the others; returns it in stored form. */
  const checked = async (b: { from: string; to: string; permanent: boolean }, exceptId?: string) => {
    const from = sitePathOr400(b.from, "Old address", true);
    if (from === "/" || from === "/*") throw new ValidationError("Old address: the home page can't be redirected");
    const to = redirectTargetOr400(b.to, from.endsWith("/*"));
    if (to === from) throw new ValidationError("The target is the same address");
    assertNoLoop(await rules(exceptId), { from, to, permanent: b.permanent });
    return { from, to };
  };
  const taken = (err: unknown) => {
    if ((err as { code?: string }).code === "P2002") throw new ConflictError("There is already a redirect from that address");
    throw err;
  };

  fastify.post("/redirects", { onRequest: [fastify.requireAbility("seo.update")] }, async (request, reply) => {
    const b = redirectBody.parse(request.body ?? {});
    const { from, to } = await checked(b);
    const row = await prisma.seoRedirect.create({ data: { fromPath: from, toUrl: to, permanent: b.permanent, note: b.note, createdById: getAdminContext(request).id } }).catch(taken);
    // It is no longer a dead address.
    await prisma.seoNotFound.deleteMany({ where: { path: from } });
    await audit(fastify, request, { action: "seo.redirect_created", targetType: "SeoRedirect", targetId: row.id, after: row });
    notifyWebsite("redirects");
    return successResponse(reply, "Redirect added", 201, row);
  });

  fastify.post("/redirects/bulk", { onRequest: [fastify.requireAbility("seo.update")] }, async (request, reply) => {
    const { lines } = z.object({ lines: z.string().max(200_000) }).parse(request.body ?? {});
    const parsed = lines
      .split(/\r?\n/)
      .map((l, i) => ({ line: i + 1, parts: l.trim().split(/[\s,;]+/).filter(Boolean) }))
      .filter((l) => l.parts.length && !l.parts[0].startsWith("#"));
    if (parsed.length > 1000) throw new ValidationError("At most 1000 redirects at once");
    const errors: Array<{ line: number; message: string }> = [];
    let created = 0;
    let updated = 0;
    const admin = getAdminContext(request).id;
    for (const { line, parts } of parsed) {
      try {
        if (parts.length < 2 || parts.length > 3 || (parts[2] && !["301", "302", "308", "307"].includes(parts[2]))) throw new ValidationError("Write: old-address new-address [301|302]");
        const permanent = !parts[2] || parts[2] === "301" || parts[2] === "308";
        const existing = await prisma.seoRedirect.findUnique({ where: { fromPath: sitePathOr400(parts[0], "Old address", true) } });
        const { from, to } = await checked({ from: parts[0], to: parts[1], permanent }, existing?.id);
        if (existing) {
          await prisma.seoRedirect.update({ where: { id: existing.id }, data: { toUrl: to, permanent } });
          updated++;
        } else {
          await prisma.seoRedirect.create({ data: { fromPath: from, toUrl: to, permanent, createdById: admin } });
          created++;
        }
        await prisma.seoNotFound.deleteMany({ where: { path: from } });
      } catch (err) {
        errors.push({ line, message: (err as Error).message });
      }
    }
    await audit(fastify, request, { action: "seo.redirects_imported", targetType: "SeoRedirect", targetId: "bulk", after: { created, updated, errors: errors.length } });
    if (created || updated) notifyWebsite("redirects");
    return successResponse(reply, `${created} added, ${updated} replaced${errors.length ? `, ${errors.length} skipped` : ""}`, 200, { created, updated, errors });
  });

  fastify.patch("/redirects/:id", { onRequest: [fastify.requireAbility("seo.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const b = redirectBody.partial().parse(request.body ?? {});
    const before = await prisma.seoRedirect.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Redirect not found");
    const permanent = b.permanent ?? before.permanent;
    const { from, to } = await checked({ from: b.from ?? before.fromPath, to: b.to ?? before.toUrl, permanent }, id);
    const row = await prisma.seoRedirect.update({ where: { id }, data: { fromPath: from, toUrl: to, permanent, ...(b.note !== undefined ? { note: b.note } : {}) } }).catch(taken);
    await audit(fastify, request, { action: "seo.redirect_updated", targetType: "SeoRedirect", targetId: id, before, after: row });
    notifyWebsite("redirects");
    return successResponse(reply, "Saved", 200, row);
  });

  fastify.delete("/redirects/:id", { onRequest: [fastify.requireAbility("seo.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const row = await prisma.seoRedirect.delete({ where: { id } });
    await audit(fastify, request, { action: "seo.redirect_deleted", targetType: "SeoRedirect", targetId: id, before: row });
    notifyWebsite("redirects");
    return successResponse(reply, "Redirect removed", 200, { id });
  });

  // ── Not found ──

  fastify.get("/not-found", { onRequest: [fastify.requireAbility("seo.read")] }, async (request) => {
    const q = pageQuerySchema.parse(request.query);
    const where = q.search ? { path: { contains: q.search, mode: "insensitive" as const } } : {};
    const [rows, total] = await Promise.all([prisma.seoNotFound.findMany({ where, orderBy: [{ hits: "desc" }, { lastAt: "desc" }], ...skipTake(q) }), prisma.seoNotFound.count({ where })]);
    return page(rows, total, q);
  });

  fastify.delete("/not-found/:id", { onRequest: [fastify.requireAbility("seo.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await prisma.seoNotFound.delete({ where: { id } });
    return successResponse(reply, "Dismissed", 200, { id });
  });

  fastify.delete("/not-found", { onRequest: [fastify.requireAbility("seo.update")] }, async (request, reply) => {
    const { count } = await prisma.seoNotFound.deleteMany({});
    await audit(fastify, request, { action: "seo.not_found_cleared", targetType: "SeoNotFound", targetId: "all", after: { count } });
    return successResponse(reply, `Cleared ${count}`, 200, { count });
  });
}
