// Platform module: admin-editable settings, website content (CMS), the admin
// panel's operations API and the public read API. Registered at the root so
// `fastify.platformSettings` / `fastify.platformContent` are visible to every
// module (sign-up checks, checkout policy, maintenance mode).
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SYSTEM_ABILITIES } from "@/modules/identity/domain/entities/admin/AdminAbility.entities";
import { SettingsService } from "./settings/settings.service";
import { ContentService } from "./content/content.service";
import { prismaOf } from "./shared/http";

/**
 * Paths that stay up during maintenance: the admin panel and its auth, public
 * site data, health checks, Stripe webhooks and token refresh (so sessions
 * survive the window instead of being logged out).
 */
const MAINTENANCE_EXEMPT = [/^\/api\/v1\/admin\//, /^\/api\/v1\/public\//, /^\/api\/v1\/auth\/refresh/, /^\/health/, /^\/$/, /webhook/i];

export function isMaintenanceExempt(url: string): boolean {
  const path = url.split("?")[0];
  return !path.startsWith("/api/v1/") || MAINTENANCE_EXEMPT.some((re) => re.test(path));
}

export default fp(
  async function platformPlugin(fastify: FastifyInstance) {
    const prisma = prismaOf(fastify);
    const settings = new SettingsService(prisma);
    const content = new ContentService(prisma);
    fastify.decorate("platformSettings", settings);
    fastify.decorate("platformContent", content);

    // New abilities ship with the code: add any missing rows on boot, so a
    // deploy never needs a manual seed step. Existing rows are untouched.
    fastify.addHook("onReady", async () => {
      try {
        const now = new Date();
        const res = await prisma.adminAbility.createMany({
          data: Object.values(SYSTEM_ABILITIES).map((a) => ({ action: a.action, category: a.category, description: a.description, isSystem: true, isActive: true, createdAt: now, updatedAt: now })),
          skipDuplicates: true,
        });
        if (res.count) console.info(`[platform] added ${res.count} new admin abilities`);
      } catch (err) {
        console.error("[platform] ability sync failed", (err as Error).message);
      }
    });

    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      if (isMaintenanceExempt(request.url)) return;
      const enabled = await settings.get("maintenance.enabled").catch(() => false);
      if (!enabled) return;
      const message = await settings.get("maintenance.message");
      return reply
        .code(503)
        .header("Retry-After", "300")
        .send({ success: false, code: "MAINTENANCE", message, data: null, requestId: request.id });
    });
  },
  { name: "platform" },
);
