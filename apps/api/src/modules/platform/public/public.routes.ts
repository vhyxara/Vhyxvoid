// /api/v1/public — unauthenticated, cacheable reads for the website and apps.
import type { FastifyInstance } from "fastify";
import { Plan } from "@vhyxvoid/shared";
import { effectivePlanLimits } from "@vhyxvoid/shared";
import { NotFoundError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { slugSchema } from "../content/content.schemas";

const serializeLimits = (o: object) => JSON.parse(JSON.stringify(o, (_k, v) => (v === Infinity ? null : v)));

export async function publicRoutes(fastify: FastifyInstance) {
  const cache = (reply: { header(k: string, v: string): unknown }, seconds = 30) =>
    reply.header("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`);

  /** Everything the site shell needs in one request: public settings + footer links. */
  fastify.get("/bootstrap", async (_request, reply) => {
    cache(reply);
    const [settings, footer] = await Promise.all([fastify.platformSettings.publicValues(), fastify.platformContent.footerLinks()]);
    return successResponse(reply, "Success", 200, { settings, footer });
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

  /** Plan limits as they apply right now (admin overrides included), for pricing pages. */
  fastify.get("/plans", async (_request, reply) => {
    cache(reply, 60);
    const overrides = await fastify.platformSettings.get("plans.overrides");
    const get = fastify.platformSettings.get.bind(fastify.platformSettings);
    const [mode, defaultPlan, freeModeMessage, checkoutEnabled, trialDays] = await Promise.all([
      get("billing.mode"),
      get("billing.defaultPlan"),
      get("billing.freeModeMessage"),
      get("billing.checkoutEnabled"),
      get("billing.trialDays"),
    ]);
    return successResponse(reply, "Success", 200, {
      mode,
      defaultPlan,
      freeModeMessage,
      // Buying is possible only in paid mode with upgrades switched on.
      checkoutEnabled: mode === "paid" && checkoutEnabled,
      trialDays,
      plans: [Plan.FREE, Plan.PRO, Plan.ENTERPRISE].map((plan) => ({ plan, limits: serializeLimits(effectivePlanLimits(plan, overrides)) })),
    });
  });
}
