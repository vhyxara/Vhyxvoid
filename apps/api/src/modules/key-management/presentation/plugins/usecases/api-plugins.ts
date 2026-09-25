import { FastifyInstance } from "fastify";
// import prismaPlugin from '@/modules/key-management/presentation/plugins/infrastructure/prisma.plugin';
import apiKeyPlugin from "@/modules/key-management/presentation/plugins/apiKeyPlugin";

export const ApiKeyPlugins = async (server: FastifyInstance) => {
  // redisPlugin is registered at the root (register.plugin.ts), not here:
  // inside this encapsulated context fastify.redis was invisible to every
  // plugin registered beside it (billing's cache invalidator got undefined).
  // await server.register(prismaPlugin);
  await server.register(apiKeyPlugin); // ✅ THEN your feature
};
