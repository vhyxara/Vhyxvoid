import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { MessageBatcher } from "../../packages/agent/src/batcher/MessageBatcher";
import { parseMessage } from "../../packages/protocol/src/serializer";

// Audit part2 G4 (shared/audit-2026-09-24-part2.md): MessageBatcher flushed on
// count (100) or time (50 ms), never on size. Eleven 10 MB responses finished
// inside one 50 ms window became one ~150 MB agent:batch frame; the hub's
// WebSocketServer (maxPayload 100 MiB, HubServer.ts) closes the agent's
// connection with 1009 and every in-flight request is lost.

const HUB_MAX_PAYLOAD = 100 * 1024 * 1024; // same as HubServer.ts

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** A server with the hub's frame limit, and a connected client socket. */
async function hubLikeLink() {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1", maxPayload: HUB_MAX_PAYLOAD });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  const received: any[] = [];
  let serverClose: { code: number } | null = null;
  wss.on("connection", (sock) => {
    sock.on("message", (data) => {
      const msg = parseMessage(data as Buffer);
      if (msg.type === "agent:batch") received.push(...(msg as any).messages);
      else received.push(msg);
    });
    sock.on("close", (code) => (serverClose = { code }));
    sock.on("error", () => {});
  });
  const port = (wss.address() as AddressInfo).port;
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  const clientClose: { code: number | null } = { code: null };
  client.on("close", (code) => (clientClose.code = code));
  client.on("error", () => {});
  await new Promise<void>((r) => client.once("open", () => r()));
  cleanups.push(
    () => new Promise<void>((r) => wss.close(() => r())),
    () => client.terminate(),
  );
  return { client, received, clientClose, serverClosed: () => serverClose };
}

function response(requestId: string, bodyBytes: number): any {
  return {
    v: "1",
    type: "tunnel:response",
    requestId,
    status: 200,
    headers: { "content-type": "application/octet-stream" },
    body: "A".repeat(bodyBytes),
    bodyEncoding: "base64",
    durationMs: 1,
  };
}

async function settle(until: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!until() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
}

describe("MessageBatcher byte limit", () => {
  it("delivers eleven ~10 MB responses finished within one batch window without losing the connection", async () => {
    const link = await hubLikeLink();
    const batcher = new MessageBatcher(
      (data) => link.client.send(data),
      () => {},
      () => link.client.readyState === WebSocket.OPEN,
    );
    const TEN_MB_AS_BASE64 = Math.ceil((10 * 1024 * 1024) / 3) * 4;

    for (let i = 0; i < 11; i++) batcher.add(response(`big_${i}`, TEN_MB_AS_BASE64));
    await settle(() => link.received.length === 11 || link.clientClose.code !== null);

    expect(link.clientClose.code).toBeNull(); // not closed with 1009
    expect(link.received.map((m) => m.requestId)).toEqual(
      Array.from({ length: 11 }, (_, i) => `big_${i}`),
    );
  }, 60_000);

  it("keeps every batched frame at or under about 1 MB and preserves order", async () => {
    const frames: string[] = [];
    const batcher = new MessageBatcher(
      (data) => frames.push(data),
      () => {},
      () => true,
    );

    for (let i = 0; i < 40; i++) batcher.add(response(`mid_${i}`, 100 * 1024)); // ~100 KB each
    batcher.flush();

    expect(frames.length).toBeGreaterThan(1);
    for (const f of frames) expect(Buffer.byteLength(f)).toBeLessThanOrEqual(1024 * 1024 + 150 * 1024);
    const ids = frames.flatMap((f) => {
      const m = JSON.parse(f);
      return m.type === "agent:batch" ? m.messages.map((x: any) => x.requestId) : [m.requestId];
    });
    expect(ids).toEqual(Array.from({ length: 40 }, (_, i) => `mid_${i}`));
  });

  it("sends a single response over the byte limit on its own, after anything already buffered", () => {
    const frames: any[] = [];
    const batcher = new MessageBatcher(
      (data) => frames.push(JSON.parse(data)),
      () => {},
      () => true,
    );

    batcher.add(response("small_1", 10));
    batcher.add(response("huge", 2 * 1024 * 1024));
    batcher.add(response("small_2", 10));
    batcher.flush();

    expect(frames.map((f) => (f.type === "agent:batch" ? f.messages.map((m: any) => m.requestId) : f.requestId))).toEqual([
      "small_1",
      "huge",
      "small_2",
    ]);
    expect(frames[1].type).toBe("tunnel:response"); // un-batched
  });

  it("still batches small messages together", () => {
    const frames: any[] = [];
    const batcher = new MessageBatcher(
      (data) => frames.push(JSON.parse(data)),
      () => {},
      () => true,
    );

    for (let i = 0; i < 5; i++) batcher.add(response(`s_${i}`, 50));
    batcher.flush();

    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe("agent:batch");
    expect(frames[0].messages).toHaveLength(5);
  });
});
