import type { FastifyInstance } from "fastify";
import { HubClient } from "./shared/hubClient";
import { adminSystemRoutes } from "./admin/admin.system.routes";
import { adminAccountRoutes } from "./admin/admin.accounts.routes";
import { adminUserRoutes } from "./admin/admin.users.routes";
import { adminApiKeyRoutes, adminTunnelRoutes } from "./admin/admin.keys-tunnels.routes";
import { adminBillingRoutes } from "./admin/admin.billing.routes";
import { adminLogRoutes } from "./admin/admin.logs.routes";
import { adminContentRoutes, adminSettingsRoutes } from "./admin/admin.settings-content.routes";
import { publicRoutes } from "./public/public.routes";
import { inspectorRoutes } from "./inspector/inspector.routes";
import { tunnelAccessRoutes } from "./tunnel-access/tunnelAccess.routes";
import { inboxRoutes } from "./inbox/inbox.routes";
import { domainRoutes, publicDomainRoutes } from "./domains/domains.routes";
import { DomainService } from "./domains/domains.service";
import { buildDnsResolver } from "./domains/dns";
import { runDomainChecks } from "./domains/domains.worker";
import { alertRoutes } from "./alerts/alerts.routes";
import { AlertService } from "./alerts/alerts.service";
import { runAlertEvaluation } from "./alerts/alerts.worker";
import { adminDomainRoutes } from "./admin/admin.domains.routes";
import { leasedInterval, releaseLeases, runLeasedJob } from "./shared/lease";
import { prismaOf } from "./shared/http";

export async function registerPlatformRoutes(server: FastifyInstance) {
  const hub = new HubClient();
  await server.register(adminSystemRoutes, { prefix: "/api/v1/admin", hub });
  await server.register(adminAccountRoutes, { prefix: "/api/v1/admin/accounts", hub });
  await server.register(adminUserRoutes, { prefix: "/api/v1/admin/users" });
  await server.register(adminApiKeyRoutes, { prefix: "/api/v1/admin/api-keys" });
  await server.register(adminTunnelRoutes, { prefix: "/api/v1/admin/tunnels", hub });
  await server.register(adminBillingRoutes, { prefix: "/api/v1/admin/billing" });
  await server.register(adminLogRoutes, { prefix: "/api/v1/admin/logs" });
  await server.register(adminSettingsRoutes, { prefix: "/api/v1/admin/settings" });
  await server.register(adminContentRoutes, { prefix: "/api/v1/admin/content" });
  await server.register(publicRoutes, { prefix: "/api/v1/public" });
  await server.register(inspectorRoutes, { prefix: "/api/v1/inspector", hub });
  await server.register(tunnelAccessRoutes, { prefix: "/api/v1/tunnel-access", hub });
  await server.register(inboxRoutes, { prefix: "/api/v1/inbox", hub });

  // Custom domains and alerts share one AlertService (domain events notify through it).
  const prisma = prismaOf(server);
  const alerts = new AlertService(prisma, () => (server as unknown as { notificationService?: never }).notificationService);
  const domains = new DomainService(prisma, buildDnsResolver(), hub, alerts);
  server.decorate("platformAlerts", alerts);
  await server.register(domainRoutes, { prefix: "/api/v1/domains", hub, domains });
  await server.register(publicDomainRoutes, { prefix: "/api/v1/public/domains" });
  await server.register(alertRoutes, { prefix: "/api/v1/alerts", alerts });
  await server.register(adminDomainRoutes, { prefix: "/api/v1/admin/domains", hub });

  // Operators can run a job now instead of waiting for its interval.
  await server.register(async (app) => {
    app.post<{ Params: { name: string } }>("/jobs/:name/run", { onRequest: [app.requireAbility("settings.update")] }, async (request, reply) => {
      const name = request.params.name;
      const started = Date.now();
      let result: unknown;
      if (name === "alerts") result = await runLeasedJob(prisma, "alerts", 120_000, () => runAlertEvaluation(prisma, alerts), true);
      else if (name === "domains") result = await runLeasedJob(prisma, "domains", 600_000, async () => ({ checked: await runDomainChecks(prisma, domains) }), true);
      else return reply.code(404).send({ success: false, code: "NOT_FOUND", message: "Unknown job (alerts, domains)", data: null });
      // Another API instance holds the job right now.
      if (result === undefined) return reply.code(409).send({ success: false, code: "CONFLICT", message: "The job is running on another instance; try again in a minute", data: null });
      return reply.send({ success: true, message: "Done", data: { job: name, result, ms: Date.now() - started } });
    });
  }, { prefix: "/api/v1/admin/system" });

  // Background jobs, one instance at a time (job leases). Off in tests.
  if (process.env.DISABLE_BACKGROUND_JOBS !== "1") {
    const jobs: Array<{ stop: () => void }> = [];
    server.addHook("onReady", async () => {
      jobs.push(leasedInterval(prisma, "alerts", 60_000, async () => void (await runAlertEvaluation(prisma, alerts))));
      jobs.push(leasedInterval(prisma, "domains", 5 * 60_000, async () => void (await runDomainChecks(prisma, domains))));
    });
    server.addHook("onClose", async () => {
      jobs.forEach((j) => j.stop());
      await releaseLeases(prisma);
    });
  }
}
