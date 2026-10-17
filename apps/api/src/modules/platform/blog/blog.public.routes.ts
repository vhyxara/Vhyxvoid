// /api/v1/public/blog — what the website reads. Only visible posts
// (published, publishedAt passed). Cached 60 s by browsers and proxies; the
// website also caches them under its "cms" tag, refreshed on every change.
//
//   GET /posts?page&limit&category=<slug>&tag=<slug>&author=<slug>&q=   summaries, newest first, plus the newest featured post on page 1
//   GET /posts/:slug                                      the post and up to 3 related ones; { redirect } for an old slug
//   GET /taxonomy                                         categories and tags that have visible posts, with counts
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { NotFoundError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { prismaOf } from "../shared/http";
import { summary, summarySelect, visibleWhere } from "./blog.service";

/** What visitors see of an author: the profile, never ids or dates. */
const authorProfileSelect = { slug: true, name: true, title: true, bio: true, avatarUrl: true, website: true, twitter: true, github: true, linkedin: true } as const;

const slug = z.string().trim().toLowerCase().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export async function publicBlogRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const cache = (reply: { header(k: string, v: string): unknown }) => reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");

  fastify.get("/posts", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(12),
        category: slug.optional(),
        tag: slug.optional(),
        author: slug.optional(),
        q: z.string().trim().max(100).optional(),
      })
      .parse(request.query ?? {});
    const where = {
      ...visibleWhere(),
      ...(q.category ? { category: { slug: q.category } } : {}),
      ...(q.tag ? { tags: { some: { tag: { slug: q.tag } } } } : {}),
      ...(q.author ? { author: { slug: q.author } } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" as const } }, { excerpt: { contains: q.q, mode: "insensitive" as const } }, { body: { contains: q.q, mode: "insensitive" as const } }] } : {}),
    };
    const [rows, total, featured] = await Promise.all([
      prisma.blogPost.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.limit, take: q.limit, select: summarySelect }),
      prisma.blogPost.count({ where }),
      // The newest featured post leads the first page of the unfiltered list.
      q.page === 1 && !q.category && !q.tag && !q.author && !q.q ? prisma.blogPost.findFirst({ where: { ...visibleWhere(), featured: true }, orderBy: { publishedAt: "desc" }, select: summarySelect }) : null,
    ]);
    const [category, tag, author] = await Promise.all([
      q.category ? prisma.blogCategory.findUnique({ where: { slug: q.category }, select: { slug: true, name: true, description: true } }) : null,
      q.tag ? prisma.blogTag.findUnique({ where: { slug: q.tag }, select: { slug: true, name: true } }) : null,
      q.author ? prisma.blogAuthor.findUnique({ where: { slug: q.author }, select: authorProfileSelect }) : null,
    ]);
    if ((q.category && !category) || (q.tag && !tag) || (q.author && !author)) throw new NotFoundError(q.category ? "Category not found" : q.tag ? "Tag not found" : "Author not found");
    cache(reply);
    return successResponse(reply, "Success", 200, {
      items: rows.map(summary),
      featured: featured ? summary(featured) : null,
      category,
      tag,
      author,
      meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    });
  });

  fastify.get<{ Params: { slug: string } }>("/posts/:slug", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = slug.safeParse(request.params.slug);
    if (!parsed.success) throw new NotFoundError("Post not found");
    const now = new Date();
    const post = await prisma.blogPost.findFirst({ where: { ...visibleWhere(now), slug: parsed.data }, select: { ...summarySelect, id: true, body: true, seoTitle: true, seoDescription: true, categoryId: true, author: { select: authorProfileSelect } } });
    if (!post) {
      // An old address of a post that was renamed.
      const moved = await prisma.blogPost.findFirst({ where: { ...visibleWhere(now), previousSlugs: { has: parsed.data } }, select: { slug: true } });
      if (moved) {
        cache(reply);
        return successResponse(reply, "Moved", 200, { redirect: moved.slug });
      }
      throw new NotFoundError("Post not found");
    }
    // Related: same category or a shared tag, newest first.
    const tagSlugs = post.tags.map((t) => t.tag.slug);
    const related = await prisma.blogPost.findMany({
      where: {
        ...visibleWhere(now),
        NOT: { id: post.id },
        OR: [...(post.categoryId ? [{ categoryId: post.categoryId }] : []), ...(tagSlugs.length ? [{ tags: { some: { tag: { slug: { in: tagSlugs } } } } }] : [])],
      },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: summarySelect,
    });
    cache(reply);
    return successResponse(reply, "Success", 200, {
      post: { ...summary(post), author: post.author, body: post.body, seoTitle: post.seoTitle, seoDescription: post.seoDescription },
      related: post.categoryId || tagSlugs.length ? related.map(summary) : [],
    });
  });

  fastify.get("/taxonomy", async (_request, reply) => {
    const where = visibleWhere();
    const [categories, tags] = await Promise.all([
      prisma.blogCategory.findMany({ where: { posts: { some: where } }, orderBy: { name: "asc" }, select: { slug: true, name: true, description: true, _count: { select: { posts: { where } } } } }),
      prisma.blogTag.findMany({ where: { posts: { some: { post: where } } }, orderBy: { name: "asc" }, select: { slug: true, name: true, _count: { select: { posts: { where: { post: where } } } } } }),
    ]);
    cache(reply);
    return successResponse(reply, "Success", 200, {
      categories: categories.map(({ _count, ...c }) => ({ ...c, count: _count.posts })),
      tags: tags.map(({ _count, ...t }) => ({ ...t, count: _count.posts })),
    });
  });
}
