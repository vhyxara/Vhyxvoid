import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DurableQueue } from "../../packages/agent/src/queue/DurableQueue";
import { replayQueue } from "../../packages/agent/src/replay/replayQueue";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";
import type { TunnelForwardMsg, TunnelResponseMsg } from "../../packages/protocol/src/messages";
import { startFakeBackendServer, FakeBackendServer } from "./testHelpers";

// REPLACED 2026-09-12 (broken-test-repair session). The original file
// imported clearQueue/readQueueLength/pushToDurableQueue/replayQueue (a
// no-arg version) from apps/agent/src/utils/queue — wrong path entirely
// (packages/agent, not apps/agent) and a flat free-function API that
// doesn't exist anymore. The current design splits this into DurableQueue
// (a real SQLite-backed class, enqueueInbound/enqueueOutbound/
// drainForReplay/markSuccess/markFailed/count) and a standalone
// replayQueue(queue, send, proxy) function that drains outbound items
// first, then inbound. There's no like-for-like REPAIR possible — this
// rebuilds the same real behavior ("stores, then replays when the backend
// is reachable") against both directions the current code actually has,
// which the original test never distinguished. See context.md risk #38 and
// decision.md, 2026-09-12, "Broken e2e test suite repair".
//
// Uses a real in-memory SQLite DB (":memory:", better-sqlite3 supports it
// directly — no temp file) and, for the inbound-replay case, a real local
// HTTP server (shared testHelpers.startFakeBackendServer) rather than
// mocking axios, matching the Hub audit session's established approach.

function forwardMsg(overrides: Partial<TunnelForwardMsg> = {}): TunnelForwardMsg {
  return {
    v: "1",
    type: "tunnel:forward",
    requestId: "req_1",
    method: "GET",
    path: "/demo",
    query: "",
    headers: {},
    body: null,
    timeoutMs: 5000,
    ...overrides,
  };
}

function responseMsg(overrides: Partial<TunnelResponseMsg> = {}): TunnelResponseMsg {
  return {
    v: "1",
    type: "tunnel:response",
    requestId: "req_1",
    status: 200,
    headers: {},
    body: null,
    durationMs: 1,
    ...overrides,
  };
}

describe("replayQueue — outbound", () => {
  let queue: DurableQueue;

  beforeEach(() => {
    queue = new DurableQueue(":memory:");
  });

  afterEach(() => {
    queue.close();
  });

  it("stores an outbound item and replays (sends) it, then drains the queue", async () => {
    queue.enqueueOutbound(responseMsg());
    expect(queue.count().ready).toBe(1);

    const send = vi.fn();
    const proxy = new BackendProxy(0); // unused for outbound-only replay

    const result = await replayQueue(queue, send, proxy);

    expect(result).toEqual({ succeeded: 1, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.count()).toEqual({ ready: 0, pending: 0, deadLetter: 0 });

    proxy.stop();
  });

  it("does nothing when the queue is empty", async () => {
    const send = vi.fn();
    const proxy = new BackendProxy(0);

    const result = await replayQueue(queue, send, proxy);

    expect(result).toEqual({ succeeded: 0, failed: 0, skipped: 0 });
    expect(send).not.toHaveBeenCalled();

    proxy.stop();
  });
});

describe("replayQueue — inbound", () => {
  let queue: DurableQueue;
  let backend: FakeBackendServer;

  beforeEach(() => {
    queue = new DurableQueue(":memory:");
  });

  afterEach(async () => {
    queue.close();
    if (backend) await backend.close();
  });

  it("re-forwards a queued inbound request to a now-reachable backend and replays the response", async () => {
    backend = await startFakeBackendServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    queue.enqueueInbound(forwardMsg());
    expect(queue.count().ready).toBe(1);

    const send = vi.fn();
    const proxy = new BackendProxy(backend.port);

    const result = await replayQueue(queue, send, proxy);

    expect(result).toEqual({ succeeded: 1, failed: 0, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);

    const sent = JSON.parse(send.mock.calls[0][0]);
    expect(sent.type).toBe("tunnel:response");
    expect(sent.status).toBe(200);
    expect(sent.requestId).toBe("req_1");
    expect(queue.count()).toEqual({ ready: 0, pending: 0, deadLetter: 0 });

    proxy.stop();
  });

  it("marks an item failed (with backoff, not dead-lettered on the first attempt) when the backend is unreachable", async () => {
    // Nothing listening on this port — axios/BackendProxy will throw.
    const deadPort = 1; // reserved/unroutable port, connection will be refused
    queue.enqueueInbound(forwardMsg());

    const send = vi.fn();
    const proxy = new BackendProxy(deadPort);

    const result = await replayQueue(queue, send, proxy);

    expect(result).toEqual({ succeeded: 0, failed: 1, skipped: 0 });
    expect(send).not.toHaveBeenCalled();
    // First failure: backoff-scheduled (pending), not ready, not dead-lettered yet.
    const counts = queue.count();
    expect(counts.ready).toBe(0);
    expect(counts.pending).toBe(1);
    expect(counts.deadLetter).toBe(0);

    proxy.stop();
  }, 15000);
});
