// /api/v1/public — unauthenticated, cacheable reads for the website and apps.
import type { FastifyInstance } from "fastify";
import { Plan, currentStripePrices } from "@vhyxvoid/shared";
import { Prisma } from "@/generated/prisma";
import { effectivePlanLimits } from "@vhyxvoid/shared";
import { NotFoundError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { slugSchema } from "../content/content.schemas";
import { DEFAULT_CONTENT } from "../content/content.defaults";
import { prismaOf } from "../shared/http";
import { visibleWhere } from "../blog/blog.service";
import { changelogVisible } from "../changelog/changelog.routes";

const serializeLimits = (o: object) => JSON.parse(JSON.stringify(o, (_k, v) => (v === Infinity ? null : v)));

export async function publicRoutes(fastify: FastifyInstance) {
  const cache = (reply: { header(k: string, v: string): unknown }, seconds = 30) =>
    reply.header("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`);

  /**
   * Everything the site shell needs in one request: public settings and the
   * footer menu. `footer` (pages flagged for the footer) is what websites from
   * before the footer menu read; current ones use `footerMenu`.
   */
  fastify.get("/bootstrap", async (_request, reply) => {
    cache(reply);
    const [settings, footer, footerMenu, blogPosts, changelogEntries] = await Promise.all([
      fastify.platformSettings.publicValues(),
      fastify.platformContent.footerLinks(),
      fastify.platformContent.footerMenu(),
      // The navbar shows "Blog" once there is something to read.
      prismaOf(fastify).blogPost.count({ where: visibleWhere() }).catch(() => 0),
      prismaOf(fastify).changelogEntry.count({ where: changelogVisible() }).catch(() => 0),
    ]);
    return successResponse(reply, "Success", 200, { settings, footer, footerMenu, blog: { posts: blogPosts }, changelog: { entries: changelogEntries } });
  });

  fastify.get("/settings", async (_request, reply) => {
    cache(reply);
    return successResponse(reply, "Success", 200, await fastify.platformSettings.publicValues());
  });

  /** Published content by slug (slugs may contain "/", e.g. legal/terms). */
  fastify.get<{ Params: { "*": string } }>("/content/*", async (request, reply) => {
    const parsed = slugSchema.safeParse(request.params["*"]);
    if (!parsed.success) throw new NotFoundError("Page not found");
    const entry = await fastify.platformContent.getPublished(parsed.data);
    if (!entry) throw new NotFoundError("Page not found");
    cache(reply, 60);
    return successResponse(reply, "Success", 200, entry);
  });

  /**
   * Every public address the CMS and blog own, with when it last changed, for
   * the website's sitemap.xml. Pages are kind "page" (landing and pricing are
   * fixed routes the website lists itself).
   */
  fastify.get("/sitemap", async (_request, reply) => {
    const prisma = prismaOf(fastify);
    const visible = visibleWhere();
    const [pages, posts, categories, tags, changelog, authors] = await Promise.all([
      prisma.contentEntry.findMany({ where: { kind: "page", status: "PUBLISHED", publishedData: { not: Prisma.DbNull } }, select: { slug: true, publishedAt: true, updatedAt: true }, orderBy: { slug: "asc" }, take: 5000 }),
      prisma.blogPost.findMany({ where: visible, select: { slug: true, updatedAt: true }, orderBy: { publishedAt: "desc" }, take: 5000 }),
      prisma.blogCategory.findMany({ where: { posts: { some: visible } }, select: { slug: true }, orderBy: { slug: "asc" } }),
      prisma.blogTag.findMany({ where: { posts: { some: { post: visible } } }, select: { slug: true }, orderBy: { slug: "asc" } }),
      prisma.changelogEntry.findFirst({ where: changelogVisible(), orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      prisma.blogAuthor.findMany({ where: { posts: { some: visible } }, select: { slug: true }, orderBy: { slug: "asc" } }),
    ]);
    // Addresses the SEO screen hides from search engines stay out of the sitemap too.
    const hidden = new Set((await prisma.seoPage.findMany({ where: { noindex: true }, select: { path: true } })).map((p) => p.path));
    cache(reply, 300);
    return successResponse(reply, "Success", 200, {
      // Built-in pages (terms, privacy, about, contact) are live until replaced.
      pages: [
        ...pages,
        ...DEFAULT_CONTENT.filter((d) => d.kind === "page" && !pages.some((p) => p.slug === d.slug)).map((d) => ({ slug: d.slug, publishedAt: null, updatedAt: null })),
      ]
        .filter((p) => !hidden.has(`/${p.slug}`))
        .map((p) => ({ slug: p.slug, updatedAt: p.publishedAt ?? p.updatedAt })),
      posts: posts.filter((p) => !hidden.has(`/blog/${p.slug}`)),
      hidden: [...hidden],
      categories: categories.map((c) => c.slug).filter((s) => !hidden.has(`/blog/category/${s}`)),
      tags: tags.map((t) => t.slug),
      authors: authors.map((a) => a.slug).filter((s) => !hidden.has(`/blog/author/${s}`)),
      // The /changelog page, when it has entries: last changed with its newest edit.
      changelog: changelog && !hidden.has("/changelog") ? { updatedAt: changelog.updatedAt } : null,
    });
  });

  /** Plan limits as they apply right now (admin overrides included), for pricing pages. */
  fastify.get("/plans", async (_request, reply) => {
    cache(reply, 60);
    const overrides = await fastify.platformSettings.get("plans.overrides");
    const get = fastify.platformSettings.get.bind(fastify.platformSettings);
    const [mode, defaultPlan, freeModeMessage, checkoutEnabled, trialDays, prices] = await Promise.all([
      get("billing.mode"),
      get("billing.defaultPlan"),
      get("billing.freeModeMessage"),
      get("billing.checkoutEnabled"),
      get("billing.trialDays"),
      currentStripePrices(),
    ]);
    return successResponse(reply, "Success", 200, {
      mode,
      defaultPlan,
      freeModeMessage,
      // Buying is possible only in paid mode with upgrades switched on.
      checkoutEnabled: mode === "paid" && checkoutEnabled,
      trialDays,
      // Which plans can be bought yearly (a yearly Stripe price is set); the IDs stay private.
      yearly: { PRO: !!prices.PRO_YEARLY, ENTERPRISE: !!prices.ENTERPRISE_YEARLY },
      plans: [Plan.FREE, Plan.PRO, Plan.ENTERPRISE].map((plan) => ({ plan, limits: serializeLimits(effectivePlanLimits(plan, overrides)) })),
    });
  });
}
