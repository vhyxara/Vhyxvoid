import { describe, it, expect, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { HubAuthService } from "../../apps/hub/src/services/HubAuth.service";
import { buildValidateApiKeyUseCase } from "../../packages/shared/src/validateApiKey";
import { buildCanonical } from "../../packages/protocol/src/canonical";

// shared backlog (2026-09-24): TunnelClient signed with the raw secret, but
// the hub verified HMACs keyed by HMAC(pepper, rawSecret), which a client
// can't compute, so every TunnelClient got INVALID_SIGNATURE. Since
// 2026-09-25 sdk:register carries the raw secret once (like agent:register);
// the hub checks it, keeps it in memory for the connection, verifies each
// request's raw-secret signature and hands the validator the same request
// signed with the stored hash (replay, rate limit, status, usage unchanged).

const PEPPER = "pepper-for-tests";
const RAW = "raw-secret-abc";
const HASH = createHmac("sha256", PEPPER).update(RAW).digest("hex");
const KEY_ID = "vhyxvoid_dev_k1";

function service() {
  const store = new Map<string, string>();
  const redis = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, o?: { nx?: boolean }) => {
      if (o?.nx && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    }),
    incr: vi.fn(async (k: string) => {
      const n = Number(store.get(k) ?? 0) + 1;
      store.set(k, String(n));
      return n;
    }),
    expire: vi.fn(async () => 1),
  };
  const row = {
    keyId: KEY_ID, secretHash: HASH, previousSecretHash: null, rotationGraceEndsAt: null, status: "ACTIVE",
    accountId: "acct1", accountStatus: "ACTIVE", scopes: ["tunnel:connect"], expiresAt: null, rateLimitPerMinute: -1,
  };
  const validator = buildValidateApiKeyUseCase({ redis: redis as any, loadKey: async () => row as any });
  const auth = new HubAuthService(validator, PEPPER, async () => row as any);
  return { auth, store };
}

const register = (rawSecret?: string) => ({
  v: "1" as const, type: "sdk:register" as const, keyId: KEY_ID, requestId: randomUUID(), ts: Date.now(), signature: "x", rawSecret,
});

function request(secret: string, keyId = KEY_ID) {
  const p = { method: "POST", path: "/echo", query: "a=1", body: '{"x":1}', requestId: randomUUID(), ts: Date.now() };
  const signature = createHmac("sha256", secret).update(buildCanonical(p)).digest("hex");
  return { v: "1" as const, type: "sdk:request" as const, keyId, requestId: p.requestId, ts: p.ts, signature, method: p.method, path: p.path, query: p.query, headers: {}, body: p.body };
}

describe("TunnelClient raw-secret authentication", () => {
  it("register with the right raw secret returns a connection credential", async () => {
    const { auth } = service();
    const r = await auth.authenticateSdkRegister(register(RAW) as any, "ip");
    expect(r.accountId).toBe("acct1");
    expect(r.sdkCredential).toEqual({ rawSecret: RAW, secretHash: HASH });
  });

  it("register with a wrong raw secret is INVALID_SIGNATURE", async () => {
    const { auth } = service();
    const err = await auth.authenticateSdkRegister(register("wrong") as any, "ip").catch((e) => e);
    expect(err.code).toBe("INVALID_SIGNATURE");
  });

  it("a request signed with the raw secret passes the full validator (and counts usage once)", async () => {
    const { auth, store } = service();
    const cred = { rawSecret: RAW, secretHash: HASH, keyId: KEY_ID };
    const r = await auth.authenticateRequest(request(RAW) as any, "ip", cred);
    expect(r.accountId).toBe("acct1");
    await new Promise((res) => setTimeout(res, 0));
    const usage = [...store.keys()].filter((k) => k.startsWith("usage:"));
    expect(usage).toHaveLength(1);
  });

  it("a request signed with anything else, or for another key, is refused", async () => {
    const { auth } = service();
    const cred = { rawSecret: RAW, secretHash: HASH, keyId: KEY_ID };
    expect((await auth.authenticateRequest(request("other") as any, "ip", cred).catch((e) => e)).code).toBe("INVALID_SIGNATURE");
    expect((await auth.authenticateRequest(request(RAW, "vhyxvoid_dev_other") as any, "ip", cred).catch((e) => e)).code).toBe("INVALID_SIGNATURE");
  });

  it("replaying the same request is still refused by the validator", async () => {
    const { auth } = service();
    const cred = { rawSecret: RAW, secretHash: HASH, keyId: KEY_ID };
    const msg = request(RAW);
    await auth.authenticateRequest(msg as any, "ip", cred);
    const err = await auth.authenticateRequest(msg as any, "ip", cred).catch((e) => e);
    expect(err?.code).toBeTruthy();
  });
});
