// /api/v1/admin/blog — the blog in the admin panel.
//
//   GET    /posts                     list (blog.read; ?status=DRAFT|SCHEDULED|PUBLISHED, ?category=<id>, ?tag=<id>, ?search)
//   GET    /posts/:id                 one post with its category and tags (blog.read)
//   POST   /posts                     create a draft (blog.update)
//   PUT    /posts/:id                 save (blog.update; expectedUpdatedAt refuses a save over a newer one)
//   POST   /posts/:id/publish         { publishAt? } now, or scheduled for later (blog.publish)
//   POST   /posts/:id/unpublish       back to draft (blog.publish)
//   DELETE /posts/:id                 (blog.delete)
//   GET    /categories | /tags        with post counts (blog.read)
//   POST   /categories | /tags        create (blog.update)
//   PATCH  /categories/:id | /tags/:id  rename, new slug, description (blog.update)
//   DELETE /categories/:id | /tags/:id  posts keep going, without it (blog.delete)
//   POST   /tags/:id/merge            { into } moves its posts to another tag, then deletes it (blog.update)
//
// Posts name their category and tags by name; missing ones are created
// (blog.service.ts categoryFor / tagsFor).
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ConflictError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getAdminContext } from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";
import { audit, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";
import { blogChanged, categoryFor, findPostOr404, postState, readingMinutes, releaseOldSlug, slugify, tagsFor, uniquePostSlug } from "./blog.service";

const text = (max: number) => z.string().trim().max(max);
// A cover image: an https URL or a path on the site. No data: or javascript: URLs.
const imageUrl = text(1000).refine((v) => !v || /^(https:\/\/\S+|\/(?![/\\])\S*)$/i.test(v), "Use an https:// URL or a path starting with /");
const slugInput = text(80).refine((v) => !v || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v), "Use lowercase letters, digits and -");

// The fields of a post, without defaults: a save changes only the fields it
// sends (defaults here would blank a body or drop tags a save left out).
const postFields = z.object({
  title: text(200).min(1, "Give the post a title"),
  slug: slugInput,
  excerpt: text(300),
  body: z.string().max(200_000),
  coverImageUrl: imageUrl.nullable(),
  coverImageAlt: text(200),
  /** A category name: an existing one is reused, a new one is created. null: none. */
  category: text(60).nullable(),
  /** Tag names, reused or created. */
  tags: z.array(text(40).min(1)).max(10, "At most 10 tags"),
  featured: z.boolean(),
  authorName: text(80),
  seoTitle: text(120).nullable(),
  seoDescription: text(300).nullable(),
});
/** Creating a post: a title is enough. */
export const postBody = postFields.partial().required({ title: true }).extend({
  excerpt: postFields.shape.excerpt.default(""),
  body: postFields.shape.body.default(""),
  coverImageAlt: postFields.shape.coverImageAlt.default(""),
  tags: postFields.shape.tags.default([]),
  featured: postFields.shape.featured.default(false),
});
const saveBody = postFields.partial().extend({ expectedUpdatedAt: z.coerce.date().optional() });
const idParams = z.object({ id: z.string().uuid() });

function adminName(a: { firstName?: string | null; lastName?: string | null; email?: string | null } | null) {
  if (!a) return "";
  return [a.firstName, a.lastName].filter(Boolean).join(" ").trim() || (a.email ?? "").split("@")[0];
}

