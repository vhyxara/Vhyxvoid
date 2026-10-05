import { describe, it, expect, vi, afterEach } from "vitest";
import { SubdomainRegistry, SubdomainEntry } from "../../apps/hub/src/services/SubdomainRegistry.service";

// hub backlog, 2026-09-25: every public tunnel request cost one Upstash GET
// (SubdomainRegistry.resolve). resolve() now answers from a short in-process
// cache that register()/unregister()/unregisterAllForHub() keep in step.

function fakeRedis(getDelayMs = 0) {
  const store = new Map<string, string>();
  const redis = {
    store,
    // Reads the value when called and returns it after the delay, like a
    // round trip whose answer was decided on the server.
    get: vi.fn(async (k: string) => {
      const value = store.get(k) ?? null;
      if (getDelayMs) await new Promise((r) => setTimeout(r, getDelayMs));
      return value;
    }),
    set: vi.fn(async (k: string, v: string) => (store.set(k, v), "OK")),
    del: vi.fn(async (k: string) => (store.delete(k), 1)),
    scan: vi.fn(async () => ["0", [...store.keys()]]),
  };
  return redis;
}

const entry = (agentId: string): SubdomainEntry => ({
  agentId,
  accountId: "acct_1",
  label: "default",
  accountSlug: "acme",
  hubInstanceId: "hub_1",
});

afterEach(() => vi.useRealTimers());

describe("SubdomainRegistry.resolve cache", () => {
  it("answers repeat lookups from memory: one Redis GET for many requests", async () => {
    const redis = fakeRedis();
    const reg = new SubdomainRegistry(redis as any);
    await reg.register(entry("agt_1"));
    redis.get.mockClear();

    for (let i = 0; i < 10; i++) expect((await reg.resolve("default", "acme"))?.agentId).toBe("agt_1");
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("an entry first read from Redis is cached after one GET", async () => {
    const redis = fakeRedis();
    redis.store.set("tunnel:sub:acme--default", JSON.stringify(entry("agt_1")));
    const reg = new SubdomainRegistry(redis as any);

    await reg.resolve("default", "acme");
    await reg.resolve("default", "acme");
    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  it("a disconnect (unregister) is visible at once, and a reconnect replaces the cached agent", async () => {
    const reg = new SubdomainRegistry(fakeRedis() as any);
    await reg.register(entry("agt_1"));
    await reg.resolve("default", "acme");

    await reg.unregister("default", "acme", "agt_1");
    expect(await reg.resolve("default", "acme")).toBeNull();

    await reg.register(entry("agt_2"));
    expect((await reg.resolve("default", "acme"))?.agentId).toBe("agt_2");
  });

  it("a superseded unregister drops its own stale cache entry and keeps the new owner", async () => {
    const redis = fakeRedis();
    const reg = new SubdomainRegistry(redis as any);
    await reg.register(entry("agt_1"));
    // Another hub (or a write this process didn't make) took the label over.
    redis.store.set("tunnel:sub:acme--default", JSON.stringify(entry("agt_2")));

    await reg.unregister("default", "acme", "agt_1");
    expect((await reg.resolve("default", "acme"))?.agentId).toBe("agt_2");
  });

  it("a read that overlaps a register does not put the older entry back in the cache", async () => {
    const redis = fakeRedis(30);
    const reg = new SubdomainRegistry(redis as any);
    redis.store.set("tunnel:sub:acme--default", JSON.stringify(entry("agt_old")));

    const slowRead = reg.resolve("default", "acme"); // reads agt_old, slowly
    await new Promise((r) => setTimeout(r, 5));
    await reg.register(entry("agt_new"));
    expect((await slowRead)?.agentId).toBe("agt_old");

    redis.get.mockClear();
    expect((await reg.resolve("default", "acme"))?.agentId).toBe("agt_new");
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("re-reads Redis once the TTL has passed, so changes made elsewhere show up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const redis = fakeRedis();
    const reg = new SubdomainRegistry(redis as any, 5_000);
    await reg.register(entry("agt_1"));
    redis.store.delete("tunnel:sub:acme--default");

    expect(await reg.resolve("default", "acme")).not.toBeNull();
    vi.setSystemTime(Date.now() + 5_001);
    expect(await reg.resolve("default", "acme")).toBeNull();
  });

  it("does not cache a miss: a label registered later resolves", async () => {
    const redis = fakeRedis();
    const reg = new SubdomainRegistry(redis as any);
    expect(await reg.resolve("default", "acme")).toBeNull();
    redis.store.set("tunnel:sub:acme--default", JSON.stringify(entry("agt_1")));
    expect((await reg.resolve("default", "acme"))?.agentId).toBe("agt_1");
  });

  it("startup cleanup (unregisterAllForHub) clears the cache", async () => {
    const reg = new SubdomainRegistry(fakeRedis() as any);
    await reg.register(entry("agt_1"));
    await reg.unregisterAllForHub("hub_1");
    expect(await reg.resolve("default", "acme")).toBeNull();
  });

  it("cacheTtlMs 0 reads Redis every time", async () => {
    const redis = fakeRedis();
    const reg = new SubdomainRegistry(redis as any, 0);
    await reg.register(entry("agt_1"));
    redis.get.mockClear();
    await reg.resolve("default", "acme");
    await reg.resolve("default", "acme");
    expect(redis.get).toHaveBeenCalledTimes(2);
  });
});
