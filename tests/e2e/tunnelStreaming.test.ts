import { describe, it, expect, vi } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpTunnelHandler } from "../../apps/hub/src/handlers/HttpTunnel.handler";
import { PendingRegistry } from "../../apps/hub/src/registry/Pending.registry";
import { isStreamingResponse } from "../../packages/agent/src/proxy/BackendProxy";

// 2026-09-25 (code-archive CA-0036): the tunnel buffered every response, so
// Server-Sent Events, NDJSON and chunked responses reached the caller only
// when complete (an endless stream never did), and a caller that went away
// left the backend request running. Agents that announce "stream"/"cancel"
// now get acceptStream and tunnel:cancel; older agents are unaffected.

function harness(capabilities?: string[]) {
  const sent: any[] = [];
  const redis = { set: vi.fn(async () => "OK"), del: vi.fn(async () => 1) };
  const pending = new PendingRegistry(redis as any);
  const agent = {
    agentId: "agt_1",
    keyId: "key_1",
    capabilities,
    ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
  };
  const handler = new HttpTunnelHandler(
    { resolve: async () => ({ agentId: "agt_1", accountId: "acct_1", label: "default", accountSlug: "acme", hubInstanceId: "h" }), unregister: async () => {} } as any,
    { findByAgentId: () => agent } as any,
    pending as any,
    "vhyxvoid.com",
  );
  const server = createServer((q, r) => void handler.handle(q, r));
  return { sent, pending, server };
}

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as AddressInfo).port;
}

const waitFor = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
};

describe("hub: streaming and cancel", () => {
  it("an agent without capabilities gets a plain forward (no acceptStream)", async () => {
    const h = harness(undefined);
    const port = await listen(h.server);
    const req = httpRequest({ host: "127.0.0.1", port, path: "/x", headers: { host: "acme--default.vhyxvoid.com" } });
    req.on("error", () => {});
    req.end();
    await waitFor(() => h.sent.length > 0);
    expect(h.sent[0].type).toBe("tunnel:forward");
    expect(h.sent[0].acceptStream).toBeUndefined();
    req.destroy();
    h.server.close();
  });

  it("a streaming agent's chunks reach the caller as they arrive, then the response ends", async () => {
    const h = harness(["stream", "cancel"]);
    const port = await listen(h.server);
    const got: string[] = [];
    let ended = false;
    let status = 0;
    const req = httpRequest({ host: "127.0.0.1", port, path: "/sse", headers: { host: "acme--default.vhyxvoid.com" } }, (res) => {
      status = res.statusCode!;
      res.on("data", (c) => got.push(c.toString()));
      res.on("end", () => (ended = true));
    });
    req.end();
    await waitFor(() => h.sent.length > 0);
    const fwd = h.sent[0];
    expect(fwd.acceptStream).toBe(true);
    h.pending.streamStart(fwd.requestId, 200, { "content-type": "text/event-stream" });
    h.pending.streamChunk(fwd.requestId, Buffer.from("data: 1\n\n"));
    await waitFor(() => got.length === 1);
    expect(got).toEqual(["data: 1\n\n"]); // delivered before the stream ended
    h.pending.streamChunk(fwd.requestId, Buffer.from("data: 2\n\n"));
    h.pending.streamEnd(fwd.requestId);
    await waitFor(() => ended);
    expect(status).toBe(200);
    expect(got.join("")).toBe("data: 1\n\ndata: 2\n\n");
    h.server.close();
  });

  it("a caller that disconnects sends tunnel:cancel to an agent that supports it", async () => {
    const h = harness(["stream", "cancel"]);
    const port = await listen(h.server);
    const req = httpRequest({ host: "127.0.0.1", port, path: "/slow", headers: { host: "acme--default.vhyxvoid.com" } });
    req.on("error", () => {});
    req.end();
    await waitFor(() => h.sent.length > 0);
    const requestId = h.sent[0].requestId;
    req.destroy();
    await waitFor(() => h.sent.some((m) => m.type === "tunnel:cancel"));
    expect(h.sent.find((m) => m.type === "tunnel:cancel")).toEqual({ v: "1", type: "tunnel:cancel", requestId });
    expect(h.pending.size()).toBe(0);
    h.server.close();
  });

  it("no tunnel:cancel is sent to an agent that didn't announce it", async () => {
    const h = harness(["stream"]);
    const port = await listen(h.server);
    const req = httpRequest({ host: "127.0.0.1", port, path: "/slow", headers: { host: "acme--default.vhyxvoid.com" } });
    req.on("error", () => {});
    req.end();
    await waitFor(() => h.sent.length > 0);
    req.destroy();
    await new Promise((r) => setTimeout(r, 100));
    expect(h.sent.some((m) => m.type === "tunnel:cancel")).toBe(false);
    h.server.close();
  });
});

describe("agent: which responses stream", () => {
  it.each([
    [{ "content-type": "text/event-stream" }, true],
    [{ "content-type": "application/x-ndjson" }, true],
    [{ "transfer-encoding": "chunked" }, true],
    [{ "transfer-encoding": "chunked", "content-length": "10" }, false],
    [{ "content-type": "application/json", "content-length": "10" }, false],
  ])("%o -> %s", (headers, expected) => {
    expect(isStreamingResponse(headers)).toBe(expected);
  });
});
