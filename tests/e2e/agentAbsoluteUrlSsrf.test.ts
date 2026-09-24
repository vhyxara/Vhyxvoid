import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer, request as httpRequest, Server, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomUUID } from "crypto";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";
import { MessageRouter } from "../../apps/hub/src/router/Message.router";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { HubAuthService } from "../../apps/hub/src/services/HubAuth.service";
import { HttpTunnelHandler } from "../../apps/hub/src/handlers/HttpTunnel.handler";
import { buildValidateApiKeyUseCase } from "../../packages/shared/src/validateApiKey";
import { buildCanonical } from "../../packages/protocol/src/canonical";

// Covers internal-tools/shared/audit-2026-09-24.md H9: the agent built
// `baseURL + msg.path`, and axios ignores baseURL when the path is an
// absolute URL, so a tunnel:forward whose path was `http://169.254.169.254/…`
// (or any host) made the developer's machine fetch that host. The audit
// verified it with axios 1.13.2 by pointing the path at a second local
// server; these tests use the same method: a "metadata" server standing in
// for 169.254.169.254, which must never receive a request.

const servers: Server[] = [];
const proxies: BackendProxy[] = [];
afterEach(async () => {
  for (const p of proxies.splice(0)) p.stop();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function server(): Promise<{ port: number; hits: string[] }> {
  const hits: string[] = [];
  const s = createServer((req: IncomingMessage, res: ServerResponse) => {
    hits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return { port: (s.address() as AddressInfo).port, hits };
}

const forwardMsg = (path: string) =>
  ({ v: "1", type: "tunnel:forward", requestId: randomUUID(), method: "GET", path, query: "", headers: {}, body: null }) as any;

describe("agent: an absolute URL in path never leaves the developer's backend (H9)", () => {
  const absoluteForms = (p: number) => [
    `http://127.0.0.1:${p}/latest/meta-data/`,
    `HTTP://127.0.0.1:${p}/latest/meta-data/`,
    `//127.0.0.1:${p}/latest/meta-data/`,
    `/\\127.0.0.1:${p}/latest/meta-data/`,
  ];

  it("reaches no other host for any absolute-URL form, and refuses the request", async () => {
    const backend = await server();
    const metadata = await server();
    const proxy = new BackendProxy(backend.port);
    proxies.push(proxy);

    for (const path of absoluteForms(metadata.port)) {
      const res = await proxy.forward(forwardMsg(path));
      expect(res.status, path).toBe(400);
    }

    expect(metadata.hits).toEqual([]);
    expect(backend.hits).toEqual([]);
  });

  it("a normal path still reaches the backend", async () => {
    const backend = await server();
    const proxy = new BackendProxy(backend.port);
    proxies.push(proxy);

    const res = await proxy.forward(forwardMsg("/api/orders"));

    expect(res.status).toBe(200);
    expect(backend.hits).toEqual(["/api/orders"]);
  });
});

describe("hub: a non-origin-form path is refused before it reaches an agent", () => {
  it("sdk:request with an absolute-URL path gets sdk:error and nothing is forwarded", async () => {
    const SECRET = "secret-hash";
    const store = new Map<string, string>();
    const redis = {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string, o?: { nx?: boolean }) => {
        if (o?.nx && store.has(k)) return null;
        store.set(k, v);
        return "OK";
      }),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
    };
    const auth = new HubAuthService(
      buildValidateApiKeyUseCase({
        redis: redis as any,
        loadKey: vi.fn(async () => ({
          keyId: "key_1", secretHash: SECRET, previousSecretHash: null, rotationGraceEndsAt: null,
          status: "ACTIVE", accountId: "acct_1", accountStatus: "ACTIVE", scopes: ["tunnel:connect"],
          expiresAt: null, rateLimitPerMinute: -1,
        })),
      }),
      "pepper",
      async () => null,
    );
    const agents = new AgentRegistry();
    const forwarded: any[] = [];
    agents.register({
      agentId: "agt_1", accountId: "acct_1", keyId: "uuid_key_1", label: "default",
      ws: { send: (raw: string) => forwarded.push(JSON.parse(raw)), readyState: 1 },
      connectedAt: new Date(), lastSeenAt: new Date(), missedPings: 0, agentVersion: "1.0.0", ip: "127.0.0.1",
    } as any);
    const enqueued: string[] = [];
    const router = new MessageRouter(
      agents, {} as any, { enqueue: async (r: any) => void enqueued.push(r.requestId) } as any, auth,
      {} as any, { increment: vi.fn() } as any, {} as any, {} as any, { create: vi.fn(async () => {}) } as any,
      "hub_1", {} as any, "vhyxvoid.com", {} as any,
    );
    const sent: any[] = [];
    const ws = { send: (raw: string) => sent.push(JSON.parse(raw)) };

    const path = "http://169.254.169.254/latest/meta-data/";
    const requestId = randomUUID();
    const ts = Date.now();
    const signature = createHmac("sha256", SECRET)
      .update(buildCanonical({ method: "GET", path, query: "", body: "", requestId, ts }))
      .digest("hex");
    const msg = { v: "1", type: "sdk:request", keyId: "key_1", requestId, ts, signature, method: "GET", path, query: "", headers: {}, body: null };

    await router.routeSdkMessage(ws, Buffer.from(JSON.stringify(msg)), "127.0.0.1");

    expect(forwarded).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "sdk:error", requestId });
  });

  it("an absolute-form request line on the public tunnel path gets 400 and nothing is forwarded", async () => {
    const forwarded: any[] = [];
    const handler = new HttpTunnelHandler(
      { resolve: async () => ({ agentId: "agt_1", accountId: "acct_1", label: "app", accountSlug: "acme", hubInstanceId: "hub_1" }), unregister: async () => {} } as any,
      { findByAgentId: () => ({ agentId: "agt_1", keyId: "key_1", ws: { readyState: 1, send: (raw: string) => forwarded.push(raw) } }) } as any,
      { enqueue: async () => {}, reject: () => false } as any,
      "vhyxvoid.com",
    );
    const hub = createServer((req, res) => void handler.handle(req, res));
    servers.push(hub);
    await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
    const port = (hub.address() as AddressInfo).port;

    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        // absolute-form request target: "GET http://169.254.169.254/… HTTP/1.1"
        { host: "127.0.0.1", port, path: "http://169.254.169.254/latest/meta-data/", headers: { host: "acme--app.vhyxvoid.com" } },
        (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); },
      );
      req.on("error", reject);
      req.end();
    });

    expect(status).toBe(400);
    expect(forwarded).toEqual([]);
  });
});
