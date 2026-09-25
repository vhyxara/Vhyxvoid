import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { AgentClient } from "../../packages/agent/src/AgentClient";
import { TIMING } from "../../packages/protocol/src/constants";

// shared backlog, 2026-09-21: agent 1.0.19 retried once a second forever on a
// wrong secret (INVALID_SIGNATURE), a key without tunnel:connect
// (SCOPE_MISSING), a revoked/expired key and AGENT_LIMIT_REACHED: onHubError
// stopped only on AUTH_FAILED/VERSION_UNSUPPORTED, and the reconnect delay
// reset on every TCP open, even when auth was then refused.

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function hubThatRefuses(code: string) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  let connections = 0;
  wss.on("connection", (ws) => {
    connections++;
    ws.once("message", () => {
      ws.send(JSON.stringify({ v: "1", type: "hub:error", code, message: `refused: ${code}`, fatal: true }));
      ws.close();
    });
  });
  cleanups.push(() => wss.close());
  const port = (wss.address() as { port: number }).port;
  return { url: `ws://127.0.0.1:${port}/agent`, connections: () => connections };
}

function makeAgent(hubUrl: string) {
  const agent = new AgentClient({
    hubUrl,
    keyId: "k",
    secret: "s",
    label: "app",
    port: 1,
    localDiscovery: false,
    disableQueue: true,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  cleanups.push(() => agent.stop());
  return agent;
}

const waitFor = async (cond: () => boolean, ms = 3_000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("agent: fatal hub errors", () => {
  for (const code of ["INVALID_SIGNATURE", "SCOPE_MISSING", "KEY_REVOKED", "KEY_EXPIRED", "AUTH_FAILED"]) {
    it(`stops (no reconnect) on ${code}`, async () => {
      const origError = console.error;
      console.error = () => {};
      cleanups.push(() => (console.error = origError));
      const hub = await hubThatRefuses(code);
      const agent = makeAgent(hub.url);
      agent.start();

      await waitFor(() => agent.getState() === "STOPPED");
      await new Promise((r) => setTimeout(r, 1_200)); // past the 1 s initial retry
      expect(hub.connections()).toBe(1);
    });
  }

  it("keeps retrying on AGENT_LIMIT_REACHED, with growing backoff instead of 1 s each time", async () => {
    const hub = await hubThatRefuses("AGENT_LIMIT_REACHED");
    const agent = makeAgent(hub.url);
    agent.start();

    await waitFor(() => hub.connections() >= 2);
    expect(agent.getState()).not.toBe("STOPPED");
    // Two rejected attempts: the next delay has doubled twice, not reset.
    await waitFor(() => (agent as any).reconnectDelay >= TIMING.RECONNECT_INITIAL_MS * 4);
  });

  it("resets the backoff only after hub:registered", async () => {
    const agent = makeAgent("ws://127.0.0.1:1/agent") as any;
    agent.reconnectDelay = 16_000;
    agent.onOpen = agent.onOpen.bind(agent);
    agent.ws = { readyState: 1, send: () => {}, close: () => {} };
    agent.onOpen();
    expect(agent.reconnectDelay).toBe(16_000);
    await agent.onRegistered({ v: "1", type: "hub:registered", agentId: "agt", accountId: "acct", replayPending: false });
    expect(agent.reconnectDelay).toBe(TIMING.RECONNECT_INITIAL_MS);
  });
});
