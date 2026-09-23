import { describe, it, expect, vi } from "vitest";
import { RedisApiKeyCacheService } from "../../apps/api/src/modules/key-management/domain/services/RedisApiKeyCache.service";

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
    pipeline: vi.fn(() => ({ get: () => {}, exec: async () => execResult })),
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
