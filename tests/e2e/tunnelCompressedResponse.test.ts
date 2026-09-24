import { describe, it, expect, afterEach } from "vitest";
import { createServer, request as httpRequest, Server, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync, brotliCompressSync, deflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { HttpTunnelHandler } from "../../apps/hub/src/handlers/HttpTunnel.handler";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";

// Covers internal-tools/shared/audit-2026-09-24.md H5: the agent's axios
// (decompress: true) inflates a gzip/br/deflate body and deletes
// content-encoding, but keeps the backend's COMPRESSED content-length. The
// agent forwarded it, the hub set it on the real response, and the caller
// read only that many bytes of the (much longer) decompressed body.
//
// Same method as the audit's probe, end to end: a real backend compressing
// its response, the real agent BackendProxy, the real hub HttpTunnelHandler,
// and a real HTTP client that reads exactly what Content-Length says.

type BackendHandler = (req: IncomingMessage, res: ServerResponse) => void;

const servers: Server[] = [];
const proxies: BackendProxy[] = [];

afterEach(async () => {
  for (const p of proxies.splice(0)) p.stop();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function listen(handler: BackendHandler): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/**
 * A hub whose single agent answers tunnel:forward. By default through a
 * real BackendProxy; `rewrite` lets a test stand in for an older, already
 * published agent that still forwards the stale content-length.
 */
async function startTunnel(
  backend: BackendHandler,
  rewrite?: (result: any) => any,
): Promise<number> {
  const proxy = new BackendProxy(await listen(backend));
  proxies.push(proxy);
  const pending = new Map<string, (r: any) => void>();
  const agentWs = {
    readyState: 1,
    send: (raw: string) => {
      const msg = JSON.parse(raw);
      proxy.forward(msg).then((result) => {
        const out = rewrite ? rewrite(result) : result;
        pending.get(msg.requestId)?.({ v: "1", type: "tunnel:response", requestId: msg.requestId, ...out });
      });
    },
  };
  const handler = new HttpTunnelHandler(
    {
      resolve: async () => ({ agentId: "agt_1", accountId: "acct_1", label: "app", accountSlug: "acme", hubInstanceId: "hub_1" }),
      unregister: async () => {},
    } as any,
    { findByAgentId: () => ({ agentId: "agt_1", keyId: "key_1", ws: agentWs }) } as any,
    {
      enqueue: async (req: { requestId: string; resolve: (r: any) => void }) => void pending.set(req.requestId, req.resolve),
      reject: () => false,
    } as any,
    "vhyxvoid.com",
  );
  return listen((req, res) => {
    handler.handle(req, res).catch((err) => {
      res.writeHead(500);
      res.end(String(err));
    });
  });
}

function call(port: number, method = "GET"): Promise<{ status: number; headers: Record<string, any>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/page", method, headers: { host: "acme--app.vhyxvoid.com" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ~2.4 KB of compressible JSON, like the audit's probe (compressed: ~50 bytes).
const JSON_BODY = JSON.stringify({ items: Array.from({ length: 60 }, (_, i) => ({ id: i, name: "item-name-x" })) });

function compressedBackend(encoding: "gzip" | "br" | "deflate", body: Buffer, contentType: string): BackendHandler {
  const compressed =
    encoding === "gzip" ? gzipSync(body) : encoding === "br" ? brotliCompressSync(body) : deflateSync(body);
  return (_req, res) => {
    res.writeHead(200, {
      "content-type": contentType,
      "content-encoding": encoding,
      "content-length": String(compressed.length),
    });
    res.end(compressed);
  };
}

describe("compressed backend responses arrive whole through the tunnel (H5)", () => {
  for (const enc of ["gzip", "br", "deflate"] as const) {
    it(`${enc}: the full decompressed JSON body reaches the caller`, async () => {
      const port = await startTunnel(compressedBackend(enc, Buffer.from(JSON_BODY), "application/json"));

      const r = await call(port);

      expect(r.status).toBe(200);
      expect(r.body.toString("utf8")).toBe(JSON_BODY);
      expect(Number(r.headers["content-length"])).toBe(Buffer.byteLength(JSON_BODY));
      expect(r.headers["content-encoding"]).toBeUndefined();
    });
  }

  it("gzip binary: every byte of the decompressed body arrives", async () => {
    const bytes = Buffer.concat([randomBytes(1024), Buffer.alloc(8192, 7)]); // partly compressible
    const port = await startTunnel(compressedBackend("gzip", bytes, "application/octet-stream"));

    const r = await call(port);

    expect(r.body.equals(bytes)).toBe(true);
    expect(Number(r.headers["content-length"])).toBe(bytes.length);
  });

  it("an already-published agent that still forwards the stale length is corrected by the hub", async () => {
    const stale = String(gzipSync(Buffer.from(JSON_BODY)).length);
    const port = await startTunnel(
      compressedBackend("gzip", Buffer.from(JSON_BODY), "application/json"),
      (result) => ({ ...result, headers: { ...result.headers, "content-length": stale } }),
    );

    const r = await call(port);

    expect(r.body.toString("utf8")).toBe(JSON_BODY);
  });

  it("the agent itself reports the decompressed length", async () => {
    const proxy = new BackendProxy(
      await listen(compressedBackend("gzip", Buffer.from(JSON_BODY), "application/json")),
    );
    proxies.push(proxy);

    const result = await proxy.forward({ requestId: "r1", method: "GET", path: "/page", query: "", headers: {} } as any);

    expect(result.headers["content-length"]).toBe(String(Buffer.byteLength(JSON_BODY)));
    expect(result.headers["content-encoding"]).toBeUndefined();
  });

  it("an uncompressed response is unchanged", async () => {
    const port = await startTunnel((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-length": "5" });
      res.end("hello");
    });

    const r = await call(port);

    expect(r.body.toString()).toBe("hello");
    expect(r.headers["content-length"]).toBe("5");
  });
});
