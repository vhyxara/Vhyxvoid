import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { AgentClient } from "../../packages/agent/src/AgentClient";
import { AGENT_VERSION } from "../../packages/agent/src/version";
import agentPackage from "../../packages/agent/package.json";

// Regression for the 2026-09-19 finding that the published
// @vhyxvoid/agent@1.0.18 told the hub (and printed) "1.0.16". The version used
// to be inlined into each bundle from a package.json that a stale bundle kept
// re-bundling, and the in-process wrappers each had their own copy of the
// lookup with a hard-coded "1.0.0" fallback. There is now one AGENT_VERSION,
// read from the agent's own package.json, and callers no longer pass a version
// in unless they mean to.

const servers: WebSocketServer[] = [];
const agents: AgentClient[] = [];

afterEach(async () => {
  for (const a of agents.splice(0)) a.stop();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

async function registerMessageFrom(config: Record<string, unknown>): Promise<{ agentVersion?: string }> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  servers.push(wss);
  await new Promise<void>((r) => wss.once("listening", r));
  const port = (wss.address() as AddressInfo).port;

  const received = new Promise<{ agentVersion?: string }>((resolve) => {
    wss.on("connection", (ws) =>
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "agent:register") resolve(msg);
      }),
    );
  });

  const agent = new AgentClient({
    hubUrl: `ws://127.0.0.1:${port}`,
    keyId: "k",
    secret: "s",
    label: "t",
    port: 1,
    localDiscovery: false,
    disableQueue: true,
    ...config,
  });
  agents.push(agent);
  agent.start();

  return received;
}

describe("agent version", () => {
  it("AGENT_VERSION is this package's package.json version", () => {
    expect(AGENT_VERSION).toBe(agentPackage.version);
    expect(AGENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("registers with the hub using AGENT_VERSION when the caller does not pass one", async () => {
    const msg = await registerMessageFrom({});

    expect(msg.agentVersion).toBe(agentPackage.version);
  });

  it("still lets a caller report a different version on purpose", async () => {
    const msg = await registerMessageFrom({ agentVersion: "9.9.9" });

    expect(msg.agentVersion).toBe("9.9.9");
  });
});
