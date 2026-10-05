import type { FastifyInstance } from "fastify";

/**
 * Drop API keys' `apikey:data:*` cache entries so a status/limit change
 * reaches the hub within seconds. Fails soft: the entry expires in 5 min anyway.
 */
export async function invalidateKeyCache(fastify: FastifyInstance, keys: Array<{ keyId: string }>): Promise<void> {
  if (keys.length === 0) return;
  const redis = (fastify as unknown as { redis?: { del(...keys: string[]): Promise<unknown> } }).redis;
  if (!redis) return;
  try {
    for (let i = 0; i < keys.length; i += 100) {
      await redis.del(...keys.slice(i, i + 100).map((k) => `apikey:data:${k.keyId}`));
    }
  } catch (err) {
    console.error("[admin] failed to invalidate API key cache", (err as Error).message);
  }
}
