import { describe, it, expect, vi } from "vitest";

// The api's Redis client, as redisPlugin leaves it: a process-wide singleton.
const fakeRedis = {
  store: new Map<string, string>(),
  get: vi.fn(async (k: string) => (fakeRedis.store.has(k) ? JSON.parse(fakeRedis.store.get(k)!) : null)),
  set: vi.fn(async (k: string, v: string) => void fakeRedis.store.set(k, v)),
  del: vi.fn(async (k: string) => fakeRedis.store.delete(k)),
};
vi.mock("../../apps/api/src/core/redis/RedisClient", () => ({ getRedis: () => fakeRedis, initRedis: () => fakeRedis }));

import authStatePlugin from "../../apps/api/src/modules/identity/presentation/plugins/authState.plugin";

// Covers api/decision.md, 2026-09-24, "H2": the auth-state cache first read
// Redis from fastify.redis, but redisPlugin decorates that inside
// ApiKeyPlugins' encapsulated context, so the root instance (where the guards
// live) never had it and every request silently queried Postgres. Found by
// the live run (no auth:* key ever reached Redis), not by the unit tests,
// which inject Redis directly. The plugin must use the api's Redis singleton.

describe("authState plugin wiring", () => {
  it("caches through the api's Redis client even though the root instance has no `redis` decoration", async () => {
    const findUnique = vi.fn(async () => ({ tokenVersion: 3, status: true, deletedAt: null }));
    const registered = new Map<unknown, () => unknown>();
    const fastify: any = {
      prisma: { user: { findUnique }, adminUser: { findUnique: vi.fn() } },
      container: { register: (token: unknown, factory: () => unknown) => registered.set(token, factory) },
      hasDecorator: () => false, // exactly the production root instance
      decorate(name: string, v: unknown) {
        fastify[name] = v;
      },
    };

    await (authStatePlugin as any)(fastify, {});
    const first = await fastify.authStateCache.getUser("u1");
    const second = await fastify.authStateCache.getUser("u1");

    expect(first).toEqual({ tokenVersion: 3, active: true });
    expect(second).toEqual(first);
    expect(findUnique).toHaveBeenCalledTimes(1); // the second request was served from Redis
    expect(fakeRedis.set).toHaveBeenCalledWith("auth:user:u1", expect.any(String), { ex: 30 });
    expect(registered.size).toBe(1); // resolvable by the use cases that invalidate it
  });
});
