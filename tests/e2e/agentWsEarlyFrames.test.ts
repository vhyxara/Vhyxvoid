import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";

// Found by the 2026-09-25 end-to-end run (code-archive CA-0031): the hub
// answers the browser's WebSocket upgrade before the agent's socket to the
// local backend is open, so a frame the browser sent right after `open`
// (chat hello, GraphQL connection_init, subscription) reached the agent while
// that socket was CONNECTING and was silently dropped.
const WebSocket = createRequire(require.resolve("../../packages/agent/package.json"))("ws");

async function backend() {
  const server = createServer();
  const got: string[] = [];
  const wss = new WebSocket.WebSocketServer({ server });
  wss.on("connection", (ws: any) => ws.on("message", (m: Buffer, bin: boolean) => got.push(bin ? `bin:${m.toString("hex")}` : m.toString())));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { port: (server.address() as any).port, got, close: () => new Promise<void>((r) => { wss.close(); server.close(() => r()); }) };
}

describe("BackendProxy WebSocket: frames sent before the backend socket opens", () => {
  it("are delivered in order once it opens", async () => {
    const b = await backend();
    const proxy = new BackendProxy(b.port);
    proxy.openWebSocket("c1", "/", "", {}, () => {}, () => {}, () => {});
    // Immediately, while CONNECTING:
    proxy.sendWebSocketMessage("c1", "first", false);
    proxy.sendWebSocketMessage("c1", Buffer.from([1, 2]).toString("base64"), true);
    proxy.sendWebSocketMessage("c1", "third", false);
    const t0 = Date.now();
    while (b.got.length < 3 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
    proxy.stop();
    await b.close();
    expect(b.got).toEqual(["first", "bin:0102", "third"]);
  });

  it("fails the connection instead of buffering without bound", async () => {
    const b = await backend();
    const proxy = new BackendProxy(b.port);
    let closed = false;
    proxy.openWebSocket("c2", "/", "", {}, () => {}, () => (closed = true), () => (closed = true));
    const big = "x".repeat(1024 * 1024);
    for (let i = 0; i < 6; i++) proxy.sendWebSocketMessage("c2", big, false); // > 4 MB while CONNECTING
    const t0 = Date.now();
    while (!closed && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
    proxy.stop();
    await b.close();
    expect(closed).toBe(true);
    expect(b.got).toHaveLength(0);
  });
});
