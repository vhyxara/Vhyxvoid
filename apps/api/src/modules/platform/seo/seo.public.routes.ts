// /api/v1/public/seo — what the website needs for SEO beyond the public
// settings, and where it reports back.
//
//   GET  /                 { pages: overrides by path, redirects }   (cached 60 s)
//   POST /not-found        { path, referrer? }  a visitor hit a missing address
//   POST /redirect-hit     { from }             a redirect was used
//
// The two POSTs come from the website's server, not browsers: they need the
// header x-revalidate-secret = WEB_REVALIDATE_SECRET (the secret the API
// already shares with the website). Without it they answer 404.
import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { normalizeSitePath } from "@vhyxvoid/content";
import { NotFoundError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { prismaOf } from "../shared/http";

/** How many missing addresses are kept; the least recent go first. */
export const NOT_FOUND_KEEP = 5000;

function fromWebsite(request: FastifyRequest): boolean {
  const secret = process.env.WEB_REVALIDATE_SECRET;
  const given = request.headers["x-revalidate-secret"];
  if (!secret || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function publicSeoRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  let writes = 0;

  fastify.get("/", async (_request, reply) => {
    const [pages, redirects] = await Promise.all([
      prisma.seoPage.findMany({ select: { path: true, title: true, description: true, imageUrl: true, noindex: true } }),
      prisma.seoRedirect.findMany({ select: { fromPath: true, toUrl: true, permanent: true } }),
    ]);
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return successResponse(reply, "Success", 200, { pages, redirects: redirects.map((r) => ({ from: r.fromPath, to: r.toUrl, permanent: r.permanent })) });
  });

  fastify.post("/not-found", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!fromWebsite(request)) throw new NotFoundError("Not found");
    const b = z.object({ path: z.string().max(300), referrer: z.string().max(500).optional() }).parse(request.body ?? {});
    const path = normalizeSitePath(b.path);
    if (!path || path.includes("*")) return successResponse(reply, "Ignored", 200, null);
    const referrer = b.referrer && /^https?:\/\//.test(b.referrer) ? b.referrer.slice(0, 500) : null;
    const now = new Date();
    await prisma.seoNotFound.upsert({
      where: { path },
      create: { path, referrer, firstAt: now, lastAt: now },
      update: { hits: { increment: 1 }, lastAt: now, ...(referrer ? { referrer } : {}) },
    });
    // Bots try thousands of addresses; keep the list bounded (checked every 100 reports).
    if (++writes % 100 === 0) {
      const cutoff = await prisma.seoNotFound.findMany({ orderBy: { lastAt: "desc" }, skip: NOT_FOUND_KEEP, take: 1, select: { lastAt: true } });
      if (cutoff[0]) await prisma.seoNotFound.deleteMany({ where: { lastAt: { lte: cutoff[0].lastAt } } });
    }
    return successResponse(reply, "Noted", 200, null);
  });

  fastify.post("/redirect-hit", { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!fromWebsite(request)) throw new NotFoundError("Not found");
    const { from } = z.object({ from: z.string().max(300) }).parse(request.body ?? {});
    await prisma.seoRedirect.updateMany({ where: { fromPath: from }, data: { hits: { increment: 1 }, lastHitAt: new Date() } });
    return successResponse(reply, "Noted", 200, null);
  });
}
