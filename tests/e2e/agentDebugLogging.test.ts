import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { AgentClient } from "../../packages/agent/src/AgentClient";

// Regression for the 2026-09-19 finding that the published agent printed
// internal "[agent] ..." / "[batcher] ..." lines (marked `// ← ADD` in the
// source) for every message, including one per request, on every user's
// terminal. Those are now opt-in via VHYXVOID_DEBUG_LOGGING=true, mirroring
// the hub's HUB_DEBUG_LOGGING (apps/hub/src/utils/debug.ts). The user-facing
// banner is not debug output and must still print.

const servers: WebSocketServer[] = [];
const agents: AgentClient[] = [];
const saved = process.env.VHYXVOID_DEBUG_LOGGING;

beforeEach(() => {
  delete process.env.VHYXVOID_DEBUG_LOGGING;
});

afterEach(async () => {
  for (const a of agents.splice(0)) a.stop();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  if (saved === undefined) delete process.env.VHYXVOID_DEBUG_LOGGING;
  else process.env.VHYXVOID_DEBUG_LOGGING = saved;
  vi.restoreAllMocks();
});

/** Connects an agent to a stand-in hub that registers it and pings it once. */
async function runSession(): Promise<string[]> {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  vi.spyOn(console, "info").mockImplementation(() => {});

  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  servers.push(wss);
  await new Promise<void>((r) => wss.once("listening", r));

  const pongSeen = new Promise<void>((resolve) => {
    wss.on("connection", (ws) =>
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "agent:register") {
          ws.send(JSON.stringify({ v: "1", type: "hub:registered", agentId: "agt_1", accountId: "acc", replayPending: false, tunnelUrl: "https://acme--t.vhyxvoid.com" }));
          setTimeout(() => ws.send(JSON.stringify({ v: "1", type: "hub:ping", ts: Date.now() })), 20);
        }
        if (msg.type === "agent:pong" || msg.type === "agent:batch") resolve();
      }),
    );
  });

  const agent = new AgentClient({
    hubUrl: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    keyId: "k",
    secret: "s",
    label: "t",
    port: 1,
    localDiscovery: false,
    disableQueue: true,
  });
  agents.push(agent);
  agent.start();
  await pongSeen;

  return lines;
}

describe("agent debug logging", () => {
  it("prints the user-facing banner but none of the internal debug lines by default", async () => {
    const lines = await runSession();

    expect(lines.join("\n")).toContain("Tunnel active");
    expect(lines.join("\n")).toContain("https://acme--t.vhyxvoid.com");
    expect(lines.filter((l) => /^\[(agent|batcher|proxy)\]/.test(l))).toEqual([]);
  });

  it("prints the debug lines when VHYXVOID_DEBUG_LOGGING=true", async () => {
    process.env.VHYXVOID_DEBUG_LOGGING = "true";
    const lines = await runSession();

    expect(lines.some((l) => l.startsWith("[agent] WS OPEN"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[agent] PING received"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[batcher]"))).toBe(true);
  });

  it("only treats the exact value 'true' as on, like HUB_DEBUG_LOGGING", async () => {
    process.env.VHYXVOID_DEBUG_LOGGING = "1";
    const lines = await runSession();

    expect(lines.filter((l) => /^\[(agent|batcher|proxy)\]/.test(l))).toEqual([]);
  });

  it("never prints the secret, even with debug logging on", async () => {
    process.env.VHYXVOID_DEBUG_LOGGING = "true";
    const lines = await runSession();

    expect(lines.join("\n")).not.toContain("secret");
  });
});
