import { describe, it, expect, vi } from "vitest";
import { RedisApiKeyCacheService } from "../../apps/api/src/modules/key-management/domain/services/RedisApiKeyCache.service";
import { FlushUsageWorker } from "../../apps/api/src/modules/key-management/application/use-cases/FlushUsageWorker.usecase";

// Covers api/decision.md, 2026-09-24, "Usage drain read ioredis tuples from
// an Upstash pipeline". drainUsageCounters() read results[i][1] (ioredis's
// [err, value] shape) from @upstash/redis's pipeline().exec(), which returns
// plain values — so every counter was skipped and then its key deleted.
//
// RECORDED_* below are the exact exec() results captured from the real
// Upstash instance for three INCRBY counters (1, 12345, 9007199254), queued in
// the order the keys below list them. Not guessed: they are the evidence.
const RECORDED_KEYS = [
  "usage:acct_1:_public:requests:202609240005",
  "usage:acct_1:key_a:requests:202609240000",
  "usage:acct_1:key_b:bandwidth_bytes:202609240010",
];
// Client defaults (automaticDeserialization on) — how apps/api constructs it.
const RECORDED_DEFAULT: unknown[] = [12345, 1, 9007199254];
// automaticDeserialization: false.
const RECORDED_RAW: unknown[] = ["12345", "1", "9007199254"];

function redisReturning(keys: string[], execResult: unknown[]) {
  const deleted: string[] = [];
  return {
    deleted,
    scan: vi.fn(async () => ["0", keys]),
    pipeline: vi.fn(() => ({
      getdel: (k: string) => {
        deleted.push(k);
      },
      exec: async () => execResult,
    })),
    del: vi.fn(async (...k: string[]) => {
      deleted.push(...k);
      return k.length;
    }),
  };
}

function quantities(counters: Array<{ apiKeyId: string | null; metric: string; quantity: bigint }>) {
  return Object.fromEntries(counters.map((c) => [`${c.apiKeyId}:${c.metric}`, c.quantity]));
}

describe("drainUsageCounters reads Upstash's real pipeline result shape", () => {
  it("extracts every counter from the recorded default-deserialization result (numbers)", async () => {
    const service = new RedisApiKeyCacheService(redisReturning(RECORDED_KEYS, RECORDED_DEFAULT) as any);

    const counters = await service.drainUsageCounters("acct_1");

    expect(quantities(counters)).toEqual({
      "null:requests": 12345n,
      "key_a:requests": 1n,
      "key_b:bandwidth_bytes": 9007199254n,
    });
  });

  it("extracts every counter from the recorded automaticDeserialization:false result (strings)", async () => {
    const service = new RedisApiKeyCacheService(redisReturning(RECORDED_KEYS, RECORDED_RAW) as any);

    const counters = await service.drainUsageCounters("acct_1");

    // The tuple-reading code got "2" for 12345 here — a wrong number, not a skip.
    expect(quantities(counters)).toEqual({
      "null:requests": 12345n,
      "key_a:requests": 1n,
      "key_b:bandwidth_bytes": 9007199254n,
    });
  });

  it("skips a key that vanished between SCAN and GET (null) but keeps the rest", async () => {
    const service = new RedisApiKeyCacheService(
      redisReturning(RECORDED_KEYS, [12345, null, 9007199254]) as any,
    );

    const counters = await service.drainUsageCounters("acct_1");

    expect(counters).toHaveLength(2);
    expect(quantities(counters)["key_a:requests"]).toBeUndefined();
  });
});

// ── Keyless-account flush gap ────────────────────────────────────────────────

function makeSharedRedis(store: Map<string, string>) {
  return {
    scan: vi.fn(async (_cursor: number, opts: { match: string }) => {
      const prefix = opts.match.replace(/\*$/, "");
      return ["0", [...store.keys()].filter((k) => k.startsWith(prefix))];
    }),
    pipeline: vi.fn(() => {
      const queued: string[] = [];
      return {
        getdel: (k: string) => {
          queued.push(k);
        },
        exec: async () =>
          queued.map((k) => {
            const v = store.has(k) ? Number(store.get(k)) : null;
            store.delete(k);
            return v;
          }),
      };
    }),
    del: vi.fn(async (...keys: string[]) => {
      for (const k of keys) store.delete(k);
      return keys.length;
    }),
  };
}

