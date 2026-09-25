import { describe, it, expect, vi } from "vitest";
import { buildCanonical as protocolCanonical } from "../../packages/protocol/src/canonical";
import { createHash, createHmac, randomUUID } from "crypto";
import { MessageRouter } from "../../apps/hub/src/router/Message.router";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { HubAuthService } from "../../apps/hub/src/services/HubAuth.service";
import { buildValidateApiKeyUseCase } from "../../packages/shared/src/validateApiKey";

// Covers shared/decision.md, 2026-09-22, "S5 investigation and proposal",
// Part 3: ValidateApiKeyUseCase.incrementUsage (called inside
// authenticateRequest(), step 1 of handleSdkRequest()) and
// Message.router.ts's own usageService.increment call (the former step 6)
// both wrote the identical Redis key
// `usage:{accountId}:{keyId}:requests:{bucket}` for the same successfully
// forwarded sdk:request, double-counting it. Fixed by deleting the
// router's own call; ValidateApiKeyUseCase.incrementUsage is now the sole
// counter for this path.

const SECRET = "the-secret-hash";
const KEY_ID = "key_1";
const ACCOUNT_ID = "acct_1";

function buildCanonical(p: {
  method: string;
  path: string;
  body: string;
  requestId: string;
  timestamp: number;
}) {
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

function makeSdkRequestMsg(overrides: Partial<{ requestId: string }> = {}) {
  const requestId = overrides.requestId ?? randomUUID();
  const timestamp = Date.now();
  const p = { method: "GET", path: "/hello", body: "" };
  return {
    v: "1" as const,
    type: "sdk:request" as const,
    keyId: KEY_ID,
    requestId,
    ts: timestamp,
    signature: sign(SECRET, { ...p, requestId, timestamp }),
    method: p.method,
    path: p.path,
    query: "",
    headers: {},
    body: null,
  };
}

function makeFakeRedis() {
  const store = new Map<string, string>();
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

function makeRouter(
  redis: ReturnType<typeof makeFakeRedis>,
  opts: { withAgent?: boolean } = {},
) {
  const withAgent = opts.withAgent ?? true;
  const loadKey = vi.fn(async () => ({
    keyId: KEY_ID,
    secretHash: SECRET,
    previousSecretHash: null,
    rotationGraceEndsAt: null,
    status: "ACTIVE",
    accountId: ACCOUNT_ID,
    accountStatus: "ACTIVE",
    scopes: ["tunnel:connect"],
    expiresAt: null,
    // -1 = unlimited (toRateLimit's documented sentinel) — keeps the
    // per-minute rate limiter out of this test's way entirely.
    rateLimitPerMinute: -1,
  }));
  const validateKeyUseCase = buildValidateApiKeyUseCase({
    redis: redis as any,
    loadKey,
  });
  const authService = new HubAuthService(
    validateKeyUseCase,
    "pepper",
    async () => null,
  );

  const agentRegistry = new AgentRegistry();
  const forwarded: any[] = [];
  if (withAgent) {
    agentRegistry.register({
      agentId: "agt_1",
      accountId: ACCOUNT_ID,
      keyId: "uuid_key_1",
      label: "default",
      ws: { send: (raw: string) => forwarded.push(JSON.parse(raw)), readyState: 1 },
      connectedAt: new Date(),
      lastSeenAt: new Date(),
      missedPings: 0,
      agentVersion: "1.0.0",
      ip: "127.0.0.1",
    } as any);
  }

  const pendingRegistry = {
    enqueue: async (req: any) => {
      // Simulate an immediate agent response so handleSdkRequest() doesn't
      // leave a real 30s timer running past the end of the test.
      req.resolve({
        v: "1",
        type: "tunnel:response",
        requestId: req.requestId,
        status: 200,
        headers: {},
        body: null,
        durationMs: 1,
      });
    },
  } as any;

  const usageService = { increment: vi.fn() } as any;
  const requestRepo = { create: vi.fn(async () => {}) } as any;

  const sent: any[] = [];
  const ws = { send: (raw: string) => sent.push(JSON.parse(raw)) };

  const router = new MessageRouter(
    agentRegistry,
    { findByWs: () => null } as any, // sdkRegistry: this ws never sent sdk:register
    pendingRegistry,
    authService,
    {} as any, // heartbeat — not exercised
    usageService,
    {} as any, // pubsub — not exercised
    {} as any, // sessionRepo — not exercised (no plan lookup on this path)
    requestRepo,
    "hub_1",
    {} as any, // subdomainRegistry — not exercised
    "vhyxvoid.com",
    {} as any, // httpTunnelHandler — not exercised
  );

  return { router, ws, sent, forwarded, usageService, requestRepo };
}

function usageKeysFor(redis: ReturnType<typeof makeFakeRedis>) {
  return [...redis.store.keys()].filter((k) =>
    k.startsWith(`usage:${ACCOUNT_ID}:${KEY_ID}:requests:`),
  );
}

describe("sdk:request usage counting is not double-counted", () => {
  it("a successfully forwarded request increments the usage counter by exactly 1, not 2", async () => {
    const redis = makeFakeRedis();
    const { router, ws, forwarded, usageService } = makeRouter(redis);

    const msg = makeSdkRequestMsg();
    await router.routeSdkMessage(ws, Buffer.from(JSON.stringify(msg)), "127.0.0.1");

    // The agent really was forwarded the request (this is the successfully-
    // forwarded case the double-count specifically depended on).
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].type).toBe("tunnel:forward");

    // Message.router.ts no longer calls HubUsageService for this path.
    expect(usageService.increment).not.toHaveBeenCalled();

    // ValidateApiKeyUseCase.incrementUsage (inside authenticateRequest) is
    // the sole counter: exactly one bucket key, incremented to 1.
    const keys = usageKeysFor(redis);
    expect(keys).toHaveLength(1);
    expect(redis.store.get(keys[0])).toBe("1");
  });

  it("three successfully forwarded requests land at exactly 3, not 6", async () => {
    const redis = makeFakeRedis();
    const { router, ws } = makeRouter(redis);

    for (let i = 0; i < 3; i++) {
      const msg = makeSdkRequestMsg();
      await router.routeSdkMessage(ws, Buffer.from(JSON.stringify(msg)), "127.0.0.1");
    }

    const keys = usageKeysFor(redis);
    expect(keys).toHaveLength(1); // same 5-minute bucket
    expect(redis.store.get(keys[0])).toBe("3");
  });

  it("an early rejection (no agent connected) still counts exactly once, unaffected by the fix", async () => {
    // No agent registered under this account — authenticateRequest() still
    // runs and counts the request (step 1) before AGENT_NOT_FOUND is
    // reached (step 3); the former double-count site (step 6) was never
    // reached even before this fix, since it sat after the agent lookup.
    // This confirms the fix only removed the redundant second count, not
    // the legitimate single one for a request that never reaches an agent.
    const redis = makeFakeRedis();
    const { router, ws, sent } = makeRouter(redis, { withAgent: false });

    const msg = makeSdkRequestMsg();
    await router.routeSdkMessage(ws, Buffer.from(JSON.stringify(msg)), "127.0.0.1");

    expect(sent.find((m) => m.code === "AGENT_NOT_FOUND")).toBeTruthy();
    const keys = usageKeysFor(redis);
    expect(keys).toHaveLength(1);
    expect(redis.store.get(keys[0])).toBe("1");
  });
});
