import { describe, it, expect, vi } from "vitest";
import { buildCanonical as protocolCanonical } from "../../packages/protocol/src/canonical";
import { buildValidateApiKeyUseCase } from "../../packages/shared/src/validateApiKey";
import type { ApiKeyRow } from "../../packages/shared/src/types";
import { createHash, createHmac, randomUUID } from "crypto";

// Covers context.md risk #37 (two independent ValidateApiKeyUseCase
// implementations with no shared source of truth) and decision.md,
// 2026-09-13, "Unify ValidateApiKeyUseCase" — apps/api's implementation was
// deleted in favor of this one, so this is now the single test suite that
// guards the actual security-critical logic (timestamp window, replay
// protection, key status, scope, HMAC signature incl. rotation grace, rate
// limiting) shared by the Hub's live gateway path and apps/api's gateway
// routes.

const SECRET = "the-real-secret-hash-value";
const OLD_SECRET = "the-previous-secret-hash-value";
const ACCOUNT_ID = "acct_1";
const KEY_ID = "key_1";

function buildCanonical(params: {
  method: string;
  path: string;
  body: string;
  requestId: string;
  timestamp: number;
}): string {
  // The real canonical format (packages/protocol), not a hand-rolled copy.
  return protocolCanonical({
    method: params.method,
    path: params.path,
    query: "",
    body: params.body,
    requestId: params.requestId,
    ts: params.timestamp,
  });
}

function sign(secret: string, canonicalParams: Parameters<typeof buildCanonical>[0]): string {
  return createHmac("sha256", secret).update(buildCanonical(canonicalParams)).digest("hex");
}

function makeRow(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    keyId: KEY_ID,
    secretHash: SECRET,
    previousSecretHash: null,
    rotationGraceEndsAt: null,
    status: "ACTIVE",
    accountId: ACCOUNT_ID,
    accountStatus: "ACTIVE",
    scopes: ["tunnels:write"],
    expiresAt: null,
    ...overrides,
  };
}

function makeFakeRedis(store: Map<string, string> = new Map()) {
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const next = (parseInt(store.get(key) ?? "0", 10) + 1).toString();
      store.set(key, next);
      return parseInt(next, 10);
    }),
    expire: vi.fn(async () => 1),
  };
}

function baseParams(overrides: Partial<Parameters<ReturnType<typeof buildValidateApiKeyUseCase>["execute"]>[0]> = {}) {
  const method = "POST";
  const path = "/tunnel/request";
  const body = "";
  const requestId = overrides.requestId ?? randomUUID();
  const timestamp = overrides.timestamp ?? Date.now();
  const signature =
    overrides.signature ?? sign(SECRET, { method, path, body, requestId, timestamp });

  return {
    keyId: KEY_ID,
    signature,
    method,
    path,
    body,
    requestId,
    timestamp,
    requiredScope: "tunnels:write",
    ip: "127.0.0.1",
    ...overrides,
  };
}