function makeUsageRepo() {
  const upserts: Array<{ accountId: string; apiKeyId: string | null; quantity: bigint }> = [];
  return {
    upserts,
    upsertQuantity: vi.fn(async (p: any) => {
      upserts.push({ accountId: p.accountId, apiKeyId: p.apiKeyId, quantity: p.quantity });
    }),
  };
}

describe("FlushUsageWorker.runForPendingAccounts — accounts come from Redis, not from ACTIVE keys", () => {
  it("lists each account with pending counters once", async () => {
    const store = new Map([
      ["usage:acct_a:_public:requests:202609240000", "3"],
      ["usage:acct_a:key_1:requests:202609240000", "2"],
      ["usage:acct_b:_public:requests:202609240005", "1"],
    ]);
    const service = new RedisApiKeyCacheService(makeSharedRedis(store) as any);

    expect((await service.listAccountIdsWithPendingUsage()).sort()).toEqual(["acct_a", "acct_b"]);
  });

  it("drains an account whose only usage is public-path counts (no ACTIVE key involved at all)", async () => {
    const store = new Map([["usage:acct_revoked:_public:requests:202609240000", "4"]]);
    const repo = makeUsageRepo();
    const worker = new FlushUsageWorker(
      new RedisApiKeyCacheService(makeSharedRedis(store) as any),
      repo as any,
      {} as any,
    );

    await worker.runForPendingAccounts(async (ids) => ids);

    expect(repo.upserts).toEqual([{ accountId: "acct_revoked", apiKeyId: null, quantity: 4n }]);
    expect(store.size).toBe(0);
  });

  it("leaves another environment's counters alone (shared Upstash): never reads, writes or deletes them", async () => {
    const otherEnvKey = "usage:acct_prod_only:_public:requests:202609240000";
    const store = new Map([
      ["usage:acct_local:_public:requests:202609240000", "2"],
      [otherEnvKey, "9"],
    ]);
    const repo = makeUsageRepo();
    const worker = new FlushUsageWorker(
      new RedisApiKeyCacheService(makeSharedRedis(store) as any),
      repo as any,
      {} as any,
    );
    const filter = vi.fn(async (ids: string[]) => ids.filter((id) => id === "acct_local"));

    await worker.runForPendingAccounts(filter);

    expect(filter).toHaveBeenCalledWith(expect.arrayContaining(["acct_local", "acct_prod_only"]));
    expect(repo.upserts.map((u) => u.accountId)).toEqual(["acct_local"]);
    expect([...store.keys()]).toEqual([otherEnvKey]);
  });

  it("does no database lookup when nothing is pending", async () => {
    const worker = new FlushUsageWorker(
      new RedisApiKeyCacheService(makeSharedRedis(new Map()) as any),
      makeUsageRepo() as any,
      {} as any,
    );
    const filter = vi.fn(async (ids: string[]) => ids);

    await worker.runForPendingAccounts(filter);

    expect(filter).not.toHaveBeenCalled();
  });
});

// ── Keyed counters: public keyId -> ApiKey.id ────────────────────────────────
//
// The SDK path (ValidateApiKeyUseCase.incrementUsage) writes the PUBLIC keyId
// into the counter key, but UsageAggregate.apiKeyId is a foreign key to
// ApiKey.id. Passing the public id straight through failed that constraint on
// every keyed counter — seen live 2026-09-24 against the local dev database:
// "Foreign key constraint violated on the constraint: UsageAggregate_apiKeyId_fkey".

function makeKeyRepo(keys: Array<{ id: string; keyId: string; accountId: string }>) {
  return {
    findByKeyId: vi.fn(async (keyId: string) => keys.find((k) => k.keyId === keyId) ?? null),
    findById: vi.fn(async (id: string) => keys.find((k) => k.id === id) ?? null),
  };
}

