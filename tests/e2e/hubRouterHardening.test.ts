import { describe, expect, it, vi } from "vitest";
import { MessageRouter } from "../../apps/hub/src/router/Message.router";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { PendingRegistry } from "../../apps/hub/src/registry/Pending.registry";
import {
  HttpTunnelHandler,
  publicAgentErrorMessage,
  requestHostname,
} from "../../apps/hub/src/handlers/HttpTunnel.handler";
import { isValidLabel, labelProblem, normalizeLabel } from "../../packages/protocol/src/label";

// Audit 2026-09-24 M2 (any socket could answer any request), M3 (SDK-chosen
// request ids), M4 (subdomain registered after the DB write), M5 (second
// register on one socket), M6 (labels), M1/L8 (host handling), M10 (error
// detail on public responses).

const ACCOUNT = "acct_1";

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { send: (raw: string) => sent.push(JSON.parse(raw)), close: vi.fn(), readyState: 1 } };
}

function session(agentId: string, ws: any, label = "default") {
  return {
    agentId,
    accountId: ACCOUNT,
    keyId: "uuid_key",
    label,
    ws,
    connectedAt: new Date(),
    lastSeenAt: new Date(),
    missedPings: 0,
    agentVersion: "1.1.0",
    ip: "127.0.0.1",
  } as any;
}

function makeRouter(overrides: { auth?: any; sessionRepo?: any; subdomainRegistry?: any } = {}) {
  const agentRegistry = new AgentRegistry();
  const pendingRegistry = new PendingRegistry();
  const heartbeat = { handlePong: vi.fn() };
  const requestRepo = { create: vi.fn(async () => {}), recordResponse: vi.fn(async () => {}) };
  const subdomainRegistry = overrides.subdomainRegistry ?? { register: vi.fn(async () => {}) };
  const router = new MessageRouter(
    agentRegistry,
    { findByWs: () => null } as any,
    pendingRegistry,
    overrides.auth ?? ({} as any),
    heartbeat as any,
    { increment: vi.fn() } as any,
    {} as any,
    overrides.sessionRepo ?? ({} as any),
    requestRepo as any,
    "hub_1",
    subdomainRegistry,
    "vhyxvoid.com",
    { closeAllForAgent: vi.fn(() => 0) } as any,
  );
  return { router, agentRegistry, pendingRegistry, heartbeat, subdomainRegistry };
}

function pending(registry: PendingRegistry, requestId: string, agentId: string) {
  const resolve = vi.fn();
  const reject = vi.fn();
  void registry.enqueue({
    requestId,
    accountId: ACCOUNT,
    agentLabel: "default",
    keyId: "k",
    agentId,
    enqueuedAt: Date.now(),
    resolve,
    reject,
    timer: setTimeout(() => {}, 0),
  });
  return { resolve, reject };
}

const response = (requestId: string) =>
  Buffer.from(JSON.stringify({ v: "1", type: "tunnel:response", requestId, status: 200, headers: {}, body: null, durationMs: 1 }));

