import { FastifyInstance } from "fastify";
// import prismaPlugin from '@/modules/key-management/presentation/plugins/infrastructure/prisma.plugin';
import redisPlugin from "@/modules/key-management/presentation/plugins/infrastructure/redisPlugins";
import apiKeyPlugin from "@/modules/key-management/presentation/plugins/apiKeyPlugin";

export const ApiKeyPlugins = async (server: FastifyInstance) => {
  await server.register(redisPlugin); // ✅ FIRST
  // await server.register(prismaPlugin);
  await server.register(apiKeyPlugin); // ✅ THEN your feature
};
