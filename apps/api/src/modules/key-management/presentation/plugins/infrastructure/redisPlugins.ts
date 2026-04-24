// import { initRedis } from '@/core/redis/RedisClient';

// export default async function redisPlugin(fastify: any) {
//   const redis = initRedis();
//   fastify.decorate('redis', redis);
// }

// redisPlugin.ts
import fp from 'fastify-plugin';
import { initRedis } from '@/core/redis/RedisClient';

export default fp(async function redisPlugin(fastify: any) {
  const redis = initRedis(); // initializes singleton
  fastify.decorate('redis', redis);
});
