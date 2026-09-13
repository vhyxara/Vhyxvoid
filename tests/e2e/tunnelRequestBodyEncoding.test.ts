import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, request as httpRequest, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpTunnelHandler } from "../../apps/hub/src/handlers/HttpTunnel.handler";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";
import type { TunnelForwardMsg, TunnelResponseMsg } from "../../packages/protocol/src/messages";
import { startFakeBackendServer, FakeBackendServer } from "./testHelpers";

// Covers context.md risk #21's second explicitly-flagged follow-up: the
// request direction has the mirrored bug — HttpTunnelHandler.readBody()
// unconditionally did .toString('utf8'), so a binary file uploaded through
// a tunneled subdomain would be corrupted before it ever reached
// TunnelForwardMsg.body. See decision.md, 2026-09-13, "Request-direction
// body corruption" for the full investigation and fix (both the hub's
// encode side and BackendProxy's decode side).

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JSON_BODY = JSON.stringify({ hello: "world" });

// ── HttpTunnelHandler.handle() — encode side ────────────────────────────────
// Fake registries: subdomainRegistry/agentRegistry resolve to a fixed
// "agent", and pendingRegistry immediately resolves the pending request
// (standing in for a real agent's tunnel:response, which never arrives in
// this test) so handle() completes. This captures the TunnelForwardMsg
// exactly as it would be sent over the agent's real WebSocket, via the
// fake ws.send().

