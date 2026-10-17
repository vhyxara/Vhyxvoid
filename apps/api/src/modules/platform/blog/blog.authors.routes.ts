// /api/v1/admin/blog/authors — author profiles for the blog.
//
//   GET    /         every author, with post counts (blog.read)
//   POST   /         create (blog.update)
//   PATCH  /:id      edit; a new name is copied to their posts (blog.update)
//   DELETE /:id      their posts stay, signed with the name only (blog.delete)
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ConflictError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { audit, prismaOf } from "../shared/http";
import { blogChanged, slugify } from "./blog.service";

const text = (max: number) => z.string().trim().max(max);
const https = (what: string) => text(300).refine((v) => !v || /^https:\/\/\S+$/i.test(v), `${what}: use an https:// address`);
const handle = (what: string) =>
  text(100)
    // A pasted profile address or "@name" becomes the name.
    .transform((v) => v.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com|github\.com)\//i, "").replace(/^@/, "").replace(/\/.*$/, ""))
    .refine((v) => !v || /^[A-Za-z0-9_-]{1,39}$/.test(v), `${what}: letters, digits, - and _ only`);

export const authorBody = z.object({
  name: text(80).min(1, "Give the author a name"),
  slug: text(80)
    .refine((v) => !v || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v), "Use lowercase letters, digits and -")
    .optional(),
  title: text(120).default(""),
  bio: text(1000).default(""),
  avatarUrl: text(500)
    .refine((v) => !v || /^(https:\/\/\S+|\/(?![/\\])\S*)$/i.test(v), "Use an https:// address or a path on the site")
    .default(""),
  website: https("Website").default(""),
  twitter: handle("X").default(""),
  github: handle("GitHub").default(""),
  linkedin: https("LinkedIn").default(""),
});

export async function adminBlogAuthorRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const idParams = z.object({ id: z.string().uuid() });
  const taken = (err: unknown) => {
    if ((err as { code?: string }).code === "P2002") throw new ConflictError("An author with that address already exists");
    throw err;
  };

  fastify.get("/", { onRequest: [fastify.requireAbility("blog.read")] }, async (_request, reply) => {
    const rows = await prisma.blogAuthor.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { posts: true } } } });
    return successResponse(reply, "Success", 200, rows.map(({ _count, ...a }) => ({ ...a, postCount: _count.posts })));
  });

  fastify.post("/", { onRequest: [fastify.requireAbility("blog.update")] }, async (request, reply) => {
    const b = authorBody.parse(request.body ?? {});
    const slug = b.slug || slugify(b.name);
    if (!slug) throw new ValidationError("Use letters or digits in the name");
    const row = await prisma.blogAuthor.create({ data: { ...b, slug } }).catch(taken);
    await audit(fastify, request, { action: "blog.author_created", targetType: "BlogAuthor", targetId: row.id, after: { name: row.name } });
    return successResponse(reply, "Author created", 201, { ...row, postCount: 0 });
  });

  fastify.patch("/:id", { onRequest: [fastify.requireAbility("blog.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    // Only the fields sent change (no defaults here).
    const b = authorBody.partial().parse(request.body ?? {});
    for (const k of Object.keys(b) as Array<keyof typeof b>) if ((request.body as Record<string, unknown>)?.[k] === undefined) delete b[k];
    const before = await prisma.blogAuthor.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Author not found");
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.blogAuthor.update({ where: { id }, data: { ...b, ...(b.slug === "" ? { slug: before.slug } : {}) } });
      if (b.name && b.name !== before.name) await tx.blogPost.updateMany({ where: { authorId: id }, data: { authorName: b.name } });
      return updated;
    }).catch(taken);
    await audit(fastify, request, { action: "blog.author_updated", targetType: "BlogAuthor", targetId: id, before: { name: before.name, slug: before.slug }, after: { name: row.name, slug: row.slug } });
    blogChanged(`editing author ${row.slug}`);
    return successResponse(reply, "Saved", 200, row);
  });

  fastify.delete("/:id", { onRequest: [fastify.requireAbility("blog.delete")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const before = await prisma.blogAuthor.findUnique({ where: { id }, include: { _count: { select: { posts: true } } } });
    if (!before) throw new NotFoundError("Author not found");
    await prisma.blogAuthor.delete({ where: { id } }); // posts keep authorName (onDelete: SetNull)
    await audit(fastify, request, { action: "blog.author_deleted", targetType: "BlogAuthor", targetId: id, before: { name: before.name, posts: before._count.posts } });
    blogChanged(`deleting author ${before.slug}`);
    return successResponse(reply, "Deleted", 200, { id });
  });
}
