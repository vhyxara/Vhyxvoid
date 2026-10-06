// Hosted mock APIs at the hub, over real HTTP: the real HttpTunnelHandler, its
// forwards delivered to the real agent BackendProxy and a real local backend.
// Only the registries and the rule/mock sources are faked.
import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, Server, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { HttpTunnelHandler } from "../../apps/hub/src/handlers/HttpTunnel.handler";
import { TrafficRuleCache } from "../../apps/hub/src/services/TrafficRuleCache.service";
import { MockApiCache } from "../../apps/hub/src/services/MockApiCache.service";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";
import type { MockApiDefinition, MockEndpoint } from "../../packages/shared/src/mockApi";
import type { TrafficRule } from "../../packages/shared/src/trafficRules";

const servers: Server[] = [];
const proxies: BackendProxy[] = [];

afterEach(async () => {
  for (const p of proxies.splice(0)) p.stop();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function listen(h: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  const server = createServer(h);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

let n = 0;
const ep = (method: MockEndpoint["method"], path: string, responses: Array<Partial<MockEndpoint["responses"][number]> & { status: number }>, extra: Partial<MockEndpoint> = {}): MockEndpoint => ({
  id: `e${++n}`,
  name: `${method} ${path}`,
  enabled: true,
  method,
  path,
  responses: responses.map((r) => ({ id: `r${++n}`, ...r })),
  ...extra,
});
const mockDef = (endpoints: MockEndpoint[], extra: Partial<MockApiDefinition> = {}): MockApiDefinition => ({ mode: "ALWAYS", cors: false, latencyMs: 0, endpoints, ...extra });

type Seen = { method: string; url: string; body: string };

async function startHub(mock: MockApiDefinition | null, opts: { agentConnected?: boolean; registered?: boolean; rules?: TrafficRule[] } = {}) {
  const seen: Seen[] = [];
  const backendPort = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, body });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("from the app");
    });
  });
  const proxy = new BackendProxy(backendPort);
  proxies.push(proxy);
  const pending = new Map<string, (r: any) => void>();
  const agentWs = {
    readyState: 1,
    send: (raw: string) => {
      const msg = JSON.parse(raw);
      proxy.forward(msg).then((result) => pending.get(msg.requestId)?.({ v: "1", type: "tunnel:response", requestId: msg.requestId, ...result }));
    },
  };
  const recorded: any[] = [];
  const stats: Array<[string, string, number]> = [];
  const lookups = { count: 0 };
  const rules = new TrafficRuleCache({ findTrafficRules: async () => opts.rules ?? [], findAccountIdBySlug: async (slug) => (slug === "acme" ? "acct_1" : null) });
  const mocks = new MockApiCache({
    findMockApi: async (accountId, label) => {
      lookups.count++;
      return accountId === "acct_1" && label === "app" ? mock : null;
    },
  });
  const handler = new HttpTunnelHandler(
    {
      resolve: async () => (opts.registered === false ? null : { agentId: "agt_1", accountId: "acct_1", label: "app", accountSlug: "acme", hubInstanceId: "hub_1" }),
      unregister: async () => {},
    } as any,
    { findByAgentId: () => (opts.agentConnected === false ? null : { agentId: "agt_1", keyId: "key_1", ws: agentWs }) } as any,
    { enqueue: async (r: any) => void pending.set(r.requestId, r.resolve), reject: () => false, drop: () => false } as any,
    "vhyxvoid.com",
    undefined,
    undefined,
    { record: (_a: string, e: any) => recorded.push(e) } as any,
    undefined,
    "pepper",
    undefined,
    { record: (a: string, l: string, s: number) => stats.push([a, l, s]) } as any,
    rules,
    undefined,
    mocks,
  );
  const port = await listen((req, res) => {
    handler.handle(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  return { port, seen, recorded, stats, lookups, mocks };
}

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; headers: IncomingMessage["headers"]; body: string; ms: number }>((resolve, reject) => {
    const t = Date.now();
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: { host: "acme--app.vhyxvoid.com", ...headers } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: b, ms: Date.now() - t }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("hosted mock APIs at the hub", () => {
  it("with no agent at all, the mock answers its routes (templated, from the body) and names missing ones", async () => {
    const h = await startHub(
      mockDef([
        ep("POST", "/users", [
          { status: 422, body: '{"error":"email required"}', rules: [{ source: "body", key: "email", op: "not_exists" }] },
          { status: 201, templating: true, isDefault: true, headers: { "content-type": "application/json" }, body: '{"email":"{{request.body.email}}","id":"{{request.params.none}}x"}' },
        ]),
      ]),
      { registered: false },
    );
    const created = await call(h.port, "POST", "/users", { "content-type": "application/json" }, '{"email":"ada@example.com"}');
    expect(created.status).toBe(201);
    expect(JSON.parse(created.body)).toEqual({ email: "ada@example.com", id: "x" });
    expect(created.headers["x-vhyxvoid-mock"]).toMatch(/^e\d+$/);
    expect((await call(h.port, "POST", "/users", { "content-type": "application/json" }, "{}")).status).toBe(422);

    const missing = await call(h.port, "GET", "/orders?x=1");
    expect(missing.status).toBe(404);
    expect(missing.headers["x-vhyxvoid-error"]).toBe("MOCK_NO_ROUTE");
    expect(JSON.parse(missing.body).error).toContain("GET /orders");

    expect(h.stats.map((s) => s[2])).toEqual([201, 422]);
    expect(h.recorded[0]).toMatchObject({ method: "POST", path: "/users", response: { status: 201 }, mock: { endpointName: "POST /users" } });
    expect(h.recorded[0].request.body.data).toBe('{"email":"ada@example.com"}');
    expect(h.recorded[0].answeredByRule).toBeUndefined();
  });

  it("ALWAYS: mocked routes answer even with the agent connected; the rest (and their bodies) reach the app", async () => {
    const h = await startHub(mockDef([ep("GET", "/users/:id", [{ status: 200, templating: true, body: "user {{request.params.id}}" }])]));
    const mocked = await call(h.port, "GET", "/users/42");
    expect(mocked).toMatchObject({ status: 200, body: "user 42" });
    expect(h.seen).toHaveLength(0);

    const forwarded = await call(h.port, "POST", "/orders", { "content-type": "application/json" }, '{"sku":"a"}');
    expect(forwarded.body).toBe("from the app");
    expect(h.seen).toEqual([{ method: "POST", url: "/orders", body: '{"sku":"a"}' }]);
  });

  it("OFFLINE: the app answers while connected; the mock takes over when the agent is gone", async () => {
    const def = mockDef([ep("GET", "/status", [{ status: 503, body: "down for maintenance" }])], { mode: "OFFLINE" });
    const online = await startHub(def);
    expect((await call(online.port, "GET", "/status")).body).toBe("from the app");
    const stale = await startHub(def, { agentConnected: false });
    expect(await call(stale.port, "GET", "/status")).toMatchObject({ status: 503, body: "down for maintenance" });
    const gone = await startHub(def, { registered: false });
    expect((await call(gone.port, "GET", "/status")).status).toBe(503);
  });

  it("CORS preflight, latency, HEAD and 204 have the right shape", async () => {
    const h = await startHub(
      mockDef([ep("GET", "/slow", [{ status: 200, body: "ok", latencyMs: 120 }]), ep("DELETE", "/x", [{ status: 204, body: "ignored" }])], { cors: true, latencyMs: 30 }),
      { registered: false },
    );
    const pre = await call(h.port, "OPTIONS", "/anything", { origin: "https://app.test", "access-control-request-method": "DELETE" });
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe("https://app.test");
    const slow = await call(h.port, "GET", "/slow", { origin: "https://app.test" });
    expect(slow.ms).toBeGreaterThanOrEqual(140);
    expect(slow.headers["access-control-allow-origin"]).toBe("https://app.test");
    const head = await call(h.port, "HEAD", "/slow");
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    const del = await call(h.port, "DELETE", "/x");
    expect(del.status).toBe(204);
    expect(del.body).toBe("");
  });

  it("traffic rules come first; their delay and response headers apply to mock answers", async () => {
    const rules: TrafficRule[] = [
      { id: "t1", name: "fail", enabled: true, when: "always", match: { path: "/boom" }, action: { type: "fail", status: 500, percent: 100 } },
      { id: "t2", name: "hdr", enabled: true, when: "always", match: { path: "*" }, action: { type: "responseHeaders", set: { "X-Env": "mock" } } },
    ];
    const h = await startHub(mockDef([ep("ANY", "/*", [{ status: 200, body: "mocked" }])]), { rules });
    expect((await call(h.port, "GET", "/boom")).status).toBe(500);
    const r = await call(h.port, "GET", "/fine");
    expect(r.body).toBe("mocked");
    expect(r.headers["x-env"]).toBe("mock");
  });

  it("no mock on the label: behaviour is unchanged (404 TUNNEL_OFFLINE), and lookups are cached", async () => {
    const h = await startHub(null, { registered: false });
    const r = await call(h.port, "GET", "/");
    expect(r.status).toBe(404);
    expect(r.headers["x-vhyxvoid-error"]).toBe("TUNNEL_OFFLINE");
    await call(h.port, "GET", "/again");
    expect(h.lookups.count).toBe(1);
    h.mocks.invalidate("acct_1", "app");
    await call(h.port, "GET", "/third");
    expect(h.lookups.count).toBe(2);
  });

  it("resources: CRUD at the hub with no agent; endpoints win over a resource route; inspector names the resource", async () => {
    const def = mockDef([ep("GET", "/users/me", [{ status: 200, body: "me" }])], { id: "mock_hub", resources: [{ id: "res_u", name: "users", path: "/users", enabled: true, seed: [{ id: 1, name: "Ada" }] }] });
    const h = await startHub(def, { registered: false });
    expect(JSON.parse((await call(h.port, "GET", "/users")).body)).toEqual([{ id: 1, name: "Ada" }]);
    const made = await call(h.port, "POST", "/users", { "content-type": "application/json" }, '{"name":"Alan"}');
    expect(made.status).toBe(201);
    expect(made.headers.location).toBe("/users/2");
    expect(JSON.parse((await call(h.port, "GET", "/users/2")).body).name).toBe("Alan");
    expect((await call(h.port, "GET", "/users/me")).body).toBe("me");
    expect((await call(h.port, "DELETE", "/users/2")).status).toBe(204);
    expect((await call(h.port, "GET", "/users/2")).status).toBe(404);
    expect(h.recorded.find((e: any) => e.method === "POST").mock).toMatchObject({ endpointName: "Resource users", responseName: "create" });
  });
});
