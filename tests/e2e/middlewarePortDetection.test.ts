import { describe, it, expect, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import { AgentClient } from "../../packages/agent/src/AgentClient";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";
import { vhyxvoid } from "../../packages/middleware/src/index";
import { vhyxvoidPlugin } from "../../packages/middleware/src/fastify";
import { getTunnelAgent, stopTunnel } from "../../packages/middleware/src/tunnel";
import { startFakeBackendServer } from "./testHelpers";

// Audit part2 G8: @vhyxvoid/middleware assumed port 3000 unless told
// otherwise, so an app on any other port got silent 502s. The agent now has
// setPort(), and the integrations adopt the app's real port (Express: first
// request's socket; Fastify: the listen address) when no port was set.

const requireFromMiddleware = createRequire(require.resolve("../../packages/middleware/package.json"));
const saved = { ...process.env };
afterEach(() => {
  stopTunnel();
  vi.restoreAllMocks();
  process.env = { ...saved };
});

function devEnv() {
  process.env.NODE_ENV = "development";
  delete process.env.CI;
  delete process.env.VHYXVOID_PORT;
  process.env.VHYXVOID_API_KEY = "vhyxvoid_dev_test";
  process.env.VHYXVOID_SECRET = "secret";
  process.env.VHYXVOID_HUB_URL = "ws://127.0.0.1:1/agent"; // unreachable; reconnect loop is fine
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
}

const tunnelPort = () => (getTunnelAgent() as any)?.getPort?.();

describe("AgentClient.setPort", () => {
  it("forwards to the new port without reconnecting", async () => {
    const a = await startFakeBackendServer((_q, r) => r.end("from-a"));
    const b = await startFakeBackendServer((_q, r) => r.end("from-b"));
    const proxy = new BackendProxy(a.port);
    const msg = { v: "1", type: "tunnel:forward", requestId: "r1", method: "GET", path: "/", query: "", headers: {}, body: null } as any;
    expect(String((await proxy.forward(msg)).body)).toContain("from-a");
    proxy.setPort(b.port);
    const res = await proxy.forward({ ...msg, requestId: "r2" });
    proxy.stop();
    await a.close();
    await b.close();
    expect(String(res.body)).toContain("from-b");
  });

  it("rejects an invalid port", () => {
    const agent = new AgentClient({ hubUrl: "ws://x", keyId: "k", secret: "s", label: "l", port: 3000, localDiscovery: false });
    expect(() => agent.setPort(0)).toThrow();
    expect(() => agent.setPort(70_000)).toThrow();
    agent.setPort(4000);
    expect(agent.getPort()).toBe(4000);
    agent.stop();
  });
});

describe("Express middleware adopts the app's real port", () => {
  it("switches from the 3000 default to the port of the first request", () => {
    devEnv();
    const mw = vhyxvoid();
    expect(tunnelPort()).toBe(3000);
    const next = vi.fn();
    mw({ socket: { localPort: 4321 } } as any, {} as any, next);
    expect(next).toHaveBeenCalled();
    expect(tunnelPort()).toBe(4321);
  });

  it("never overrides an explicit port", () => {
    devEnv();
    const mw = vhyxvoid({ port: 5000 });
    mw({ socket: { localPort: 4321 } } as any, {} as any, vi.fn());
    expect(tunnelPort()).toBe(5000);
  });
});

describe("Fastify plugin adopts the listen port", () => {
  it("uses the server's address once listening", async () => {
    devEnv();
    const Fastify = requireFromMiddleware("fastify");
    const app = Fastify();
    await app.register(vhyxvoidPlugin);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as any).port;
    expect(tunnelPort()).toBe(port);
    await app.close();
  });
});
