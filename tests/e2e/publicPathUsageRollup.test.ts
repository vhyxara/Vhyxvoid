import { describe, it, expect, vi } from "vitest";
import { RedisApiKeyCacheService } from "../../apps/api/src/modules/key-management/domain/services/RedisApiKeyCache.service";
import { PUBLIC_USAGE_SENTINEL } from "../../packages/shared/src/publicUsage";

// Covers shared/decision.md, 2026-09-22, "S5 investigation and proposal",
// Part 2.1: RedisApiKeyCacheService.drainUsageCounters() must map
// PUBLIC_USAGE_SENTINEL (what the hub writes as apiKeyId for the keyless
// public tunnel path) back to a real null before it reaches
// UsageAggregateRepository.upsertQuantity — UsageAggregate's own documented
// "account-level rollup" shape, and the only value that shape's foreign key
// on ApiKey.id can actually accept.

// Shaped like the real @upstash/redis client, recorded against the real
// instance on 2026-09-24 (api/decision.md, same date): scan() returns
// [cursor-as-string, keys], and pipeline().exec() returns one plain,
// deserialized value per command — an INCRBY counter comes back as a
// number. This mock used to return ioredis's [err, value] tuples, which is
// exactly how the drain's results[i][1] bug passed these tests.
function upstashDeserialize(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function makeFakeRedis(store: Map<string, string> = new Map()) {
  return {
    store,
    scan: vi.fn(async (_cursor: number, opts: { match: string }) => {
      const prefix = opts.match.replace(/\*$/, "");
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return ["0", keys];
    }),
    pipeline: vi.fn(() => {
      const queued: string[] = [];
      return {
        get: (k: string) => {
          queued.push(k);
        },
        exec: async () =>
          queued.map((k) => (store.has(k) ? upstashDeserialize(store.get(k)!) : null)),
      };
    }),
    del: vi.fn(async (...keys: string[]) => {
      for (const k of keys) store.delete(k);
      return keys.length;
    }),
  };
}

const ACCOUNT_ID = "acct_1";

describe("drainUsageCounters — the public path's sentinel apiKeyId maps to null", () => {
  it("a public-path bucket (PUBLIC_USAGE_SENTINEL) drains with apiKeyId: null", async () => {
    const store = new Map<string, string>();
    store.set(`usage:${ACCOUNT_ID}:${PUBLIC_USAGE_SENTINEL}:requests:202609221000`, "42");
    const service = new RedisApiKeyCacheService(makeFakeRedis(store) as any);

    const counters = await service.drainUsageCounters(ACCOUNT_ID);

    expect(counters).toHaveLength(1);
    expect(counters[0]).toMatchObject({
      apiKeyId: null,
      metric: "requests",
      quantity: 42n,
    });
  });

  it("a real keyed bucket still drains with its real apiKeyId, unaffected by the sentinel mapping", async () => {
    const store = new Map<string, string>();
    store.set(`usage:${ACCOUNT_ID}:key_abc:requests:202609221000`, "7");
    const service = new RedisApiKeyCacheService(makeFakeRedis(store) as any);

    const counters = await service.drainUsageCounters(ACCOUNT_ID);

    expect(counters).toHaveLength(1);
    expect(counters[0]).toMatchObject({ apiKeyId: "key_abc", quantity: 7n });
  });

  it("a mix of public-path and keyed buckets in the same account drain correctly, side by side", async () => {
    const store = new Map<string, string>();
    store.set(`usage:${ACCOUNT_ID}:${PUBLIC_USAGE_SENTINEL}:requests:202609221000`, "10");
    store.set(`usage:${ACCOUNT_ID}:key_abc:requests:202609221000`, "5");
    const service = new RedisApiKeyCacheService(makeFakeRedis(store) as any);

    const counters = await service.drainUsageCounters(ACCOUNT_ID);

    expect(counters).toHaveLength(2);
    const byApiKeyId = new Map(counters.map((c) => [c.apiKeyId, c.quantity]));
    expect(byApiKeyId.get(null)).toBe(10n);
    expect(byApiKeyId.get("key_abc")).toBe(5n);
  });

  it("drained keys are deleted regardless of whether they mapped to null or a real key", async () => {
    const store = new Map<string, string>();
    store.set(`usage:${ACCOUNT_ID}:${PUBLIC_USAGE_SENTINEL}:requests:202609221000`, "10");
    const redis = makeFakeRedis(store);
    const service = new RedisApiKeyCacheService(redis as any);

    await service.drainUsageCounters(ACCOUNT_ID);

    expect(store.size).toBe(0);
  });
});
