import { describe, it, expect, vi } from "vitest";
import { AccountKeyCacheInvalidator } from "../../apps/api/src/modules/billing/domain/services/AccountKeyCacheInvalidator.service";

// Covers shared/context.md Known Risk #57 (E6, Part 2 — the write side of
// closing the up-to-5-minute cache lag). AccountKeyCacheInvalidator is the
// thin coordinator: given an accountId, resolve its keys, invalidate each
// one via the existing per-key ApiKeyCacheService.invalidate() (the same
// method rotate/update/revoke already use) — no new Redis key format.

function makeFakeApiKeyRepository(keyIds: string[]) {
  return {
    findAllByAccount: vi.fn(async () => keyIds.map((keyId) => ({ keyId }))),
  } as any;
}

function makeFakeCacheService() {
  return {
    invalidateAllForAccount: vi.fn(async (_keyIds: string[]) => {}),
  } as any;
}

describe("AccountKeyCacheInvalidator", () => {
  it("resolves the account's real keys and invalidates all of them", async () => {
    const apiKeyRepository = makeFakeApiKeyRepository(["key_a", "key_b", "key_c"]);
    const cacheService = makeFakeCacheService();
    const invalidator = new AccountKeyCacheInvalidator(apiKeyRepository, cacheService);

    await invalidator.invalidate("acct_1");

    expect(apiKeyRepository.findAllByAccount).toHaveBeenCalledWith("acct_1");
    expect(cacheService.invalidateAllForAccount).toHaveBeenCalledWith(["key_a", "key_b", "key_c"]);
  });

  it("does nothing (no Redis call) when the account has no keys", async () => {
    const apiKeyRepository = makeFakeApiKeyRepository([]);
    const cacheService = makeFakeCacheService();
    const invalidator = new AccountKeyCacheInvalidator(apiKeyRepository, cacheService);

    await invalidator.invalidate("acct_empty");

    expect(cacheService.invalidateAllForAccount).not.toHaveBeenCalled();
  });

  it("fails soft: a repository or Redis error is caught, never thrown, and logged", async () => {
    const apiKeyRepository = { findAllByAccount: vi.fn(async () => { throw new Error("db down"); }) } as any;
    const cacheService = makeFakeCacheService();
    const invalidator = new AccountKeyCacheInvalidator(apiKeyRepository, cacheService);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(invalidator.invalidate("acct_1")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("fails soft when the cache service itself throws", async () => {
    const apiKeyRepository = makeFakeApiKeyRepository(["key_a"]);
    const cacheService = {
      invalidateAllForAccount: vi.fn(async () => { throw new Error("redis down"); }),
    } as any;
    const invalidator = new AccountKeyCacheInvalidator(apiKeyRepository, cacheService);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(invalidator.invalidate("acct_1")).resolves.toBeUndefined();

    errorSpy.mockRestore();
  });
});
