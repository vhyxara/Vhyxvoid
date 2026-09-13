import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";
import type { TunnelForwardMsg } from "../../packages/protocol/src/messages";
import { startFakeBackendServer, FakeBackendServer } from "./testHelpers";

// Covers context.md risk #21: BackendProxy.forward() previously always did
// bodyBuffer.toString("utf8") regardless of content-type, silently
// corrupting any binary response (images, PDFs, etc.) before the hub's
// content-type-based decode on the way out ever saw valid bytes. See
// decision.md, 2026-09-12, "tunnel:forward / tunnel:response bodyEncoding".

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JSON_BODY = JSON.stringify({ hello: "world" });

let backend: FakeBackendServer;
let port: number;

beforeAll(async () => {
  backend = await startFakeBackendServer((req, res) => {
    if (req.url === "/image") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG_BYTES);
    } else if (req.url === "/json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON_BODY);
    } else if (req.url === "/empty") {
      res.writeHead(204, { "content-type": "image/png" });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  port = backend.port;
});

afterAll(() => backend.close());

function forwardMsg(path: string): TunnelForwardMsg {
  return {
    v: "1",
    type: "tunnel:forward",
    requestId: "req_1",
    method: "GET",
    path,
    query: "",
    headers: {},
    body: null,
    timeoutMs: 5000,
  };
}

describe("BackendProxy.forward — bodyEncoding", () => {
  it("base64-encodes a binary (image) response and sets bodyEncoding: 'base64'", async () => {
    const proxy = new BackendProxy(port);
    const result = await proxy.forward(forwardMsg("/image"));
    proxy.stop();

    expect(result.bodyEncoding).toBe("base64");
    expect(result.body).toBe(PNG_BYTES.toString("base64"));
    // Round-trip must reproduce the exact original bytes — this is the
    // actual corruption the bug caused (lossy utf8 decode is not reversible).
    expect(Buffer.from(result.body!, "base64").equals(PNG_BYTES)).toBe(true);
  });

  it("keeps a JSON response as plain utf8 with bodyEncoding: 'utf8'", async () => {
    const proxy = new BackendProxy(port);
    const result = await proxy.forward(forwardMsg("/json"));
    proxy.stop();

    expect(result.bodyEncoding).toBe("utf8");
    expect(result.body).toBe(JSON_BODY);
  });

  it("treats an empty body as null regardless of content-type", async () => {
    const proxy = new BackendProxy(port);
    const result = await proxy.forward(forwardMsg("/empty"));
    proxy.stop();

    expect(result.body).toBeNull();
  });
});
