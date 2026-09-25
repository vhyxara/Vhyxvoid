import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import WebSocket from "ws";
import { AgentClient } from "../../packages/agent/src/AgentClient";
import { DurableQueue } from "../../packages/agent/src/queue/DurableQueue";
import { replayQueue } from "../../packages/agent/src/replay/replayQueue";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";

// Audit part2 G3 (shared/audit-2026-09-24-part2.md): while the hub link was
// down the agent wrote every tunnel:response (full backend response bodies:
// session tokens, PII) unencrypted to ~/.vhyxvoid/queue.db, where they stayed
// until the next successful connect, or forever. Responses are now held in
// memory only (bounded by count, bytes and the hub's pending window) and sent
// after re-registering; nothing reaches disk, and rows left by older agents
// are purged when the queue opens.

const tmpDirs: string[] = [];
const clients: AgentClient[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const c of clients.splice(0)) c.stop();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpQueuePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vhyx-g3-"));
  tmpDirs.push(dir);
  return path.join(dir, "queue.db");
}

function response(requestId: string, body = '{"session":"secret-token-abc"}'): any {
  return {
    v: "1",
    type: "tunnel:response",
    requestId,
    status: 200,
    headers: { "content-type": "application/json" },
    body,
    bodyEncoding: "utf8",
    durationMs: 3,
  };
}

function makeAgent(opts: { queuePath?: string; disableQueue?: boolean }) {
  const agent = new AgentClient({
    hubUrl: "ws://127.0.0.1:1/agent",
    keyId: "k",
    secret: "s",
    label: "app",
    port: 1,
    localDiscovery: false,
    queuePath: opts.queuePath,
    disableQueue: opts.disableQueue,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  clients.push(agent);
  const a = agent as any;
  const sent: any[] = [];
  const goDown = () => {
    a.state = "RECONNECTING";
  };
  const produceResponse = (msg: any) => {
    a.batcher.add(msg);
    a.batcher.flush();
  };
  const reRegister = async () => {
    a.ws = { readyState: WebSocket.OPEN, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => {} };
    await a.onRegistered({ v: "1", type: "hub:registered", agentId: "agt_2", accountId: "acct", replayPending: false });
    a.batcher.flush();
  };
  const sentResponseIds = () =>
    sent.flatMap((m) => (m.type === "agent:batch" ? m.messages : [m])).filter((m) => m.type === "tunnel:response").map((m) => m.requestId);
  return { agent: a, goDown, produceResponse, reRegister, sentResponseIds };
}

describe("responses produced while the hub link is down", () => {
  it("are not written to the durable queue on disk", () => {
    const queuePath = tmpQueuePath();
    const { agent, goDown, produceResponse } = makeAgent({ queuePath });

    goDown();
    produceResponse(response("req_disk"));

    expect(agent.queue.count().ready + agent.queue.count().pending).toBe(0);
    const raw = fs.readFileSync(queuePath).toString("latin1");
    expect(raw).not.toContain("secret-token-abc");
  });

  it("are delivered from memory once the agent re-registers", async () => {
    const { goDown, produceResponse, reRegister, sentResponseIds } = makeAgent({ queuePath: tmpQueuePath() });

    goDown();
    produceResponse(response("req_held"));
    await reRegister();

    expect(sentResponseIds()).toEqual(["req_held"]);
  });

  it("are also delivered by in-process agents (disableQueue), which used to drop them", async () => {
    const { goDown, produceResponse, reRegister, sentResponseIds } = makeAgent({ disableQueue: true });

    goDown();
    produceResponse(response("req_inproc"));
    await reRegister();

    expect(sentResponseIds()).toEqual(["req_inproc"]);
  });

  it("are dropped once older than the hub's pending window (nothing could match them)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { goDown, produceResponse, reRegister, sentResponseIds } = makeAgent({ disableQueue: true });

    goDown();
    produceResponse(response("req_stale"));
    vi.setSystemTime(Date.now() + 121_000);
    produceResponse(response("req_fresh"));
    await reRegister();

    expect(sentResponseIds()).toEqual(["req_fresh"]);
  });

  it("are bounded: the oldest are dropped beyond the in-memory cap", async () => {
    const { goDown, produceResponse, reRegister, sentResponseIds } = makeAgent({ disableQueue: true });

    goDown();
    for (let i = 0; i < 105; i++) produceResponse(response(`req_${i}`, "x"));
    await reRegister();

    const ids = sentResponseIds();
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe("req_5");
    expect(ids[99]).toBe("req_104");
  });
});

describe("outbound rows left by older agents", () => {
  it("are purged when the queue opens; inbound rows are kept", () => {
    const queuePath = tmpQueuePath();
    const q1 = new DurableQueue(queuePath);
    q1.enqueueInbound({ v: "1", type: "tunnel:forward", requestId: "in_1", method: "GET", path: "/", query: "", headers: {}, body: null } as any);
    // What an older agent wrote: a response body in the queue and in dead_letter.
    const db = (q1 as any).db;
    db.prepare(
      "INSERT INTO queue (id, direction, payload, ts, attempts, max_attempts, next_retry_at) VALUES ('out_1','outbound',?,0,0,10,0)",
    ).run(JSON.stringify(response("old_req")));
    db.prepare(
      "INSERT INTO dead_letter (id, direction, payload, ts, attempts, failed_at) VALUES ('out_2','outbound',?,0,10,0)",
    ).run(JSON.stringify(response("older_req")));
    q1.close();

    const q2 = new DurableQueue(queuePath);
    const items = q2.drainForReplay();
    expect(items.map((i) => i.id)).toEqual([expect.any(String)]);
    expect(items[0].direction).toBe("inbound");
    expect(q2.count().deadLetter).toBe(0);
    q2.close();
  });

  it("are never sent by replayQueue even if one is handed to it", async () => {
    const markSuccess = vi.fn();
    const send = vi.fn();
    const queue = {
      drainForReplay: () => [
        { id: "o1", direction: "outbound", payload: JSON.stringify(response("old")), ts: 0, attempts: 0, maxAttempts: 10, nextRetryAt: 0 },
      ],
      markSuccess,
      markFailed: vi.fn(),
      count: () => ({ ready: 0, pending: 0, deadLetter: 0 }),
    };
    const proxy = new BackendProxy(1);

    const result = await replayQueue(queue as any, send, proxy);
    proxy.stop();

    expect(send).not.toHaveBeenCalled();
    expect(markSuccess).toHaveBeenCalledWith("o1"); // deleted, not retried
    expect(result.skipped).toBe(1);
  });
});