export async function adminBlogRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  const view = (p: Awaited<ReturnType<typeof findPostOr404>>) => ({
    ...p,
    state: postState(p),
    category: p.category ? { id: p.category.id, slug: p.category.slug, name: p.category.name } : null,
    tags: p.tags.map((t) => ({ id: t.tag.id, slug: t.tag.slug, name: t.tag.name })),
  });

  // ── Posts ──
  fastify.get("/posts", { onRequest: [fastify.requireAbility("blog.read")] }, async (request) => {
    const q = pageQuerySchema.extend({ status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED"]).optional(), category: z.string().uuid().optional(), tag: z.string().uuid().optional() }).parse(request.query);
    const now = new Date();
    const where = {
      ...(q.status === "DRAFT" ? { status: "DRAFT" as const } : q.status === "SCHEDULED" ? { status: "PUBLISHED" as const, publishedAt: { gt: now } } : q.status === "PUBLISHED" ? { status: "PUBLISHED" as const, publishedAt: { lte: now } } : {}),
      ...(q.category ? { categoryId: q.category } : {}),
      ...(q.tag ? { tags: { some: { tagId: q.tag } } } : {}),
      ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" as const } }, { slug: { contains: q.search, mode: "insensitive" as const } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        ...skipTake(q),
        select: { id: true, slug: true, title: true, status: true, publishedAt: true, featured: true, updatedAt: true, authorName: true, coverImageUrl: true, category: { select: { id: true, name: true } }, tags: { select: { tag: { select: { id: true, name: true } } } } },
      }),
      prisma.blogPost.count({ where }),
    ]);
    return page(
      rows.map((r) => ({ ...r, state: postState(r, now), tags: r.tags.map((t) => t.tag) })),
      total,
      q,
    );
  });

  fastify.get("/posts/:id", { onRequest: [fastify.requireAbility("blog.read")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return successResponse(reply, "Success", 200, view(await findPostOr404(prisma, id)));
  });

  fastify.post("/posts", { onRequest: [fastify.requireAbility("blog.update")] }, async (request, reply) => {
    const b = postBody.parse(request.body ?? {});
    const admin = getAdminContext(request);
    const me = await prisma.adminUser.findUnique({ where: { id: admin.id }, select: { firstName: true, lastName: true, email: true } }).catch(() => null);
    const row = await prisma.$transaction(async (tx) => {
      const slug = await uniquePostSlug(tx, b.slug || b.title, undefined, Boolean(b.slug));
      const [categoryId, tagIds] = [await categoryFor(tx, b.category), await tagsFor(tx, b.tags)];
      const created = await tx.blogPost.create({
        data: {
          slug,
          title: b.title,
          excerpt: b.excerpt,
          body: b.body,
          coverImageUrl: b.coverImageUrl || null,
          coverImageAlt: b.coverImageAlt,
          featured: b.featured,
          authorName: b.authorName ?? adminName(me ?? { email: admin.email }),
          seoTitle: b.seoTitle || null,
          seoDescription: b.seoDescription || null,
          readingMinutes: readingMinutes(b.body),
          categoryId,
          createdById: admin.id,
          updatedById: admin.id,
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        },
      });
      await releaseOldSlug(tx, slug, created.id);
      return created;
    });
    await audit(fastify, request, { action: "blog.post_created", targetType: "BlogPost", targetId: row.id, after: { slug: row.slug, title: row.title } });
    return successResponse(reply, "Draft created", 201, view(await findPostOr404(prisma, row.id)));
  });

  fastify.put("/posts/:id", { onRequest: [fastify.requireAbility("blog.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const b = saveBody.parse(request.body ?? {});
    const admin = getAdminContext(request);
    const before = await findPostOr404(prisma, id);
    if (b.expectedUpdatedAt && b.expectedUpdatedAt.getTime() !== before.updatedAt.getTime()) {
      throw new ConflictError("Someone saved this post after you opened it. Reload to see their changes, then make yours again.");
    }
    await prisma.$transaction(async (tx) => {
      let slug = before.slug;
      let previousSlugs = before.previousSlugs;
      if (b.slug !== undefined && b.slug && b.slug !== before.slug) {
        slug = await uniquePostSlug(tx, b.slug, id, true);
        // The old address keeps working once the post has been public.
        if (before.status === "PUBLISHED") previousSlugs = [...new Set([...before.previousSlugs, before.slug])].filter((s) => s !== slug).slice(-20);
        await releaseOldSlug(tx, slug, id);
      }
      const categoryId = b.category !== undefined ? await categoryFor(tx, b.category) : undefined;
      const tagIds = b.tags !== undefined ? await tagsFor(tx, b.tags) : undefined;
      if (tagIds) {
        await tx.blogPostTag.deleteMany({ where: { postId: id } });
        if (tagIds.length) await tx.blogPostTag.createMany({ data: tagIds.map((tagId) => ({ postId: id, tagId })) });
      }
      const res = await tx.blogPost.updateMany({
        where: { id, updatedAt: before.updatedAt },
        data: {
          slug,
          previousSlugs,
          ...(b.title !== undefined ? { title: b.title } : {}),
          ...(b.excerpt !== undefined ? { excerpt: b.excerpt } : {}),
          ...(b.body !== undefined ? { body: b.body, readingMinutes: readingMinutes(b.body) } : {}),
          ...(b.coverImageUrl !== undefined ? { coverImageUrl: b.coverImageUrl || null } : {}),
          ...(b.coverImageAlt !== undefined ? { coverImageAlt: b.coverImageAlt } : {}),
          ...(b.featured !== undefined ? { featured: b.featured } : {}),
          ...(b.authorName !== undefined ? { authorName: b.authorName } : {}),
          ...(b.seoTitle !== undefined ? { seoTitle: b.seoTitle || null } : {}),
          ...(b.seoDescription !== undefined ? { seoDescription: b.seoDescription || null } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
          updatedById: admin.id,
        },
      });
      if (!res.count) throw new ConflictError("Someone saved this post at the same moment. Reload and try again.");
    });
    const after = await findPostOr404(prisma, id);
    await audit(fastify, request, { action: "blog.post_updated", targetType: "BlogPost", targetId: id, before: { slug: before.slug, title: before.title }, after: { slug: after.slug, title: after.title } });
    if (before.status === "PUBLISHED") blogChanged(`saving post ${after.slug}`);
    return successResponse(reply, "Saved", 200, view(after));
  });

  fastify.post("/posts/:id/publish", { onRequest: [fastify.requireAbility("blog.publish")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { publishAt } = z.object({ publishAt: z.coerce.date().optional() }).parse(request.body ?? {});
    const before = await findPostOr404(prisma, id);
    if (!before.title.trim() || !before.body.trim()) throw new ValidationError("Write the post before publishing it: it needs a title and some text.");
    // Re-publishing keeps the original date unless a new one is given.
    const at = publishAt ?? (before.status === "PUBLISHED" && before.publishedAt ? before.publishedAt : new Date());
    await prisma.blogPost.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: at, updatedById: getAdminContext(request).id } });
    const after = await findPostOr404(prisma, id);
    const state = postState(after);
    await audit(fastify, request, { action: state === "SCHEDULED" ? "blog.post_scheduled" : "blog.post_published", targetType: "BlogPost", targetId: id, after: { slug: after.slug, publishedAt: at } });
    blogChanged(`publishing post ${after.slug}`);
    return successResponse(reply, state === "SCHEDULED" ? `Scheduled for ${at.toISOString()}` : "Published", 200, view(after));
  });

  fastify.post("/posts/:id/unpublish", { onRequest: [fastify.requireAbility("blog.publish")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await findPostOr404(prisma, id);
    await prisma.blogPost.update({ where: { id }, data: { status: "DRAFT", publishedAt: null, updatedById: getAdminContext(request).id } });
    const after = await findPostOr404(prisma, id);
    await audit(fastify, request, { action: "blog.post_unpublished", targetType: "BlogPost", targetId: id, after: { slug: after.slug } });
    blogChanged(`unpublishing post ${after.slug}`);
    return successResponse(reply, "Back to draft", 200, view(after));
  });

  fastify.delete("/posts/:id", { onRequest: [fastify.requireAbility("blog.delete")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const before = await findPostOr404(prisma, id);
    await prisma.blogPost.delete({ where: { id } });
    await audit(fastify, request, { action: "blog.post_deleted", targetType: "BlogPost", targetId: id, before: { slug: before.slug, title: before.title } });
    if (before.status === "PUBLISHED") blogChanged(`deleting post ${before.slug}`);
    return successResponse(reply, "Deleted", 200, { id });
  });

  // ── Categories and tags ──
  const nameBody = z.object({ name: text(60).min(1, "Give it a name"), slug: slugInput.optional(), description: text(300).optional() });

  fastify.get("/categories", { onRequest: [fastify.requireAbility("blog.read")] }, async (_request, reply) => {
    const rows = await prisma.blogCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { posts: true } } } });
    return successResponse(reply, "Success", 200, rows.map(({ _count, ...c }) => ({ ...c, postCount: _count.posts })));
  });

  fastify.get("/tags", { onRequest: [fastify.requireAbility("blog.read")] }, async (_request, reply) => {
    const rows = await prisma.blogTag.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { posts: true } } } });
    return successResponse(reply, "Success", 200, rows.map(({ _count, ...t }) => ({ ...t, postCount: _count.posts })));
  });

  const created = (what: string) => (err: unknown) => {
    if ((err as { code?: string }).code === "P2002") throw new ConflictError(`A ${what} with that slug already exists`);
    throw err;
  };

  fastify.post("/categories", { onRequest: [fastify.requireAbility("blog.update")] }, async (request, reply) => {
    const b = nameBody.parse(request.body ?? {});
    const slug = b.slug || slugify(b.name);
    if (!slug) throw new ValidationError("Use letters or digits in the name");
    const row = await prisma.blogCategory.create({ data: { name: b.name, slug, description: b.description ?? "" } }).catch(created("category"));
    await audit(fastify, request, { action: "blog.category_created", targetType: "BlogCategory", targetId: row.id, after: { name: row.name } });
    return successResponse(reply, "Category created", 201, { ...row, postCount: 0 });
  });

  fastify.post("/tags", { onRequest: [fastify.requireAbility("blog.update")] }, async (request, reply) => {
    const b = nameBody.omit({ description: true }).parse(request.body ?? {});
    const slug = b.slug || slugify(b.name);
    if (!slug) throw new ValidationError("Use letters or digits in the name");
    const row = await prisma.blogTag.create({ data: { name: b.name, slug } }).catch(created("tag"));
    await audit(fastify, request, { action: "blog.tag_created", targetType: "BlogTag", targetId: row.id, after: { name: row.name } });
    return successResponse(reply, "Tag created", 201, { ...row, postCount: 0 });
  });

  fastify.patch("/categories/:id", { onRequest: [fastify.requireAbility("blog.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const b = nameBody.partial().parse(request.body ?? {});
    const before = await prisma.blogCategory.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Category not found");
    const row = await prisma.blogCategory.update({ where: { id }, data: { ...(b.name ? { name: b.name } : {}), ...(b.slug ? { slug: b.slug } : {}), ...(b.description !== undefined ? { description: b.description } : {}) } }).catch(created("category"));
    await audit(fastify, request, { action: "blog.category_updated", targetType: "BlogCategory", targetId: id, before: { name: before.name, slug: before.slug }, after: { name: row.name, slug: row.slug } });
    blogChanged(`editing category ${row.slug}`);
    return successResponse(reply, "Saved", 200, row);
  });

  fastify.patch("/tags/:id", { onRequest: [fastify.requireAbility("blog.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const b = nameBody.omit({ description: true }).partial().parse(request.body ?? {});
    const before = await prisma.blogTag.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Tag not found");
    const row = await prisma.blogTag.update({ where: { id }, data: { ...(b.name ? { name: b.name } : {}), ...(b.slug ? { slug: b.slug } : {}) } }).catch(created("tag"));
    await audit(fastify, request, { action: "blog.tag_updated", targetType: "BlogTag", targetId: id, before: { name: before.name, slug: before.slug }, after: { name: row.name, slug: row.slug } });
    blogChanged(`editing tag ${row.slug}`);
    return successResponse(reply, "Saved", 200, row);
  });

  fastify.delete("/categories/:id", { onRequest: [fastify.requireAbility("blog.delete")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const before = await prisma.blogCategory.findUnique({ where: { id }, include: { _count: { select: { posts: true } } } });
    if (!before) throw new NotFoundError("Category not found");
    await prisma.blogCategory.delete({ where: { id } }); // posts keep going, uncategorized (onDelete: SetNull)
    await audit(fastify, request, { action: "blog.category_deleted", targetType: "BlogCategory", targetId: id, before: { name: before.name, posts: before._count.posts } });
    blogChanged(`deleting category ${before.slug}`);
    return successResponse(reply, before._count.posts ? `Deleted; ${before._count.posts} post(s) now have no category` : "Deleted", 200, { id });
  });

  fastify.delete("/tags/:id", { onRequest: [fastify.requireAbility("blog.delete")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const before = await prisma.blogTag.findUnique({ where: { id }, include: { _count: { select: { posts: true } } } });
    if (!before) throw new NotFoundError("Tag not found");
    await prisma.blogTag.delete({ where: { id } });
    await audit(fastify, request, { action: "blog.tag_deleted", targetType: "BlogTag", targetId: id, before: { name: before.name, posts: before._count.posts } });
    blogChanged(`deleting tag ${before.slug}`);
    return successResponse(reply, "Deleted", 200, { id });
  });

  fastify.post("/tags/:id/merge", { onRequest: [fastify.requireAbility("blog.update")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { into } = z.object({ into: z.string().uuid() }).parse(request.body ?? {});
    if (into === id) throw new ValidationError("Pick another tag to merge into");
    const [from, to] = await Promise.all([prisma.blogTag.findUnique({ where: { id } }), prisma.blogTag.findUnique({ where: { id: into } })]);
    if (!from || !to) throw new NotFoundError("Tag not found");
    const moved = await prisma.$transaction(async (tx) => {
      const links = await tx.blogPostTag.findMany({ where: { tagId: id }, select: { postId: true } });
      await tx.blogPostTag.createMany({ data: links.map((l) => ({ postId: l.postId, tagId: into })), skipDuplicates: true });
      await tx.blogTag.delete({ where: { id } });
      return links.length;
    });
    await audit(fastify, request, { action: "blog.tag_merged", targetType: "BlogTag", targetId: into, before: { name: from.name }, after: { name: to.name, posts: moved } });
    blogChanged(`merging tag ${from.slug}`);
    return successResponse(reply, `Merged "${from.name}" into "${to.name}"`, 200, { into, posts: moved });
  });
}
