import { describe, it, expect, vi } from "vitest";
import { buildCanonical as protocolCanonical } from "../../packages/protocol/src/canonical";
import { createHash, createHmac, randomUUID } from "crypto";
import { buildCachePayload } from "../../apps/api/src/modules/key-management/application/helpers/keymanagement.utils";
import { buildValidateApiKeyUseCase } from "../../packages/shared/src/validateApiKey";

// Covers shared/context.md Known Risk #57 (E2b) and shared/decision.md,
// 2026-09-22, session S1. CreateApiKey caches the account's plan rate limit
// via buildCachePayload; ENTERPRISE's is `Infinity`, which JSON.stringify turns
// into `null`. The gateway then read `null` as a limit of 0 and rejected every
// request `RATE_LIMITED "Rate limit exceeded: null req/min"` until the cache
// entry expired (up to 5 minutes). -1 is the documented "unlimited".

const SECRET_HASH = "the-secret-hash";

function fakeKey(): any {
  return {
    keyId: "key_ent",
    secretHash: SECRET_HASH,
    previousSecretHash: null,
    rotationGraceEndsAt: null,
    status: "ACTIVE",
    accountId: "acct_ent",
    scopes: ["tunnel:connect"],
    expiresAt: null,
  };
}

function signedParams() {
  const requestId = randomUUID();
  const timestamp = Date.now();
  const canonical = protocolCanonical({ method: "GET", path: "/x", query: "", body: "", requestId, ts: timestamp });
  return {
    keyId: "key_ent",
    signature: createHmac("sha256", SECRET_HASH).update(canonical).digest("hex"),
    method: "GET",
    path: "/x",
    body: "",
    requestId,
    timestamp,
    requiredScope: "tunnel:connect",
    ip: "127.0.0.1",
  };
}

function makeFakeRedis(store: Map<string, string>) {
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, o?: { nx?: boolean }) => {
      if (o?.nx && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    }),
    incr: vi.fn(async (k: string) => {
      const n = parseInt(store.get(k) ?? "0", 10) + 1;
      store.set(k, String(n));
      return n;
    }),
    expire: vi.fn(async () => 1),
  };
}

describe("buildCachePayload rate limit", () => {
  it("maps Infinity (ENTERPRISE) to -1, not a value that JSON turns into null", () => {
    const payload = buildCachePayload(fakeKey(), Infinity, "ACTIVE");

    expect(payload.rateLimitPerMinute).toBe(-1);
    expect(JSON.parse(JSON.stringify(payload)).rateLimitPerMinute).toBe(-1);
  });

  it.each([60, 1000])("keeps a finite plan limit (%i) unchanged", (limit) => {
    expect(buildCachePayload(fakeKey(), limit, "ACTIVE").rateLimitPerMinute).toBe(limit);
  });

  it("maps NaN and -Infinity the same way (never null/NaN in Redis)", () => {
    expect(buildCachePayload(fakeKey(), NaN, "ACTIVE").rateLimitPerMinute).toBe(-1);
    expect(buildCachePayload(fakeKey(), -Infinity, "ACTIVE").rateLimitPerMinute).toBe(-1);
  });
});

describe("an ENTERPRISE key's freshly cached entry through the gateway", () => {
  it("is accepted, not rate-limited, on every request", async () => {
    // Exactly what CreateApiKey does: build the payload and store it as JSON.
    const store = new Map<string, string>();
    store.set(
      "apikey:data:key_ent",
      JSON.stringify(buildCachePayload(fakeKey(), Infinity, "ACTIVE")),
    );
    const useCase = buildValidateApiKeyUseCase({
      redis: makeFakeRedis(store) as any,
      loadKey: vi.fn(async () => null),
    });

    for (let i = 0; i < 5; i++) {
      const result = await useCase.execute(signedParams());
      expect(result.valid, `request ${i + 1}`).toBe(true);
    }
  });

  it("a finite (FREE) limit is still enforced from the same path", async () => {
    const store = new Map<string, string>();
    store.set(
      "apikey:data:key_ent",
      JSON.stringify(buildCachePayload(fakeKey(), 2, "ACTIVE")),
    );
    const useCase = buildValidateApiKeyUseCase({
      redis: makeFakeRedis(store) as any,
      loadKey: vi.fn(async () => null),
    });

    const results = [];
    for (let i = 0; i < 3; i++) results.push(await useCase.execute(signedParams()));

    expect(results.map((r) => r.valid)).toEqual([true, true, false]);
    expect((results[2] as any).code).toBe("RATE_LIMITED");
  });
});
