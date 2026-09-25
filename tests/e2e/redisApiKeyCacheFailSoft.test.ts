import { describe, it, expect, vi } from "vitest";
import { RedisApiKeyCacheService } from "../../apps/api/src/modules/key-management/domain/services/RedisApiKeyCache.service";

// Covers context.md risk #32 (RedisApiKeyCacheService.get() unguarded Redis
// calls) and decision.md, 2026-09-12,
// "RedisApiKeyCacheService.get()/markRequestId() fail-soft/fail-open".
// markRequestId() itself was deleted 2026-09-25 as dead code (replay
// protection lives in packages/shared's validateApiKey).
function makeFailingRedis(): any {
  return {
    get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED (simulated Redis outage)")),
    set: vi.fn().mockRejectedValue(new Error("ECONNREFUSED (simulated Redis outage)")),
  };
}

describe("RedisApiKeyCacheService — fails soft/open on Redis outage", () => {
  it("get() returns null instead of throwing when Redis is unreachable", async () => {
    const service = new RedisApiKeyCacheService(makeFailingRedis());

    await expect(service.get("key_123")).resolves.toBeNull();
  });

  it("get() still returns parsed data on a healthy Redis", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          keyId: "key_123",
          secretHash: "abc",
          previousSecretHash: null,
          rotationGraceEndsAt: null,
          status: "ACTIVE",
          accountId: "acct_1",
          accountStatus: "ACTIVE",
          scopes: ["*"],
          rateLimitPerMinute: 1000,
          expiresAt: null,
        }),
      ),
    };
    const service = new RedisApiKeyCacheService(redis as any);

    const result = await service.get("key_123");
    expect(result?.accountId).toBe("acct_1");
  });
});
