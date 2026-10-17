// Draft preview: an admin asks for a signed link to the saved working copy
// of a page or a blog post; the website's /preview/<token> shows it with the
// real page layout. Anyone with the link can look until it expires (48 h),
// so a draft can be shown to someone without an admin account. Nothing is
// published and nothing is cached.
//
//   POST /api/v1/admin/preview/content/:id | /post/:id   → { token, path, expiresAt }
//   GET  /api/v1/public/preview?token=  the draft, or 404 when the link is wrong or expired
import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { pagePath } from "@vhyxvoid/content";
import { NotFoundError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { excerptOf, postState } from "../blog/blog.service";
import { withNewSections } from "../content/content.service";
import { prismaOf } from "../shared/http";
import { pepper } from "../specs/specDocs";

export const PREVIEW_HOURS = 48;
type Target = { k: "content" | "post"; id: string; exp: number };

const sign = (payload: string) => createHmac("sha256", `${pepper()}|preview`).update(payload).digest("base64url");

/** "<payload>.<signature>", payload = base64url JSON of what and until when. */
export function signPreview(k: Target["k"], id: string, now = Date.now()): { token: string; expiresAt: Date } {
  const exp = Math.floor(now / 1000) + PREVIEW_HOURS * 3600;
  const payload = Buffer.from(JSON.stringify({ k, id, exp })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(exp * 1000) };
}

export function verifyPreview(token: string, now = Date.now()): Target | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || token.length > 600) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString()) as Target;
    if ((t.k !== "content" && t.k !== "post") || typeof t.id !== "string" || !(t.exp * 1000 > now)) return null;
    return t;
  } catch {
    return null;
  }
}

export async function adminPreviewRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const idParams = z.object({ id: z.string().uuid() });

  // Reading the draft in the console is what a preview link shares, so the read ability is enough.
  fastify.post("/content/:id", { onRequest: [fastify.requireAbility("content.read")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const e = await prisma.contentEntry.findUnique({ where: { id }, select: { slug: true, kind: true } });
    if (!e || e.kind === "footer") throw new NotFoundError("Content entry not found");
    const path = e.kind === "landing" ? "/" : e.kind === "pricing" ? "/pricing" : pagePath(e.slug);
    return successResponse(reply, "Success", 201, { ...signPreview("content", id), path });
  });

  fastify.post("/post/:id", { onRequest: [fastify.requireAbility("blog.read")] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const p = await prisma.blogPost.findUnique({ where: { id }, select: { slug: true } });
    if (!p) throw new NotFoundError("Post not found");
    return successResponse(reply, "Success", 201, { ...signPreview("post", id), path: `/blog/${p.slug}` });
  });
}

export async function publicPreviewRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  // The token travels in the query: it is longer than a route parameter may be (100 characters).
  fastify.get<{ Querystring: { token?: string } }>("/", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const t = verifyPreview(String(request.query?.token ?? ""));
    if (!t) throw new NotFoundError("This preview link is wrong or has expired");
    reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex, nofollow");

    if (t.k === "content") {
      const e = await prisma.contentEntry.findUnique({ where: { id: t.id }, select: { id: true, slug: true, kind: true, title: true, status: true, data: true, seoTitle: true, seoDescription: true, updatedAt: true } });
      if (!e || e.kind === "footer") throw new NotFoundError("This draft no longer exists");
      const { data } = withNewSections(e);
      return successResponse(reply, "Success", 200, { kind: "content", expiresAt: new Date(t.exp * 1000), entry: { slug: e.slug, kind: e.kind, title: e.title, status: e.status, seoTitle: e.seoTitle, seoDescription: e.seoDescription, data, updatedAt: e.updatedAt } });
    }

    const p = await prisma.blogPost.findUnique({
      where: { id: t.id },
      select: { slug: true, title: true, excerpt: true, body: true, coverImageUrl: true, coverImageAlt: true, publishedAt: true, updatedAt: true, readingMinutes: true, authorName: true, featured: true, status: true, seoTitle: true, seoDescription: true, category: { select: { slug: true, name: true } }, tags: { select: { tag: { select: { slug: true, name: true } } } } },
    });
    if (!p) throw new NotFoundError("This draft no longer exists");
    return successResponse(reply, "Success", 200, {
      kind: "post",
      expiresAt: new Date(t.exp * 1000),
      state: postState(p),
      post: { ...p, excerpt: p.excerpt || excerptOf(p), publishedAt: p.publishedAt ?? p.updatedAt, tags: p.tags.map((x) => x.tag) },
    });
  });
}
