// Traffic rules at the hub, over real HTTP: the real HttpTunnelHandler, its
// forwards delivered to the real agent BackendProxy and a real local backend.
// Only the registries and the rule source are faked.
import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, Server, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { HttpTunnelHandler } from "../../apps/hub/src/handlers/HttpTunnel.handler";
import { TrafficRuleCache } from "../../apps/hub/src/services/TrafficRuleCache.service";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";
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
const rule = (over: Partial<TrafficRule> & Pick<TrafficRule, "action">): TrafficRule => ({ id: `r${++n}`, name: `rule ${n}`, enabled: true, when: "always", match: { path: "*" }, ...over });

type Seen = { method: string; url: string; headers: IncomingMessage["headers"] };

async function startTunnel(rules: TrafficRule[], opts: { agentConnected?: boolean; registered?: boolean } = {}) {
  const seen: Seen[] = [];
  const backendPort = await listen((req, res) => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers });
    res.writeHead(200, { "content-type": "text/plain", "x-powered-by": "Express" });
    res.end("from the app");
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
  const cache = new TrafficRuleCache({ findTrafficRules: async () => rules, findAccountIdBySlug: async (slug) => (slug === "acme" ? "acct_1" : null) });
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
    cache,
  );
  const port = await listen((req, res) => {
    handler.handle(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  return { port, seen, recorded, stats };
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

describe("traffic rules at the hub", () => {
  it("a mock answers without the app, and is counted and inspected", async () => {
    const t = await startTunnel([rule({ match: { path: "/api/users", methods: ["POST"] }, action: { type: "mock", status: 201, headers: { "Content-Type": "application/json" }, body: '{"id":7}' } })]);
    const r = await call(t.port, "POST", "/api/users", { "content-type": "application/json" }, '{"name":"x"}');
    expect(r).toMatchObject({ status: 201, body: '{"id":7}' });
    expect(r.headers["content-type"]).toBe("application/json");
    expect(r.headers["x-vhyxvoid-rule"]).toBe(`r${n}`);
    expect(t.seen).toHaveLength(0);
    expect(t.stats).toEqual([["acct_1", "app", 201]]);
    expect(t.recorded[0]).toMatchObject({ answeredByRule: true, path: "/api/users", response: { status: 201 } });
    expect(t.recorded[0].request.body.data).toBe('{"name":"x"}');
    // Other paths still reach the app.
    expect((await call(t.port, "GET", "/api/other")).body).toBe("from the app");
  });

  it("rewrites, request and response headers, and delay change what is forwarded and returned", async () => {
    const t = await startTunnel([
      rule({ match: { path: "/v1/*" }, action: { type: "rewrite", to: "/v2" } }),
      rule({ action: { type: "requestHeaders", set: { "X-Env": "preview" }, remove: ["X-Debug"] } }),
      rule({ action: { type: "responseHeaders", set: { "Access-Control-Allow-Origin": "*" }, remove: ["X-Powered-By"] } }),
      rule({ action: { type: "delay", ms: 150 } }),
    ]);
    const r = await call(t.port, "GET", "/v1/items?page=2", { "x-debug": "1" });
    expect(r.status).toBe(200);
    expect(r.ms).toBeGreaterThanOrEqual(140);
    expect(t.seen[0].url).toBe("/v2/items?page=2");
    expect(t.seen[0].headers["x-env"]).toBe("preview");
    expect(t.seen[0].headers["x-debug"]).toBeUndefined();
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(t.recorded[0].ruleIds).toHaveLength(4);
  });

  it("an injected failure and a redirect", async () => {
    const t = await startTunnel([
      rule({ match: { path: "/flaky" }, action: { type: "fail", status: 503, percent: 100 } }),
      rule({ match: { path: "/old/*" }, action: { type: "redirect", status: 301, location: "https://new.acme.dev{path}" } }),
    ]);
    const f = await call(t.port, "GET", "/flaky");
    expect(f.status).toBe(503);
    expect(f.body).toMatch(/Injected 503/);
    const red = await call(t.port, "GET", "/old/a?b=1");
    expect(red.status).toBe(301);
    expect(red.headers.location).toBe("https://new.acme.dev/old/a?b=1");
    expect(t.seen).toHaveLength(0);
  });

  it("offline rules answer while the agent is gone, and when nothing is registered at all", async () => {
    const rules = [rule({ when: "offline", match: { path: "*", methods: ["GET"] }, action: { type: "mock", status: 503, body: "Back in a minute" } })];
    const disconnected = await startTunnel(rules, { agentConnected: false });
    expect(await call(disconnected.port, "GET", "/")).toMatchObject({ status: 503, body: "Back in a minute" });
    const unregistered = await startTunnel(rules, { registered: false });
    expect(await call(unregistered.port, "GET", "/x")).toMatchObject({ status: 503, body: "Back in a minute" });
    // A method the rule does not cover gets the normal "no tunnel" answer.
    expect((await call(unregistered.port, "POST", "/x")).status).toBe(404);
    // With the agent connected, the offline rule does nothing.
    const online = await startTunnel(rules);
    expect((await call(online.port, "GET", "/")).body).toBe("from the app");
  });
});
