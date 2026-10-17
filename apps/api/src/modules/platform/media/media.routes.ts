// /api/v1/admin/media — the media library.
//
//   GET    /               images, newest first, without their bytes (media.read)
//   POST   /               upload one image: the raw file as the body, its name in x-filename (media.update)
//   PATCH  /:id            { alt?, filename? } (media.update)
//   GET    /:id/usage      where it is used (media.read)
//   DELETE /:id            refused (409, with the places) while used, unless ?force=true (media.delete)
//
// /api/v1/public/media/:id — the image itself (?thumb=1: the thumbnail),
// cached for a year: an id's bytes never change. The website serves it on its
// own domain at /media/<id>/<filename> (apps/web app/media).
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ConflictError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getAdminContext } from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";
import { audit, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";
import { MEDIA_MAX_BYTES, MEDIA_TYPES, mediaFilename, mediaPath, mediaUsage, processImage } from "./media.service";

const idParams = z.object({ id: z.string().uuid() });
const listSelect = { id: true, filename: true, mime: true, size: true, width: true, height: true, alt: true, createdAt: true, updatedAt: true } as const;
const view = <T extends { id: string; filename: string }>(a: T) => ({ ...a, url: mediaPath(a), thumbUrl: `${mediaPath(a)}?thumb=1` });

export async function adminMediaRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  // The body of an upload is the file itself (no multipart), up to 10 MB.
  fastify.addContentTypeParser(/^image\//, { parseAs: "buffer", bodyLimit: MEDIA_MAX_BYTES }, (_req, body, done) => done(null, body));
  fastify.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MEDIA_MAX_BYTES }, (_req, body, done) => done(null, body));

  fastify.get("/", { onRequest: [fastify.requireAbility("media.read")] }, async (request) => {
    const q = pageQuerySchema.parse(request.query);
    const where = q.search ? { OR: [{ filename: { contains: q.search, mode: "insensitive" as const } }, { alt: { contains: q.search, mode: "insensitive" as const } }] } : {};
    const [rows, total] = await Promise.all([prisma.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, select: listSelect, ...skipTake(q) }), prisma.mediaAsset.count({ where })]);
    return page(rows.map(view), total, q);
  });

  fastify.post("/", { onRequest: [fastify.requireAbility("media.update")], bodyLimit: MEDIA_MAX_BYTES, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body) || !request.body.length) throw new ValidationError(`Send the image as the request body (${MEDIA_TYPES.join(", ")}), at most 10 MB`);
    const name = decodeURIComponent(String(request.headers["x-filename"] ?? "image")).slice(0, 200);
    const alt = decodeURIComponent(String(request.headers["x-alt"] ?? "")).trim().slice(0, 300);
    const img = await processImage(request.body);
    const admin = getAdminContext(request);
    const row = await prisma.mediaAsset.create({
      data: { filename: mediaFilename(name, img.mime), mime: img.mime, size: img.data.length, width: img.width, height: img.height, alt, data: img.data, thumb: img.thumb, createdById: admin.id },
      select: listSelect,
    });
    await audit(fastify, request, { action: "media.uploaded", targetType: "MediaAsset", targetId: row.id, after: { filename: row.filename, size: row.size } });
    return successResponse(reply, "Uploaded", 201, view(row));
  });

  fastify.patch("/:id", { onRequest: [fastify.requireAbility("media.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const b = z.object({ alt: z.string().trim().max(300).optional(), filename: z.string().trim().min(1).max(200).optional() }).parse(request.body ?? {});
    const before = await prisma.mediaAsset.findUnique({ where: { id }, select: listSelect });
    if (!before) throw new NotFoundError("Image not found");
    // Renaming changes the address; the old one keeps working (the website looks images up by id).
    const row = await prisma.mediaAsset.update({ where: { id }, data: { ...(b.alt !== undefined ? { alt: b.alt } : {}), ...(b.filename ? { filename: mediaFilename(b.filename, before.mime) } : {}) }, select: listSelect });
    await audit(fastify, request, { action: "media.updated", targetType: "MediaAsset", targetId: id, before, after: row });
    return successResponse(reply, "Saved", 200, view(row));
  });

  fastify.get("/:id/usage", { onRequest: [fastify.requireAbility("media.read")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return successResponse(reply, "Success", 200, await mediaUsage(prisma, id));
  });

  fastify.delete("/:id", { onRequest: [fastify.requireAbility("media.delete")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { force } = z.object({ force: z.coerce.boolean().default(false) }).parse(request.query ?? {});
    const row = await prisma.mediaAsset.findUnique({ where: { id }, select: listSelect });
    if (!row) throw new NotFoundError("Image not found");
    const used = await mediaUsage(prisma, id);
    if (used.length && !force) throw new ConflictError(`Still used in ${used.length} place(s): ${used.slice(0, 3).map((u) => u.label).join(", ")}${used.length > 3 ? "…" : ""}. Remove it there first, or delete anyway.`);
    await prisma.mediaAsset.delete({ where: { id } });
    await audit(fastify, request, { action: "media.deleted", targetType: "MediaAsset", targetId: id, before: { ...row, usedIn: used.length } });
    return successResponse(reply, "Deleted", 200, { id });
  });
}

export async function publicMediaRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  fastify.get("/:id", { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) throw new NotFoundError("Image not found");
    const thumb = (request.query as { thumb?: string } | undefined)?.thumb === "1";
    const where = { id: parsed.data.id };
    const row = thumb
      ? await prisma.mediaAsset.findUnique({ where, select: { mime: true, filename: true, thumb: true } }).then((r) => r && { ...r, bytes: r.thumb })
      : await prisma.mediaAsset.findUnique({ where, select: { mime: true, filename: true, data: true } }).then((r) => r && { ...r, bytes: r.data });
    if (!row) throw new NotFoundError("Image not found");
    const body = Buffer.from(row.bytes);
    return reply
      .header("Content-Type", thumb ? "image/webp" : row.mime)
      .header("Content-Length", body.length)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Content-Disposition", `inline; filename="${row.filename}"`)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .send(body);
  });
}
