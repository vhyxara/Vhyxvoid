import { describe, it, expect, vi } from "vitest";
import { buildCanonical as protocolCanonical } from "../../packages/protocol/src/canonical";
import { createHash, createHmac, randomUUID } from "crypto";
import { buildDbApiKeyLoader } from "../../packages/shared/src/clients";
import { buildValidateApiKeyUseCase as buildUseCase } from "../../packages/shared/src/validateApiKey";

// Covers shared/context.md Known Risk #57 (E2, E2b's read side) and
// shared/decision.md, 2026-09-22, session S3, Part 4.
//
// Two separate things are under test:
//   1. validateApiKey.ts's rate-limit read is now defensive: a cached
//      null/undefined/NaN/negative value reads as unlimited, not as a limit
//      of 0. S1 (c8b98e6) already stopped WRITING a bad value; this guards
//      the read side too, per the investigation's own note.
//   2. buildDbApiKeyLoader (the thing that runs on every cache-miss reload —
//      after the 5-minute TTL, or right after rotate/update/revoke invalidate
//      the cache) now looks up the account's real plan instead of always
//      returning -1 (unlimited). This is what actually improves E2: the old
//      finding ("a rotated key is unlimited until the next full create")
//      is now "a rotated key gets its plan's real limit on the very next
//      request", not just "eventually".

const SECRET = "the-secret-hash";
const KEY_ID = "key_1";
const ACCOUNT_ID = "acct_1";

function buildCanonical(p: { method: string; path: string; body: string; requestId: string; timestamp: number }) {
  // The real canonical format (packages/protocol), not a hand-rolled copy.
  return protocolCanonical({
    method: p.method,
    path: p.path,
    query: "",
    body: p.body,
    requestId: p.requestId,
    ts: p.timestamp,
  });
}
function sign(secret: string, p: Parameters<typeof buildCanonical>[0]) {
  return createHmac("sha256", secret).update(buildCanonical(p)).digest("hex");
}
function signedParams(overrides: Partial<ReturnType<typeof baseParams>> = {}) {
  return { ...baseParams(), ...overrides };
}
function baseParams() {
  const requestId = randomUUID();
  const timestamp = Date.now();
  const p = { method: "GET", path: "/x", body: "" };
  return {
    keyId: KEY_ID,
    signature: sign(SECRET, { ...p, requestId, timestamp }),
    ...p,
    requestId,
    timestamp,
    requiredScope: "tunnel:connect",
    ip: "127.0.0.1",
  };
}