describe("M2: only the owning agent can answer a request", () => {
  it("ignores tunnel:response from an unregistered socket", async () => {
    const { router, pendingRegistry } = makeRouter();
    const { resolve } = pending(pendingRegistry, "req_a", "agt_owner");
    const stranger = fakeWs();

    await router.routeAgentMessage(stranger.ws, response("req_a"), "1.2.3.4");

    expect(resolve).not.toHaveBeenCalled();
    expect(stranger.sent[0]).toMatchObject({ type: "hub:error", code: "INVALID_MESSAGE" });
    expect(pendingRegistry.size()).toBe(1);
  });

  it("ignores a response from another registered agent, accepts the owner's", async () => {
    const { router, agentRegistry, pendingRegistry } = makeRouter();
    const owner = fakeWs();
    const other = fakeWs();
    agentRegistry.register(session("agt_owner", owner.ws, "a"));
    agentRegistry.register(session("agt_other", other.ws, "b"));
    const { resolve } = pending(pendingRegistry, "req_b", "agt_owner");

    await router.routeAgentMessage(other.ws, response("req_b"), "ip");
    expect(resolve).not.toHaveBeenCalled();

    await router.routeAgentMessage(owner.ws, response("req_b"), "ip");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("only counts a pong for the agent whose socket sent it", async () => {
    const { router, agentRegistry, heartbeat } = makeRouter();
    const a = fakeWs();
    agentRegistry.register(session("agt_a", a.ws));
    const pong = (agentId: string) => Buffer.from(JSON.stringify({ v: "1", type: "agent:pong", agentId, ts: Date.now() }));

    await router.routeAgentMessage(a.ws, pong("agt_someone_else"), "ip");
    expect(heartbeat.handlePong).not.toHaveBeenCalled();
    await router.routeAgentMessage(a.ws, pong("agt_a"), "ip");
    expect(heartbeat.handlePong).toHaveBeenCalledWith("agt_a");
  });

  it("PendingRegistry refuses duplicate ids instead of orphaning the first", async () => {
    const reg = new PendingRegistry();
    pending(reg, "dup", "agt");
    await expect(
      reg.enqueue({ requestId: "dup", accountId: ACCOUNT, agentLabel: "x", keyId: "k", enqueuedAt: 0, resolve() {}, reject() {}, timer: setTimeout(() => {}, 0) }),
    ).rejects.toThrow(/duplicate/);
  });
});

describe("registration", () => {
  function registerDeps() {
    const auth = { authenticateAgent: vi.fn(async () => ({ accountId: ACCOUNT, keyId: "pub_key", secretFingerprint: "fp" })) };
    const order: string[] = [];
    let resolveUpsert: () => void = () => {};
    const sessionRepo = {
      findPlanLimitsForAccount: async () => ({ plan: "PRO", maxAgents: 5 }),
      findApiKeyByPublicId: async () => ({ id: "uuid_key", accountId: ACCOUNT }),
      findAccountSlug: async () => "acme-1234abcd",
      // A database that never answers: registration must not depend on it.
      upsert: vi.fn(() => new Promise<void>((r) => (resolveUpsert = r))),
    };
    const subdomainRegistry = { register: vi.fn(async () => void order.push("subdomain")) };
    return { auth, sessionRepo, subdomainRegistry, order, finishUpsert: () => resolveUpsert() };
  }
  const register = (label: string) => Buffer.from(JSON.stringify({ v: "1", type: "agent:register", keyId: "pub_key", rawSecret: "s", label, agentVersion: "1.1.0" }));

  it("M4: routes the public URL before announcing hub:registered, without waiting for Postgres", async () => {
    const deps = registerDeps();
    const { router } = makeRouter(deps);
    const a = fakeWs();
    const origSend = a.ws.send;
    a.ws.send = (raw: string) => {
      deps.order.push(JSON.parse(raw).type);
      origSend(raw);
    };

    await router.routeAgentMessage(a.ws, register("api"), "ip");

    expect(deps.order).toEqual(["subdomain", "hub:registered"]);
    expect(a.sent[0].tunnelUrl).toBe("https://acme-1234abcd--api.vhyxvoid.com");
    deps.finishUpsert();
  });

  it("M5: refuses a second agent:register on the same socket", async () => {
    const deps = registerDeps();
    const { router, agentRegistry } = makeRouter(deps);
    const a = fakeWs();
    await router.routeAgentMessage(a.ws, register("api"), "ip");
    await router.routeAgentMessage(a.ws, register("web"), "ip");

    expect(agentRegistry.countByAccount(ACCOUNT)).toBe(1);
    expect(a.sent.at(-1)).toMatchObject({ type: "hub:error", code: "INVALID_MESSAGE" });
    expect(deps.auth.authenticateAgent).toHaveBeenCalledTimes(1);
  });

  it("M6: lowercases labels and refuses invalid ones with a fatal INVALID_LABEL", async () => {
    const deps = registerDeps();
    const { router, agentRegistry } = makeRouter(deps);
    const a = fakeWs();
    await router.routeAgentMessage(a.ws, register("MyApp"), "ip");
    expect(agentRegistry.find(ACCOUNT, "myapp")).toBeTruthy();

    const b = fakeWs();
    await router.routeAgentMessage(b.ws, register("bad--label"), "ip");
    expect(b.sent[0]).toMatchObject({ type: "hub:error", code: "INVALID_LABEL", fatal: true });
    expect(b.ws.close).toHaveBeenCalled();
  });
});

describe("M3: SDK requests are forwarded under a hub-generated id", () => {
  it("forward id differs from the SDK id; the SDK reply carries its own id", async () => {
    const agentWs = fakeWs();
    const agentRegistry = new AgentRegistry();
    agentRegistry.register(session("agt_1", agentWs.ws));
    const pendingRegistry = new PendingRegistry();
    const auth = { authenticateRequest: vi.fn(async () => ({ accountId: ACCOUNT, keyId: "pub_key" })) };
    const router = new MessageRouter(
      agentRegistry,
      { findByWs: () => null } as any,
      pendingRegistry,
      auth as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { create: vi.fn(async () => {}), recordResponse: vi.fn(async () => {}) } as any,
      "hub_1",
      {} as any,
      "vhyxvoid.com",
      {} as any,
    );
    const sdk = fakeWs();
    const sdkMsg = { v: "1", type: "sdk:request", keyId: "pub_key", requestId: "client-chosen", ts: Date.now(), signature: "x", method: "GET", path: "/x", query: "", headers: {}, body: null };

    await router.routeSdkMessage(sdk.ws, Buffer.from(JSON.stringify(sdkMsg)), "ip");
    const forward = agentWs.sent[0];
    expect(forward.type).toBe("tunnel:forward");
    expect(forward.requestId).not.toBe("client-chosen");
    expect(forward.requestId).toMatch(/^req_/);

    await router.routeAgentMessage(agentWs.ws, response(forward.requestId), "ip");
    expect(sdk.sent[0]).toMatchObject({ type: "sdk:response", requestId: "client-chosen", status: 200 });
  });
});

describe("labels (protocol)", () => {
  it("accepts DNS-safe labels and explains refusals", () => {
    for (const ok of ["a", "api", "web-2", "x".repeat(63)]) expect(isValidLabel(ok)).toBe(true);
    for (const bad of ["", "-a", "a-", "a--b", "a.b", "A", "x".repeat(64), "a b"]) expect(isValidLabel(bad)).toBe(false);
    expect(normalizeLabel("  MyApp ")).toBe("myapp");
    expect(labelProblem("a--b")).toMatch(/--/);
    expect(labelProblem("ok")).toBeUndefined();
  });
});

describe("hosts and public errors", () => {
  const handler = new HttpTunnelHandler({} as any, {} as any, {} as any, "vhyxvoid.com");
  const req = (host: string) => ({ headers: { host } }) as any;

  it("L8: lowercases, strips port and trailing dot", () => {
    expect(requestHostname(req("ACME--App.VhyxVoid.com.:443"))).toBe("acme--app.vhyxvoid.com");
  });

  it("M1: service hosts are not tunnels, so the hub's /health stays on hub. and tenants keep theirs", () => {
    expect(handler.isTunnelRequest(req("hub.vhyxvoid.com"))).toBe(false);
    expect(handler.isTunnelRequest(req("api.vhyxvoid.com"))).toBe(false);
    expect(handler.isTunnelRequest(req("acme--app.vhyxvoid.com"))).toBe(true);
    expect(handler.isTunnelRequest(req("ACME--APP.VHYXVOID.COM"))).toBe(true);
  });

  it("M10: public agent errors carry no local detail", () => {
    for (const code of ["BACKEND_UNAVAILABLE", "AGENT_TIMEOUT", "AGENT_DISCONNECTED", "SEND_FAILED", "WHATEVER"]) {
      const text = publicAgentErrorMessage(code);
      expect(text).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|port \d/);
      expect(text.length).toBeGreaterThan(10);
    }
  });
});
