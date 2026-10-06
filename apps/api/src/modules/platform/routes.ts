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
}