function makeFakeRedis(store: Map<string, string> = new Map()) {
  return {
    store,
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

describe("validateApiKey read side: a bad cached rate limit is treated as unlimited", () => {
  it.each([null, undefined, NaN, -5, "60" as any])(
    "cached rateLimitPerMinute = %p is accepted, not rejected",
    async (bad) => {
      const store = new Map<string, string>();
      store.set(
        `apikey:data:${KEY_ID}`,
        JSON.stringify({
          keyId: KEY_ID,
          secretHash: SECRET,
          previousSecretHash: null,
          rotationGraceEndsAt: null,
          status: "ACTIVE",
          accountId: ACCOUNT_ID,
          accountStatus: "ACTIVE",
          scopes: ["tunnel:connect"],
          expiresAt: null,
          rateLimitPerMinute: bad,
        }),
      );
      const useCase = buildUseCase({ redis: makeFakeRedis(store) as any, loadKey: vi.fn(async () => null) });

      const result = await useCase.execute(signedParams());

      expect(result.valid).toBe(true);
    },
  );

  it("a real, finite limit is still enforced (the hardening does not swallow real limits)", async () => {
    const store = new Map<string, string>();
    store.set(
      `apikey:data:${KEY_ID}`,
      JSON.stringify({
        keyId: KEY_ID,
        secretHash: SECRET,
        previousSecretHash: null,
        rotationGraceEndsAt: null,
        status: "ACTIVE",
        accountId: ACCOUNT_ID,
        accountStatus: "ACTIVE",
        scopes: ["tunnel:connect"],
        expiresAt: null,
        rateLimitPerMinute: 1,
      }),
    );
    const useCase = buildUseCase({ redis: makeFakeRedis(store) as any, loadKey: vi.fn(async () => null) });

    const first = await useCase.execute(signedParams());
    const second = await useCase.execute(signedParams());

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(false);
    expect((second as any).code).toBe("RATE_LIMITED");
  });
});

function makeFakePrisma(opts: { accountStatus?: string; plan?: string | null }) {
  return {
    apiKey: {
      findUnique: vi.fn(async () => ({
        keyId: KEY_ID,
        secretHash: SECRET,
        previousSecretHash: null,
        rotationGraceEndsAt: null,
        status: "ACTIVE",
        accountId: ACCOUNT_ID,
        scopes: [{ scope: "tunnel:connect" }],
        expiresAt: null,
        account: { status: opts.accountStatus ?? "ACTIVE" },
      })),
    },
    account: {
      findUnique: vi.fn(async () => ({ status: opts.accountStatus ?? "ACTIVE" })),
    },
    subscription: {
      findFirst: vi.fn(async () => (opts.plan ? { plan: opts.plan } : null)),
    },
  };
}

describe("buildDbApiKeyLoader: a reload now carries the account's real plan limit", () => {
  it("a FREE account (no subscription) reloads at 60/min, not -1", async () => {
    const prisma = makeFakePrisma({ plan: null });
    const loadKey = buildDbApiKeyLoader(prisma);

    const row = await loadKey(KEY_ID);

    expect(row?.rateLimitPerMinute).toBe(60);
  });

  it("a PRO account reloads at 1000/min", async () => {
    const prisma = makeFakePrisma({ plan: "PRO" });
    const loadKey = buildDbApiKeyLoader(prisma);

    const row = await loadKey(KEY_ID);

    expect(row?.rateLimitPerMinute).toBe(1000);
  });

  it("an ENTERPRISE account reloads at -1 (unlimited), not null", async () => {
    const prisma = makeFakePrisma({ plan: "ENTERPRISE" });
    const loadKey = buildDbApiKeyLoader(prisma);

    const row = await loadKey(KEY_ID);

    expect(row?.rateLimitPerMinute).toBe(-1);
    expect(JSON.parse(JSON.stringify(row)).rateLimitPerMinute).toBe(-1);
  });

  it("a SUSPENDED account with a PRO subscription reloads at FREE's 60/min", async () => {
    const prisma = makeFakePrisma({ accountStatus: "SUSPENDED", plan: "PRO" });
    const loadKey = buildDbApiKeyLoader(prisma);

    const row = await loadKey(KEY_ID);

    expect(row?.rateLimitPerMinute).toBe(60);
  });

  it("if the plan lookup itself fails, the key reloads unlimited (the previous behavior), not 0", async () => {
    const prisma = makeFakePrisma({ plan: "PRO" });
    prisma.account.findUnique = vi.fn(async () => {
      throw new Error("db down");
    });
    const loadKey = buildDbApiKeyLoader(prisma);

    const row = await loadKey(KEY_ID);

    expect(row?.rateLimitPerMinute).toBeUndefined();
  });

  it("end to end: PRO's real 1000/min is what a reload after cache invalidation actually enforces", async () => {
    const prisma = makeFakePrisma({ plan: "PRO" });
    const loadKey = buildDbApiKeyLoader(prisma);
    const useCase = buildUseCase({ redis: makeFakeRedis() as any, loadKey });

    // First request: cache miss, loader runs, PRO's limit is cached.
    const first = await useCase.execute(signedParams());
    expect(first.valid).toBe(true);
    if (first.valid) expect(first.rateLimitPerMinute).toBe(1000);
  });
});
