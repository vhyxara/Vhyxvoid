import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { TunnelClient } from "../../packages/sdk/src/TunnelClient";
import { LocalAgentClient } from "../../packages/sdk/src/LocalAgentClient";
import { createClient } from "../../packages/sdk/src/client";
import { startFakeBackendServer, FakeBackendServer } from "./testHelpers";

// Covers context.md risk #21's first explicitly-flagged follow-up: the SDK
// client didn't decode bodyEncoding on the sdk:response path, so a binary
// response via the WS/hub route (as opposed to the already-fixed raw HTTP
// tunnel path) was still corrupted even though the field now propagates
// correctly through the hub. See decision.md, 2026-09-13, "SDK response
// decoding" for the full investigation (which path actually needs it, and
// why LocalAgentClient/client.ts needed a related-but-different fix too).

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JSON_BODY = JSON.stringify({ hello: "world" });

// ── TunnelClient (WS/hub path) ──────────────────────────────────────────────
// A real ws.WebSocketServer standing in for the hub — same "real fixture,
// not a mock" convention as startFakeBackendServer (isomorphic-ws/ws isn't
// reliably interceptable with vi.mock across pnpm's per-package layout,
// same rationale recorded for axios in testHelpers.ts).

function startFakeHub(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "sdk:register") {
          ws.send(JSON.stringify({ v: "1", type: "sdk:registered", sessionId: "sess_1" }));
          return;
        }
        if (msg.type === "sdk:request") {
          if (msg.path === "/image") {
            ws.send(
              JSON.stringify({
                v: "1",
                type: "sdk:response",
                requestId: msg.requestId,
                status: 200,
                headers: { "content-type": "image/png" },
                body: PNG_BYTES.toString("base64"),
                bodyEncoding: "base64",
                durationMs: 1,
              }),
            );
          } else if (msg.path === "/json") {
            ws.send(
              JSON.stringify({
                v: "1",
                type: "sdk:response",
                requestId: msg.requestId,
                status: 200,
                headers: { "content-type": "application/json" },
                body: JSON_BODY,
                bodyEncoding: "utf8",
                durationMs: 1,
              }),
            );
          }
        }
      });
    });
    wss.on("listening", () => {
      const port = (wss.address() as AddressInfo).port;
      resolve({ port, close: () => new Promise((r) => wss.close(() => r())) });
    });
  });
}

describe("TunnelClient — sdk:response bodyEncoding decoding", () => {
  let hub: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    hub = await startFakeHub();
  });
  afterAll(() => hub.close());

  it("decodes a base64 binary response into a real Buffer, byte-for-byte", async () => {
    const client = new TunnelClient({
      hubUrl: `ws://127.0.0.1:${hub.port}`,
      keyId: "key_1",
      secret: "s".repeat(32),
      localDiscovery: false, // exercise the hub-routed path directly, not local discovery
    });
    await client.connect();

    const res = await client.get("/image");
    client.disconnect();

    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).equals(PNG_BYTES)).toBe(true);
  });

  it("keeps a bodyEncoding: 'utf8' response as a plain string, unchanged", async () => {
    const client = new TunnelClient({
      hubUrl: `ws://127.0.0.1:${hub.port}`,
      keyId: "key_1",
      secret: "s".repeat(32),
      localDiscovery: false,
    });
    await client.connect();

    const res = await client.get("/json");
    client.disconnect();

    expect(typeof res.body).toBe("string");
    expect(res.body).toBe(JSON_BODY);
  });
});

// ── LocalAgentClient (local-discovery fast path, still part of
// TunnelClient's request() flow) — connects directly to a real local HTTP
// server, never sees a bodyEncoding field, so must detect binary itself
// via content-type. Same underlying corruption bug, different mechanism. ──

describe("LocalAgentClient — direct local backend response, binary detection", () => {
  let backend: FakeBackendServer;

  beforeAll(async () => {
    backend = await startFakeBackendServer((req, res) => {
      if (req.url === "/image") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG_BYTES);
      } else if (req.url === "/json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON_BODY);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  afterAll(() => backend.close());

  // LocalAgentClient discovers the local agent via a fixed port (4242) —
  // reach into its private httpRequest via tryRequest is not possible
  // without a real discovery server, so exercise the same logic directly
  // through the class's actual code path by overriding discover() is not
  // exposed either. Instead, test through the one method that is public
  // and does reach httpRequest: construct the class and call the private
  // method is avoided — httpRequest is exercised indirectly by pointing
  // discovery's cached port at our fake backend.
  it("returns a real Buffer for a binary response, not a corrupted string", async () => {
    const client = new LocalAgentClient();
    // Seed the discovery cache directly (same shape discover() would
    // produce) so tryRequest() skips the network discovery call — this is
    // instance-private state, accessed the same way agentRegistry.test.ts
    // and others reach into constructed instances for test setup.
    (client as any).cachedAgent = { port: backend.port, expiresAt: Date.now() + 60_000 };

    const res = await client.tryRequest({
      method: "GET",
      path: "/image",
      query: "",
      headers: {},
      body: null,
    });

    expect(res).not.toBeNull();
    expect(Buffer.isBuffer(res!.body)).toBe(true);
    expect((res!.body as Buffer).equals(PNG_BYTES)).toBe(true);
  });

  it("keeps a JSON response as a plain utf8 string", async () => {
    const client = new LocalAgentClient();
    (client as any).cachedAgent = { port: backend.port, expiresAt: Date.now() + 60_000 };

    const res = await client.tryRequest({
      method: "GET",
      path: "/json",
      query: "",
      headers: {},
      body: null,
    });

    expect(typeof res!.body).toBe("string");
    expect(res!.body).toBe(JSON_BODY);
  });
});

// ── client.ts / VhyxvoidClient (HTTP/subdomain path, the SDK's primary
// surface) — talks directly to a real HTTP server via fetch(). Doesn't use
// bodyEncoding (confirmed not relevant to this path — see decision.md) but
// had its own real binary-corruption bug via res.text(). ──

describe("VhyxvoidClient (client.ts) — binary response via fetch", () => {
  let backend: FakeBackendServer;

  beforeAll(async () => {
    backend = await startFakeBackendServer((req, res) => {
      if (req.url === "/image") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(PNG_BYTES);
      } else if (req.url === "/json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON_BODY);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  afterAll(() => backend.close());

  it("returns a real Buffer for a binary response instead of a corrupted UTF-8 string", async () => {
    const api = createClient({ baseUrl: `http://127.0.0.1:${backend.port}` });
    const { data } = await api.get<Buffer>("/image");

    expect(Buffer.isBuffer(data)).toBe(true);
    expect((data as Buffer).equals(PNG_BYTES)).toBe(true);
  });

  it("still parses a JSON response as a real object", async () => {
    const api = createClient({ baseUrl: `http://127.0.0.1:${backend.port}` });
    const { data } = await api.get<{ hello: string }>("/json");

    expect(data).toEqual({ hello: "world" });
  });
});
