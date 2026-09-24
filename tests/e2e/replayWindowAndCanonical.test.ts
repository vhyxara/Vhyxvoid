import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac, randomUUID } from "crypto";
import { buildValidateApiKeyUseCase } from "../../packages/shared/src/validateApiKey";
import { buildCanonical, TIMING } from "../../packages/protocol/src/index";
import { HubAuthService } from "../../apps/hub/src/services/HubAuth.service";

// Covers internal-tools/shared/audit-2026-09-24.md H8:
// - the replay key expired before the signature window closed, so a captured
//   request stamped at the edge of the skew window could be replayed;
// - the replay key was written before the key lookup and signature check, so
//   unauthenticated garbage cost a Redis write and could pre-burn a
//   legitimate client's requestId;
// - the replay namespace was global, not per key;
// - the verifier signed an empty query (its own canonical copy), so a query
//   string could be added to a signed request;
// - canonical fields were "|"-joined without escaping, so adjacent fields
//   could be shifted into each other.

const SECRET = "secret-hash-value";
const ACCOUNT = "acct_1";

afterEach(() => vi.useRealTimers());

/** Upstash-like fake honouring SET NX + PX against the (fake) clock. */
function makeRedis() {
  const store = new Map<string, { v: string; expiresAt: number | null }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (e && e.expiresAt !== null && e.expiresAt <= Date.now()) store.delete(k);
    return store.get(k);
  };
  return {
    store,
    get: vi.fn(async (k: string) => live(k)?.v ?? null),
    set: vi.fn(async (k: string, v: string, o?: { nx?: boolean; px?: number; ex?: number }) => {
      if (o?.nx && live(k)) return null;
      const ttl = o?.px ?? (o?.ex !== undefined ? o.ex * 1000 : undefined);
      store.set(k, { v, expiresAt: ttl !== undefined ? Date.now() + ttl : null });
      return "OK";
    }),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  };
}

function row(keyId: string) {
  return {
    keyId,
    secretHash: SECRET,
    previousSecretHash: null,
    rotationGraceEndsAt: null,
    status: "ACTIVE",
    accountId: ACCOUNT,
    accountStatus: "ACTIVE",
    scopes: ["tunnel:connect"],
    expiresAt: null,
    rateLimitPerMinute: -1,
  };
}

function makeUseCase(redis = makeRedis()) {
  const useCase = buildValidateApiKeyUseCase({
    redis: redis as any,
    loadKey: vi.fn(async (keyId: string) => (keyId.startsWith("key_") ? row(keyId) : null)),
  });
  return { useCase, redis };
}

function signed(o: { keyId?: string; requestId?: string; ts?: number; query?: string; signQuery?: string } = {}) {
  const requestId = o.requestId ?? randomUUID();
  const ts = o.ts ?? Date.now();
  const query = o.query ?? "";
  const canonical = buildCanonical({
    method: "GET",
    path: "/orders",
    query: o.signQuery ?? query,
    body: "",
    requestId,
    ts,
  });
  return {
    keyId: o.keyId ?? "key_1",
    signature: createHmac("sha256", SECRET).update(canonical).digest("hex"),
    method: "GET",
    path: "/orders",
    query,
    body: "",
    requestId,
    timestamp: ts,
    requiredScope: "tunnel:connect",
    ip: "203.0.113.7",
  };
}

const replayKeysWritten = (redis: ReturnType<typeof makeRedis>) =>
  redis.set.mock.calls.map((c) => c[0] as string).filter((k) => k.startsWith("apikey:replay:"));

describe("replay window covers the whole signature window", () => {
  it("a request stamped at the edge of the skew window can't be replayed at any point it's still valid", async () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-09-24T12:00:00Z").getTime();
    vi.setSystemTime(t0);
    const W = TIMING.SIGNATURE_WINDOW_MS;
    const { useCase } = makeUseCase();
    // Client clock ahead by the full window: valid from t0 until ts + W = t0 + 2W.
    const captured = signed({ ts: t0 + W });

    expect((await useCase.execute(captured)).valid).toBe(true);

    for (const at of [t0 + W, t0 + W + W / 2, t0 + 2 * W - 1]) {
      vi.setSystemTime(at);
      const r = await useCase.execute(captured);
      expect(r.valid, `replay at t0+${(at - t0) / 1000}s`).toBe(false);
      expect((r as any).code).toBe("REPLAY_ATTACK");
    }
  });

  it("the replay TTL is at least twice the skew window", () => {
    expect(TIMING.REPLAY_WINDOW_MS).toBeGreaterThanOrEqual(2 * TIMING.SIGNATURE_WINDOW_MS);
  });
});

describe("the replay key is written only for a verified request", () => {
  it("an unknown key and a bad signature cost no replay-key write", async () => {
    const { useCase, redis } = makeUseCase();

    await useCase.execute({ ...signed(), keyId: "nope" });
    await useCase.execute({ ...signed(), signature: "00".repeat(32) });

    expect(replayKeysWritten(redis)).toEqual([]);
  });

  it("garbage sent first with a victim's requestId can't pre-burn it", async () => {
    const { useCase } = makeUseCase();
    const legit = signed();

    await useCase.execute({ ...legit, signature: "ab".repeat(32) }); // attacker guessed the id

    expect((await useCase.execute(legit)).valid).toBe(true);
  });

  it("replay keys are per API key: the same requestId under two keys is two requests", async () => {
    const { useCase, redis } = makeUseCase();
    const id = randomUUID();

    expect((await useCase.execute(signed({ keyId: "key_1", requestId: id }))).valid).toBe(true);
    expect((await useCase.execute(signed({ keyId: "key_2", requestId: id }))).valid).toBe(true);
    expect(replayKeysWritten(redis)).toEqual([`apikey:replay:key_1:${id}`, `apikey:replay:key_2:${id}`]);
  });
});

describe("the query string is signed", () => {
  function hub() {
    const { useCase } = makeUseCase();
    return new HubAuthService(useCase, "pepper", async () => null);
  }
  const msg = (p: ReturnType<typeof signed>) => ({
    v: "1" as const,
    type: "sdk:request" as const,
    keyId: p.keyId,
    requestId: p.requestId,
    ts: p.timestamp,
    signature: p.signature,
    method: p.method,
    path: p.path,
    query: p.query,
    headers: {},
    body: null,
  });

  it("a query added to a request signed without one is rejected", async () => {
    const p = signed({ query: "admin=true", signQuery: "" });
    await expect(hub().authenticateRequest(msg(p) as any, "203.0.113.7")).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
    });
  });

  it("a changed query is rejected", async () => {
    const p = signed({ query: "user=2", signQuery: "user=1" });
    await expect(hub().authenticateRequest(msg(p) as any, "203.0.113.7")).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
    });
  });

  it("a request whose query was signed (as TunnelClient signs it) is accepted", async () => {
    const p = signed({ query: "page=2&sort=asc" });
    await expect(hub().authenticateRequest(msg(p) as any, "203.0.113.7")).resolves.toMatchObject({
      accountId: ACCOUNT,
    });
  });
});

describe("canonical fields can't be shifted into each other", () => {
  it("a '|' in the path doesn't collide with the query field", () => {
    const base = { method: "GET", body: "", requestId: "r", ts: 1 };
    expect(buildCanonical({ ...base, path: "/x|q=1", query: "" })).not.toBe(
      buildCanonical({ ...base, path: "/x", query: "q=1|" }),
    );
  });
});
