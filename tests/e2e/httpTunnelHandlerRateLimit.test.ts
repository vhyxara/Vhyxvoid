import { describe, it, expect, vi } from "vitest";
import { createServer, request as httpRequest, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpTunnelHandler } from "../../apps/hub/src/handlers/HttpTunnel.handler";

// Covers shared/decision.md, 2026-09-22, "S5 investigation and proposal",
// Part 2.2: the public tunnel-URL path's 429 response shape (extends the
// existing sendError envelope with Retry-After + retryAfterSeconds), and
// that the limiter is checked before an agent lookup so a flood aimed at a
// URL with no agent connected is still capped.

function makeHandler(opts: {
  allowed: boolean;
  limitPerMinute?: number;
  retryAfterSeconds?: number;
  withAgent?: boolean;
}) {
  const withAgent = opts.withAgent ?? true;
  const forwarded: any[] = [];

  const subdomainRegistry = {
    resolve: async () => ({
      agentId: "agt_1",
      accountId: "acct_1",
      label: "default",
      accountSlug: "acme",
      hubInstanceId: "hub_1",
    }),
    unregister: async () => {},
  };
  const agentRegistry = {
    findByAgentId: () =>
      withAgent
        ? {
            agentId: "agt_1",
            keyId: "key_1",
            ws: { send: (raw: string) => forwarded.push(JSON.parse(raw)), readyState: 1 },
          }
        : undefined,
  };
  const pendingRegistry = {
    enqueue: async (req: { requestId: string; resolve: (r: any) => void }) => {
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
  };
  const checkRequest = vi.fn(async () => ({
    allowed: opts.allowed,
    limitPerMinute: opts.limitPerMinute ?? 100,
    retryAfterSeconds: opts.retryAfterSeconds ?? 0,
  }));
  const usageLimiter = { checkRequest } as any;

  const handler = new HttpTunnelHandler(
    subdomainRegistry as any,
    agentRegistry as any,
    pendingRegistry as any,
    "vhyxvoid.com",
    undefined,
    usageLimiter,
  );

  return { handler, forwarded, checkRequest };
}

async function startHandlerServer(handler: HttpTunnelHandler): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    handler.handle(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

function get(port: number): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/hello", method: "GET", headers: { host: "acme--default.vhyxvoid.com" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode!, headers: res.headers, body: raw ? JSON.parse(raw) : null });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("HttpTunnelHandler — public-path rate limiting", () => {
  it("returns 429 with Retry-After and retryAfterSeconds when the limiter refuses", async () => {
    const { handler, forwarded } = makeHandler({
      allowed: false,
      limitPerMinute: 100,
      retryAfterSeconds: 37,
    });
    const server = await startHandlerServer(handler);

    const res = await get(server.port);
    await server.close();

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("37");
    expect(res.body).toMatchObject({
      status: 429,
      tunnel: true,
      retryAfterSeconds: 37,
    });
    expect(res.body.error).toContain("100 requests/min");
    // The refused request never reached the agent.
    expect(forwarded).toHaveLength(0);
  });

  it("forwards normally when the limiter allows the request", async () => {
    const { handler, forwarded } = makeHandler({ allowed: true });
    const server = await startHandlerServer(handler);

    const res = await get(server.port);
    await server.close();

    expect(res.status).toBe(200);
    expect(forwarded).toHaveLength(1);
  });

  it("checks the limiter even when no agent is connected (a flood on a dead URL is still capped)", async () => {
    const { handler, checkRequest } = makeHandler({ allowed: false, withAgent: false });
    const server = await startHandlerServer(handler);

    const res = await get(server.port);
    await server.close();

    expect(checkRequest).toHaveBeenCalledWith("acct_1");
    expect(res.status).toBe(429); // rate-limited before the agent lookup's own 503 would fire
  });

  it("with no usageLimiter configured (test-only default), the request proceeds unlimited", async () => {
    const subdomainRegistry = {
      resolve: async () => ({ agentId: "agt_1", accountId: "acct_1", label: "default", accountSlug: "acme", hubInstanceId: "hub_1" }),
    };
    const forwarded: any[] = [];
    const agentRegistry = {
      findByAgentId: () => ({
        agentId: "agt_1",
        keyId: "key_1",
        ws: { send: (raw: string) => forwarded.push(JSON.parse(raw)), readyState: 1 },
      }),
    };
    const pendingRegistry = {
      enqueue: async (req: { requestId: string; resolve: (r: any) => void }) => {
        req.resolve({ v: "1", type: "tunnel:response", requestId: req.requestId, status: 200, headers: {}, body: null, durationMs: 1 });
      },
    };
    const handler = new HttpTunnelHandler(
      subdomainRegistry as any,
      agentRegistry as any,
      pendingRegistry as any,
      "vhyxvoid.com",
    );
    const server = await startHandlerServer(handler);

    const res = await get(server.port);
    await server.close();

    expect(res.status).toBe(200);
    expect(forwarded).toHaveLength(1);
  });
});
