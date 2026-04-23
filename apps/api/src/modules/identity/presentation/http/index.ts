import { FastifyInstance } from "fastify";
import { identityRoutes } from "@/modules/identity/presentation/http/user/identity.routes";
import { accountRoutes } from "@/modules/identity/presentation/http/user/account.routes";

import { adminRoutes } from "@/modules/identity/presentation/http/admin/admin.routes";
import { tunnelRoutes } from "@/modules/identity/presentation/http/user/tunnel.routes";
import { billingRoutes } from "@/modules/billing/presentation/http/billingRoutes";
import { stripeWebhookRoutes } from "@/modules/billing/presentation/http/webhookRoutes";
import { notificationRoutes } from "@/modules/notification/presentation/http/notificationRoutes";

const registerRoutes = async (server: FastifyInstance) => {
  await server.register(identityRoutes, { prefix: "/api/v1/auth" });

  await server.register(accountRoutes, { prefix: "/api/v1/account" });

  await server.register(adminRoutes, { prefix: "/api/v1/admin/identity" });

  await server.register(tunnelRoutes, { prefix: "/api/v1/tunnel" });

  await server.register(billingRoutes, { prefix: "/api/v1/billing" });

  await server.register(notificationRoutes, { prefix: "/api/v1/notification" });

  await server.register(stripeWebhookRoutes);
  // //     fastify.register(stripeWebhookRoutes); // no prefix — /billing/webhooks/stripe
};

export default registerRoutes;