describe("buildValidateApiKeyUseCase — canonical ValidateApiKeyUseCase", () => {
  it("accepts a validly-signed request for a healthy key", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow());
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams());

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.accountId).toBe(ACCOUNT_ID);
      expect(result.scopes).toEqual(["tunnels:write"]);
    }
  });

  it("rejects a request with a stale timestamp", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow());
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const timestamp = Date.now() - 120_000; // 2 minutes old, window is 60s
    const result = await useCase.execute(baseParams({ timestamp }));

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("INVALID_SIGNATURE");
    // Loader should never even run — timestamp check is first.
    expect(loadKey).not.toHaveBeenCalled();
  });

  it("rejects a replayed requestId (second call with the same requestId)", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow());
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const requestId = randomUUID();
    const timestamp = Date.now();
    const signature = sign(SECRET, { method: "POST", path: "/tunnel/request", body: "", requestId, timestamp });
    const params = baseParams({ requestId, timestamp, signature });

    const first = await useCase.execute(params);
    expect(first.valid).toBe(true);

    const second = await useCase.execute(params);
    expect(second.valid).toBe(false);
    if (!second.valid) expect(second.code).toBe("REPLAY_ATTACK");
  });

  it("rejects an unknown API key", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => null);
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("INVALID_SIGNATURE");
      expect(result.accountId).toBeUndefined(); // key never loaded — nothing to attribute
    }
  });

  it("rejects a revoked key and attributes the failure to its accountId", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow({ status: "REVOKED" }));
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("REVOKED_KEY");
      expect(result.accountId).toBe(ACCOUNT_ID);
    }
  });

  it("rejects an expired key", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow({ expiresAt: new Date(Date.now() - 1000) }));
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("EXPIRED_KEY");
  });

  it("rejects a key whose account is SUSPENDED", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow({ accountStatus: "SUSPENDED" }));
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("SUSPENDED_ACCOUNT");
  });

  // Added 2026-09-22 (S4, E6, CONNECTABLE_ACCOUNT_STATUSES): PAST_DUE is
  // deliberately allowed here now — the seven-day grace period is meant to
  // keep service running, not just plan limits — while RESTRICTED/CANCELED/
  // DELETED stay refused, same as before. This is the SDK (TunnelClient)
  // request path's half of the shared status check; hubConnectableStatus
  // .test.ts covers the agent-handshake half.
  it("accepts a key whose account is PAST_DUE (the grace period keeps service running)", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow({ accountStatus: "PAST_DUE" }));
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams());

    expect(result.valid).toBe(true);
  });

  it.each(["RESTRICTED", "CANCELED", "DELETED"])(
    "still rejects a key whose account is %s",
    async (accountStatus) => {
      const redis = makeFakeRedis();
      const loadKey = vi.fn(async () => makeRow({ accountStatus }));
      const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

      const result = await useCase.execute(baseParams());

      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.code).toBe("SUSPENDED_ACCOUNT");
    },
  );

  it("rejects a request missing the required scope", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow({ scopes: ["tunnels:read"] }));
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("SCOPE_MISSING");
  });

  it("accepts a wildcard scope for any requiredScope", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow({ scopes: ["*"] }));
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams({ requiredScope: "billing:write" }));
    expect(result.valid).toBe(true);
  });

  it("rejects a bad signature", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow());
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams({ signature: "0".repeat(64) }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("INVALID_SIGNATURE");
  });

  it("accepts a signature made with the previous secret during the rotation grace window", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () =>
      makeRow({
        secretHash: SECRET,
        previousSecretHash: OLD_SECRET,
        rotationGraceEndsAt: new Date(Date.now() + 60_000),
      }),
    );
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const method = "POST";
    const path = "/tunnel/request";
    const body = "";
    const requestId = randomUUID();
    const timestamp = Date.now();
    const signature = sign(OLD_SECRET, { method, path, body, requestId, timestamp });

    const result = await useCase.execute(
      baseParams({ method, path, body, requestId, timestamp, signature }),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a signature made with the previous secret once the grace window has expired", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () =>
      makeRow({
        secretHash: SECRET,
        previousSecretHash: OLD_SECRET,
        rotationGraceEndsAt: new Date(Date.now() - 1000), // already expired
      }),
    );
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const method = "POST";
    const path = "/tunnel/request";
    const body = "";
    const requestId = randomUUID();
    const timestamp = Date.now();
    const signature = sign(OLD_SECRET, { method, path, body, requestId, timestamp });

    const result = await useCase.execute(
      baseParams({ method, path, body, requestId, timestamp, signature }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects once the per-minute rate limit is exceeded", async () => {
    const redis = makeFakeRedis();
    const loadKey = vi.fn(async () => makeRow({ scopes: ["*"] }));
    // rateLimitPerMinute isn't in ApiKeyRow — the canonical loader hardcodes
    // -1 (unlimited) pending billing wiring (see context.md risk #36), so
    // drive the limit via a pre-seeded cache entry instead of the DB row.
    redis.store.set(
      `apikey:data:${KEY_ID}`,
      JSON.stringify({
        keyId: KEY_ID,
        secretHash: SECRET,
        previousSecretHash: null,
        rotationGraceEndsAt: null,
        status: "ACTIVE",
        accountId: ACCOUNT_ID,
        accountStatus: "ACTIVE",
        scopes: ["*"],
        rateLimitPerMinute: 1,
        expiresAt: null,
      }),
    );
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const first = await useCase.execute(baseParams());
    expect(first.valid).toBe(true);

    const second = await useCase.execute(baseParams());
    expect(second.valid).toBe(false);
    if (!second.valid) expect(second.code).toBe("RATE_LIMITED");
  });

  it("fails soft on a Redis cache-read error (falls through to the DB loader)", async () => {
    const redis = {
      get: vi.fn().mockRejectedValue(new Error("simulated Redis outage")),
      set: vi.fn().mockResolvedValue("OK"),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    };
    const loadKey = vi.fn(async () => makeRow());
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams());
    expect(result.valid).toBe(true);
    expect(loadKey).toHaveBeenCalledOnce();
  });

  it("fails open on a Redis replay-check error (allows the request rather than blocking it)", async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockRejectedValue(new Error("simulated Redis outage")),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    };
    const loadKey = vi.fn(async () => makeRow());
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey });

    const result = await useCase.execute(baseParams());
    expect(result.valid).toBe(true);
  });
});

// shared backlog, 2026-09-24: each SDK connection's sdk:register handshake
// was counted as a usage request (2 requests over one connection counted 3).
describe("usage counting and the countUsage flag", () => {
  const usageKeys = (store: Map<string, string>) => [...store.keys()].filter((k) => k.startsWith("usage:"));

  it("a valid request increments the usage counter", async () => {
    const redis = makeFakeRedis();
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey: vi.fn(async () => makeRow()) });
    expect((await useCase.execute(baseParams())).valid).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(usageKeys(redis.store)).toHaveLength(1);
  });

  it("countUsage: false (the sdk:register handshake) validates without counting", async () => {
    const redis = makeFakeRedis();
    const useCase = buildValidateApiKeyUseCase({ redis: redis as any, loadKey: vi.fn(async () => makeRow()) });
    expect((await useCase.execute({ ...baseParams(), countUsage: false })).valid).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(usageKeys(redis.store)).toHaveLength(0);
  });
});

describe("HubAuthService.authenticateSdkRegister", () => {
  it("asks the validator not to count the handshake as usage", async () => {
    const { HubAuthService } = await import("../../apps/hub/src/services/HubAuth.service");
    const execute = vi.fn(async () => ({
      valid: true as const,
      apiKeyId: KEY_ID,
      accountId: ACCOUNT_ID,
      scopes: ["tunnel:connect"],
      rateLimitPerMinute: -1,
    }));
    const auth = new HubAuthService({ execute } as any, "pepper", async () => null);
    await auth
      .authenticateSdkRegister(
        { v: "1", type: "sdk:register", keyId: KEY_ID, signature: "sig", requestId: "r1", ts: Date.now() } as any,
        "127.0.0.1",
      )
      .catch(() => {});
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ method: "SDK_REGISTER", countUsage: false }));
  });
});
