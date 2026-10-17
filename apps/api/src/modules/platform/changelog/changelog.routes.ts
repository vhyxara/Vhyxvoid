// The changelog: release notes written in the admin panel, shown on the
// website at /changelog (with an RSS feed).
//
//   GET    /api/v1/public/changelog?page&limit        published entries, newest first
//   GET    /api/v1/admin/changelog                    every entry (changelog.read)
//   POST   /api/v1/admin/changelog                    create a draft (changelog.update)
//   PATCH  /api/v1/admin/changelog/:id                edit; status PUBLISHED publishes, dated now unless a date is given (changelog.update)
//   DELETE /api/v1/admin/changelog/:id                (changelog.delete)
//
// An entry dated in the future shows from that date, like a scheduled post.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { NotFoundError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getAdminContext } from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";
import { notifyWebsite } from "../content/revalidate";
import { audit, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";

export const CHANGELOG_KINDS = ["new", "improved", "fixed", "security"] as const;

/** Entries visitors can see. */
export const changelogVisible = (now = new Date()) => ({ status: "PUBLISHED" as const, publishedAt: { lte: now } });

const input = z.object({
  version: z.string().trim().max(40).optional(),
  title: z.string().trim().min(1, "Give the entry a title").max(160).optional(),
  body: z.string().max(50_000).optional(),
  kinds: z.array(z.enum(CHANGELOG_KINDS)).max(4).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  publishedAt: z.coerce.date().nullable().optional(),
});

export async function publicChangelogRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  fastify.get("/", async (request, reply) => {
    const q = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const where = changelogVisible();
    const [items, total] = await Promise.all([
      prisma.changelogEntry.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.limit, take: q.limit, select: { id: true, version: true, title: true, body: true, kinds: true, publishedAt: true, updatedAt: true } }),
      prisma.changelogEntry.count({ where }),
    ]);
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=240");
    return successResponse(reply, "Success", 200, { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) });
  });
}

export async function adminChangelogRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  // The footer's "Changelog" link comes and goes with the first entry: drop its cache too.
  const refresh = () => (fastify.platformContent ? fastify.platformContent.invalidate("changelog") : notifyWebsite("changelog"));
  const idParams = z.object({ id: z.string().uuid() });

  fastify.get("/", { onRequest: [fastify.requireAbility("changelog.read")] }, async (request) => {
    const q = pageQuerySchema.parse(request.query);
    const where = q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" as const } }, { version: { contains: q.search, mode: "insensitive" as const } }] } : {};
    const [items, total] = await Promise.all([
      prisma.changelogEntry.findMany({ where, orderBy: [{ status: "asc" }, { publishedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], ...skipTake(q) }),
      prisma.changelogEntry.count({ where }),
    ]);
    return page(items, total, q);
  });

  fastify.post("/", { onRequest: [fastify.requireAbility("changelog.update")] }, async (request, reply) => {
    const b = input.extend({ title: z.string().trim().min(1, "Give the entry a title").max(160) }).parse(request.body ?? {});
    const admin = getAdminContext(request);
    const publish = b.status === "PUBLISHED";
    const row = await prisma.changelogEntry.create({
      data: { version: b.version ?? "", title: b.title, body: b.body ?? "", kinds: b.kinds ?? [], status: b.status ?? "DRAFT", publishedAt: publish ? (b.publishedAt ?? new Date()) : (b.publishedAt ?? null), createdById: admin.id },
    });
    await audit(fastify, request, { action: "changelog.created", targetType: "ChangelogEntry", targetId: row.id, after: { title: row.title, status: row.status } });
    if (publish) refresh();
    return successResponse(reply, "Created", 201, row);
  });

  fastify.patch("/:id", { onRequest: [fastify.requireAbility("changelog.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const b = input.parse(request.body ?? {});
    const before = await prisma.changelogEntry.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Entry not found");
    // Publishing without a date dates it now; an entry published before keeps its date.
    const publishedAt = b.publishedAt !== undefined ? b.publishedAt : b.status === "PUBLISHED" && !before.publishedAt ? new Date() : undefined;
    const row = await prisma.changelogEntry.update({
      where: { id },
      data: {
        ...(b.version !== undefined ? { version: b.version } : {}),
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.body !== undefined ? { body: b.body } : {}),
        ...(b.kinds !== undefined ? { kinds: b.kinds } : {}),
        ...(b.status !== undefined ? { status: b.status } : {}),
        ...(publishedAt !== undefined ? { publishedAt: datedIfPublished(publishedAt, b.status ?? before.status) } : {}),
      },
    });
    await audit(fastify, request, { action: b.status && b.status !== before.status ? (b.status === "PUBLISHED" ? "changelog.published" : "changelog.unpublished") : "changelog.updated", targetType: "ChangelogEntry", targetId: id, before: { title: before.title, status: before.status }, after: { title: row.title, status: row.status } });
    if (before.status === "PUBLISHED" || row.status === "PUBLISHED") refresh();
    return successResponse(reply, "Saved", 200, row);
  });

  fastify.delete("/:id", { onRequest: [fastify.requireAbility("changelog.delete")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const before = await prisma.changelogEntry.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Entry not found");
    await prisma.changelogEntry.delete({ where: { id } });
    await audit(fastify, request, { action: "changelog.deleted", targetType: "ChangelogEntry", targetId: id, before: { title: before.title, status: before.status } });
    if (before.status === "PUBLISHED") refresh();
    return successResponse(reply, "Deleted", 200, { id });
  });
}

/** A published entry always has a date. */
const datedIfPublished = (d: Date | null, status: string) => (d === null && status === "PUBLISHED" ? new Date() : d);
