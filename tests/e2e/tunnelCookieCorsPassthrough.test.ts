import { describe, it, expect, afterEach } from "vitest";
import { createServer, request as httpRequest, Server, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpTunnelHandler } from "../../apps/hub/src/handlers/HttpTunnel.handler";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";

// Covers claude-output.md / internal-tools/shared/audit-2026-09-24.md C3 and
// C4 (shared/context.md Known Risk #60): the hub used to rewrite every
// Set-Cookie to `Domain=.<hubDomain>; SameSite=None; Secure` (so one tenant's
// cookies reached every other tenant's tunnel), answer every OPTIONS itself
// with the caller's Origin + Allow-Credentials, and replace the backend's own
// CORS headers with a reflected Origin + credentials on every response. The
// short-term mitigation passes the backend's own Set-Cookie and CORS headers
// through unmodified and forwards preflights to the backend.
//
// Each test drives the real HttpTunnelHandler, with its tunnel:forward
// delivered to the real agent BackendProxy, which talks to a real local
// backend over HTTP. Only the registries are faked.

type BackendHandler = (req: IncomingMessage, res: ServerResponse) => void;

const servers: Server[] = [];
const proxies: BackendProxy[] = [];

afterEach(async () => {
  for (const p of proxies.splice(0)) p.stop();
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});

async function listen(handler: BackendHandler): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/** A hub HTTP server whose single agent forwards through a real BackendProxy. */
async function startTunnel(backend: BackendHandler): Promise<{ port: number; forwardedMethods: string[] }> {
  const backendPort = await listen(backend);
  const proxy = new BackendProxy(backendPort);
  proxies.push(proxy);
  const forwardedMethods: string[] = [];

  const pending = new Map<string, (r: any) => void>();
  const agentWs = {
    readyState: 1,
    send: (raw: string) => {
      const msg = JSON.parse(raw);
      forwardedMethods.push(msg.method);
      proxy.forward(msg).then((result) => {
        pending.get(msg.requestId)?.({
          v: "1",
          type: "tunnel:response",
          requestId: msg.requestId,
          ...result,
        });
      });
    },
  };

  const handler = new HttpTunnelHandler(
    {
      resolve: async () => ({
        agentId: "agt_1",
        accountId: "acct_1",
        label: "app",
        accountSlug: "acme",
        hubInstanceId: "hub_1",
      }),
      unregister: async () => {},
    } as any,
    { findByAgentId: () => ({ agentId: "agt_1", keyId: "key_1", ws: agentWs }) } as any,
    {
      enqueue: async (req: { requestId: string; resolve: (r: any) => void }) => {
        pending.set(req.requestId, req.resolve);
      },
      reject: () => false,
    } as any,
    "vhyxvoid.com",
  );

  const port = await listen((req, res) => {
    handler.handle(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
  return { port, forwardedMethods };
}

function call(
  port: number,
  method: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/api/session",
        method,
        headers: { host: "acme--app.vhyxvoid.com", ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("tunnel Set-Cookie passthrough (C3)", () => {
  it("delivers the backend's Set-Cookie headers byte-for-byte, with no Domain/SameSite/Secure added", async () => {
    const cookies = [
      "sid=abc123; Path=/; HttpOnly; SameSite=Lax",
      "__Host-csrf=xyz; Path=/; Secure; SameSite=Strict",
      "theme=dark; Path=/; Max-Age=3600",
    ];
    const { port } = await startTunnel((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": cookies });
      res.end('{"ok":true}');
    });

    const res = await call(port, "GET");

    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toEqual(cookies);
    expect(res.body).toBe('{"ok":true}');
  });

  it("keeps a backend-set Domain attribute as the backend wrote it", async () => {
    const cookie = "pref=1; Domain=acme--app.vhyxvoid.com; Path=/";
    const { port } = await startTunnel((_req, res) => {
      res.writeHead(200, { "set-cookie": [cookie] });
      res.end();
    });

    const res = await call(port, "GET");

    expect(res.headers["set-cookie"]).toEqual([cookie]);
  });
});

describe("tunnel CORS passthrough (C4)", () => {
  // A backend with a strict CORS policy: only https://app.example.com, with
  // credentials, and it answers its own preflights.
  const strictBackend: BackendHandler = (req, res) => {
    const origin = req.headers.origin;
    const allowed = origin === "https://app.example.com";
    const cors: Record<string, string> = allowed
      ? {
          "access-control-allow-origin": origin!,
          "access-control-allow-credentials": "true",
          vary: "Origin",
        }
      : { vary: "Origin" };
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...cors,
        ...(allowed
          ? {
              "access-control-allow-methods": "GET, POST",
              "access-control-allow-headers": "content-type",
              "access-control-max-age": "600",
            }
          : {}),
      });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json", ...cors });
    res.end('{"me":"alice"}');
  };

  it("forwards a preflight to the backend and returns the backend's answer", async () => {
    const { port, forwardedMethods } = await startTunnel(strictBackend);

    const res = await call(port, "OPTIONS", {
      origin: "https://app.example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    });

    expect(forwardedMethods).toEqual(["OPTIONS"]);
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-methods"]).toBe("GET, POST");
    expect(res.headers["access-control-allow-headers"]).toBe("content-type");
    expect(res.headers["access-control-max-age"]).toBe("600");
  });

  it("does not grant a preflight from an origin the backend refuses", async () => {
    const { port } = await startTunnel(strictBackend);

    const res = await call(port, "OPTIONS", {
      origin: "https://evil.example",
      "access-control-request-method": "POST",
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("does not reflect an arbitrary Origin with credentials on a normal response", async () => {
    const { port } = await startTunnel(strictBackend);

    const res = await call(port, "GET", { origin: "https://evil.example" });

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("passes the backend's own CORS and Vary headers through unmodified", async () => {
    const { port } = await startTunnel(strictBackend);

    const res = await call(port, "GET", { origin: "https://app.example.com" });

    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["vary"]).toBe("Origin");
  });

  it("adds no CORS headers at all when the backend sends none", async () => {
    const { port } = await startTunnel((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hi");
    });

    const res = await call(port, "GET", { origin: "https://anything.example" });

    const corsHeaders = Object.keys(res.headers).filter((h) => h.startsWith("access-control-"));
    expect(corsHeaders).toEqual([]);
  });
});
