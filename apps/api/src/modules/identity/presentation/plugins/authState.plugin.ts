import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { getRedis } from "@/core/redis/RedisClient";
import {
  AuthStateCache,
  prismaAuthStateLoaders,
} from "@/modules/identity/infrastructure/auth/AuthStateCache.service";

/**
 * Builds the one AuthStateCache both guards consult and every revoking code
 * path invalidates (api/decision.md, 2026-09-24, "H2"). Registered after the
 * container/prisma plugins and before the guards. Redis is the api's
 * singleton client (initialised by redisPlugin), read lazily at request time:
 * not fastify.redis, which redisPlugin decorates inside ApiKeyPlugins' own
 * encapsulated context, so the root instance never sees it (with it, every
 * request silently fell through to Postgres).
 */
export default fp(async (fastify: FastifyInstance) => {
  const cache = new AuthStateCache(
    () => getRedis(),
    prismaAuthStateLoaders(fastify.prisma as any),
  );
  fastify.decorate("authStateCache", cache);
  fastify.container.register(AuthStateCache, () => cache);
});