function makeHandler(onForward: (msg: TunnelForwardMsg) => void): HttpTunnelHandler {
  const subdomainRegistry = {
    resolve: async () => ({
      agentId: "agt_1",
      accountId: "acct_1",
      label: "default",
      accountSlug: "acme",
      hubInstanceId: "hub_1",
    }),
  };
  const agentRegistry = {
    findByAgentId: () => ({
      agentId: "agt_1",
      keyId: "key_1",
      ws: {
        send: (raw: string) => onForward(JSON.parse(raw) as TunnelForwardMsg),
        readyState: 1,
      },
    }),
  };
  const pendingRegistry = {
    enqueue: async (req: {
      requestId: string;
      resolve: (r: TunnelResponseMsg) => void;
    }) => {
      // Simulate an immediate agent response so handle() doesn't hang
      // waiting for the real 30s timeout.
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

  return new HttpTunnelHandler(
    subdomainRegistry as any,
    agentRegistry as any,
    pendingRegistry as any,
    "vhyxvoid.com",
  );
}

async function startHandlerServer(
  onForward: (msg: TunnelForwardMsg) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const handler = makeHandler(onForward);
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

function sendTunnelRequest(
  port: number,
  path: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          host: "acme--default.vhyxvoid.com",
          "content-type": contentType,
          "content-length": body.length,
        },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("HttpTunnelHandler.handle() — request bodyEncoding (encode side)", () => {
  it("base64-encodes a binary request body and sets bodyEncoding: 'base64'", async () => {
    let forwarded: TunnelForwardMsg | undefined;
    const server = await startHandlerServer((msg) => (forwarded = msg));

    await sendTunnelRequest(server.port, "/upload", PNG_BYTES, "image/png");
    await server.close();

    expect(forwarded).toBeDefined();
    expect(forwarded!.bodyEncoding).toBe("base64");
    expect(forwarded!.body).toBe(PNG_BYTES.toString("base64"));
    // Round-trip must reproduce the exact original bytes.
    expect(Buffer.from(forwarded!.body!, "base64").equals(PNG_BYTES)).toBe(true);
  });

  it("keeps a JSON request body as plain utf8 with bodyEncoding: 'utf8'", async () => {
    let forwarded: TunnelForwardMsg | undefined;
    const server = await startHandlerServer((msg) => (forwarded = msg));

    await sendTunnelRequest(server.port, "/api", Buffer.from(JSON_BODY, "utf8"), "application/json");
    await server.close();

    expect(forwarded!.bodyEncoding).toBe("utf8");
    expect(forwarded!.body).toBe(JSON_BODY);
  });

  it("leaves body null and bodyEncoding undefined for a bodyless GET", async () => {
    let forwarded: TunnelForwardMsg | undefined;
    const server = await startHandlerServer((msg) => (forwarded = msg));

    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: server.port,
          path: "/api",
          method: "GET",
          headers: { host: "acme--default.vhyxvoid.com" },
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();
    });
    await server.close();

    expect(forwarded!.body).toBeNull();
    expect(forwarded!.bodyEncoding).toBeUndefined();
  });
});

// ── BackendProxy.forward() — decode side ────────────────────────────────────
// Already covered for the response direction in backendProxyBodyEncoding.test.ts;
// this covers the request direction's mirror-image fix.

describe("BackendProxy.forward() — request bodyEncoding (decode side)", () => {
  let backend: FakeBackendServer;
  let receivedBody: Buffer | null = null;

  beforeAll(async () => {
    backend = await startFakeBackendServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks);
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      });
    });
  });
  afterAll(() => backend.close());

  it("decodes a base64 request body back to real bytes before sending to the local backend", async () => {
    const proxy = new BackendProxy(backend.port);
    const msg: TunnelForwardMsg = {
      v: "1",
      type: "tunnel:forward",
      requestId: "req_1",
      method: "POST",
      path: "/upload",
      query: "",
      headers: { "content-type": "image/png" },
      body: PNG_BYTES.toString("base64"),
      bodyEncoding: "base64",
      timeoutMs: 5000,
    };

    await proxy.forward(msg);
    proxy.stop();

    expect(receivedBody).not.toBeNull();
    expect(receivedBody!.equals(PNG_BYTES)).toBe(true);
  });

  it("sends a plain utf8 request body through unchanged (bodyEncoding: 'utf8')", async () => {
    const proxy = new BackendProxy(backend.port);
    const msg: TunnelForwardMsg = {
      v: "1",
      type: "tunnel:forward",
      requestId: "req_2",
      method: "POST",
      path: "/api",
      query: "",
      headers: { "content-type": "application/json" },
      body: JSON_BODY,
      bodyEncoding: "utf8",
      timeoutMs: 5000,
    };

    await proxy.forward(msg);
    proxy.stop();

    expect(receivedBody!.toString("utf8")).toBe(JSON_BODY);
  });

  it("treats a missing bodyEncoding as utf8, matching pre-fix behavior for an older hub", async () => {
    const proxy = new BackendProxy(backend.port);
    const msg: TunnelForwardMsg = {
      v: "1",
      type: "tunnel:forward",
      requestId: "req_3",
      method: "POST",
      path: "/api",
      query: "",
      headers: { "content-type": "application/json" },
      body: JSON_BODY,
      timeoutMs: 5000,
    };

    await proxy.forward(msg);
    proxy.stop();

    expect(receivedBody!.toString("utf8")).toBe(JSON_BODY);
  });
});

// ── Full round trip: hub encode → agent decode → real local backend ────────
// This is the actual end-to-end path the brief asked to verify: a binary
// payload sent as a tunneled request body arrives at the local backend
// byte-for-byte correct, not corrupted UTF-8. The WS hop between hub and
// agent is skipped (in-memory hand-off of the TunnelForwardMsg instead) —
// same simplification backendProxyBodyEncoding.test.ts already uses for
// the response direction, since both hub and agent already have their own
// direct unit coverage above.

describe("Full round trip — tunneled binary upload reaches the local backend intact", () => {
  it("byte-for-byte matches the original PNG after hub encode + agent decode", async () => {
    let forwarded: TunnelForwardMsg | undefined;
    const handlerServer = await startHandlerServer((msg) => (forwarded = msg));

    let receivedBody: Buffer | null = null;
    const backend = await startFakeBackendServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks);
        res.writeHead(200);
        res.end();
      });
    });

    await sendTunnelRequest(handlerServer.port, "/upload", PNG_BYTES, "image/png");
    await handlerServer.close();

    expect(forwarded).toBeDefined();

    const proxy = new BackendProxy(backend.port);
    await proxy.forward(forwarded!);
    proxy.stop();
    await backend.close();

    expect(receivedBody).not.toBeNull();
    expect(receivedBody!.equals(PNG_BYTES)).toBe(true);
  });
});
