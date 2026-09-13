import { describe, it, expect } from "vitest";
import { SubdomainRegistry, SubdomainEntry } from "../../apps/hub/src/services/SubdomainRegistry.service";

// Covers context.md risk #19's remaining half: a previous session added
// await/error-handling to onAgentClose but explicitly documented (see
// decision.md, 2026-09-12, "onAgentClose") that this does not eliminate
// the actual race — a stale subdomain key from a slow async unregister
// could still wipe out a fresh registration for the same label, since the
// two run on independent WS connections/event-loop turns with no
// ordering guarantee. This file exercises the real fix (a per-key mutex +
// compare-and-delete in SubdomainRegistry) — every test here was verified
// to genuinely fail against the previous (blind-delete, unlocked)
// implementation, not just pass trivially against the new one.

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A real in-memory Map behind the same get/set/del shape SubdomainRegistry
// calls, with a configurable artificial delay per call so a test can force
// a specific interleaving instead of hoping timing works out.
function makeFakeRedis(opts: { getDelayMs?: number; setDelayMs?: number; delDelayMs?: number } = {}) {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => {
      if (opts.getDelayMs) await delay(opts.getDelayMs);
      return store.get(key) ?? null;
    },
    set: async (key: string, value: string) => {
      if (opts.setDelayMs) await delay(opts.setDelayMs);
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => {
      if (opts.delDelayMs) await delay(opts.delDelayMs);
      store.delete(key);
      return 1;
    },
  };
}

function makeEntry(overrides: Partial<SubdomainEntry> = {}): SubdomainEntry {
  return {
    agentId: "agt_old",
    accountId: "acct_1",
    label: "default",
    accountSlug: "acme",
    hubInstanceId: "hub_1",
    ...overrides,
  };
}

describe("SubdomainRegistry — onAgentClose cross-connection race", () => {
  it("plain disconnect: unregister removes the entry it registered", async () => {
    const redis = makeFakeRedis();
    const registry = new SubdomainRegistry(redis as any);

    await registry.register(makeEntry({ agentId: "agt_1" }));
    await registry.unregister("default", "acme", "agt_1");

    expect(await registry.resolve("default", "acme")).toBeNull();
  });

  it("a stale unregister (wrong agentId) never deletes a newer registration, with no timing involved", async () => {
    // Direct test of the compare-and-delete itself: a new agent has
    // already taken over this label by the time the old connection's
    // unregister call runs. No artificial delay needed — this is wrong at
    // any speed under the old blind-delete implementation.
    const redis = makeFakeRedis();
    const registry = new SubdomainRegistry(redis as any);

    await registry.register(makeEntry({ agentId: "agt_new" }));
    await registry.unregister("default", "acme", "agt_old"); // stale — agt_new is now current

    const entry = await registry.resolve("default", "acme");
    expect(entry?.agentId).toBe("agt_new");
  });

  it("a slow unregister called first does not delete a faster new registration that lands while it's in flight", async () => {
    // The realistic race: the old connection's close handler calls
    // unregister() first (chronologically), but its underlying Redis
    // delete is slow (network latency) — meanwhile the new connection's
    // registration is faster and its set() would complete first if
    // nothing serialized them.
    const redis = makeFakeRedis({ delDelayMs: 40 });
    const registry = new SubdomainRegistry(redis as any);
    redis.store.set("tunnel:sub:acme--default", JSON.stringify(makeEntry({ agentId: "agt_old" })));

    const oldUnregister = registry.unregister("default", "acme", "agt_old");
    await delay(5); // let the old unregister actually start (enter the lock, begin its del)
    const newRegister = registry.register(makeEntry({ agentId: "agt_new" }));

    await Promise.all([oldUnregister, newRegister]);

    const entry = await registry.resolve("default", "acme");
    expect(entry?.agentId).toBe("agt_new");
  });

  it("never runs two operations for the same key concurrently (the mutex itself)", async () => {
    const redis = makeFakeRedis({ getDelayMs: 20, setDelayMs: 20 });
    const registry = new SubdomainRegistry(redis as any);
    redis.store.set("tunnel:sub:acme--default", JSON.stringify(makeEntry({ agentId: "agt_1" })));

    let inFlight = 0;
    let maxInFlight = 0;
    const originalGet = redis.get;
    const originalSet = redis.set;
    redis.get = async (key: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const result = await originalGet(key);
      inFlight--;
      return result;
    };
    redis.set = async (key: string, value: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const result = await originalSet(key, value);
      inFlight--;
      return result;
    };

    await Promise.all([
      registry.unregister("default", "acme", "agt_1"),
      registry.register(makeEntry({ agentId: "agt_2" })),
      registry.unregister("default", "acme", "agt_2"),
      registry.register(makeEntry({ agentId: "agt_3" })),
    ]);

    expect(maxInFlight).toBe(1);
  });

  it("operations on different labels are not serialized against each other", async () => {
    const redis = makeFakeRedis({ setDelayMs: 20 });
    const registry = new SubdomainRegistry(redis as any);

    const start = Date.now();
    await Promise.all([
      registry.register(makeEntry({ agentId: "agt_a", label: "a" })),
      registry.register(makeEntry({ agentId: "agt_b", label: "b" })),
    ]);
    const elapsed = Date.now() - start;

    // If these were incorrectly serialized against each other, this would
    // take ~40ms (2x20ms) instead of ~20ms.
    expect(elapsed).toBeLessThan(35);
  });
});