describe("FlushUsageWorker writes keyed counters under ApiKey.id, not the public keyId", () => {
  it("resolves the public keyId to the key's row id", async () => {
    const store = new Map([["usage:acct_a:vhyxvoid_dev_abc:requests:202609240000", "3"]]);
    const repo = makeUsageRepo();
    const worker = new FlushUsageWorker(
      new RedisApiKeyCacheService(makeSharedRedis(store) as any),
      repo as any,
      makeKeyRepo([{ id: "row-uuid-1", keyId: "vhyxvoid_dev_abc", accountId: "acct_a" }]) as any,
    );

    await worker.run(["acct_a"]);

    expect(repo.upserts).toEqual([{ accountId: "acct_a", apiKeyId: "row-uuid-1", quantity: 3n }]);
  });

  it("records an unknown key, or another account's key, in the account-level rollup instead of dropping it", async () => {
    const store = new Map([
      ["usage:acct_a:vhyxvoid_dev_gone:requests:202609240000", "2"],
      ["usage:acct_a:vhyxvoid_dev_other:requests:202609240000", "5"],
    ]);
    const repo = makeUsageRepo();
    const worker = new FlushUsageWorker(
      new RedisApiKeyCacheService(makeSharedRedis(store) as any),
      repo as any,
      makeKeyRepo([{ id: "row-b", keyId: "vhyxvoid_dev_other", accountId: "acct_b" }]) as any,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await worker.run(["acct_a"]);
    warn.mockRestore();

    expect(repo.upserts.map((u) => [u.apiKeyId, u.quantity]).sort()).toEqual([
      [null, 2n],
      [null, 5n],
    ]);
  });

  it("one failing write does not abort the remaining counters or accounts in the tick", async () => {
    const store = new Map([
      ["usage:acct_a:_public:requests:202609240000", "1"],
      ["usage:acct_a:_public:requests:202609240005", "2"],
      ["usage:acct_b:_public:requests:202609240000", "4"],
    ]);
    const repo = makeUsageRepo();
    let calls = 0;
    repo.upsertQuantity.mockImplementation(async (p: any) => {
      if (calls++ === 0) throw new Error("db blip");
      repo.upserts.push({ accountId: p.accountId, apiKeyId: p.apiKeyId, quantity: p.quantity });
    });
    const worker = new FlushUsageWorker(
      new RedisApiKeyCacheService(makeSharedRedis(store) as any),
      repo as any,
      makeKeyRepo([]) as any,
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await worker.run(["acct_a", "acct_b"]);
    err.mockRestore();

    expect(repo.upsertQuantity).toHaveBeenCalledTimes(3);
    expect(repo.upserts).toHaveLength(2);
    expect(repo.upserts.some((u) => u.accountId === "acct_b" && u.quantity === 4n)).toBe(true);
  });
});

// api backlog, 2026-09-24: "Usage drain can still lose counts". The drain did
// a pipelined GET and then a separate DEL of the same keys, so an INCRBY that
// landed between the two was deleted unread. GETDEL closes that window.
describe("drainUsageCounters — an increment landing mid-drain is not lost", () => {
  it("reads with GETDEL and issues no separate DEL", async () => {
    const key = "usage:acct_1:key_a:requests:202609240000";
    const store = new Map([[key, "5"]]);
    const redis = {
      scan: vi.fn(async () => ["0", [...store.keys()]]),
      pipeline: vi.fn(() => {
        const queued: string[] = [];
        return {
          getdel: (k: string) => {
            queued.push(k);
          },
          exec: async () => {
            const values = queued.map((k) => {
              const v = store.has(k) ? Number(store.get(k)) : null;
              store.delete(k);
              return v;
            });
            // A concurrent INCRBY right after the drain's read.
            store.set(key, "1");
            return values;
          },
        };
      }),
      del: vi.fn(async (...keys: string[]) => {
        for (const k of keys) store.delete(k);
        return keys.length;
      }),
    };
    const service = new RedisApiKeyCacheService(redis as any);

    const counters = await service.drainUsageCounters("acct_1");

    expect(counters.map((c) => c.quantity)).toEqual([5n]);
    expect(redis.del).not.toHaveBeenCalled();
    expect(store.get(key)).toBe("1");
  });
});
