import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
// import prismaPlugin from '@/modules/key-management/presentation/plugins/infrastructure/prisma.plugin';
import apiKeyPlugin from "@/modules/key-management/presentation/plugins/apiKeyPlugin";

// fastify-plugin: the API key use cases are decorated where every module can
// see them. As a plain async plugin they were scoped to this context, so
// GET /tunnel/organizations/:accountId/usage (and anything else outside it)
// found fastify.getApiKeyUsageUseCase undefined and answered 500.
export const ApiKeyPlugins = fp(async (server: FastifyInstance) => {
  // redisPlugin is registered at the root (register.plugin.ts), not here:
  // inside this encapsulated context fastify.redis was invisible to every
  // plugin registered beside it (billing's cache invalidator got undefined).
  // await server.register(prismaPlugin);
  await server.register(apiKeyPlugin); // ✅ THEN your feature
});
