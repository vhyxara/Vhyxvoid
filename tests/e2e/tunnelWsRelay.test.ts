// ─────────────────────────────────────────────────────────────────────────────
// tests/e2e/tunnelWsRelay.test.ts
// WebSocket relay through tunnel subdomains — Phase 1 of the hardening plan in
// internal-tools/shared/ws-tunnel-design.md (defects D1, D2, D3-info-leak, D5,
// D7, D10).
//
// The rig runs REAL code on every hop except the two network legs:
//   browser (ws client) → hub HttpTunnelHandler.handleWebSocket (real)
//     → hub MessageRouter + AgentRegistry (real)
//     → agent AgentClient (real, driven through its own onMessage/onClose)
//       → BackendProxy + MessageBatcher (real, owned by that AgentClient)
//         → local backend (a real ws server)
// The agent<->hub link is an in-process function call in each direction (the
// AgentClient's private `ws`/`state` are set directly instead of dialing a hub,
// since a real dial needs the full register/auth handshake).
// Driving the real AgentClient (not a copy of its wiring) is deliberate: the
// D2 fix lives inside AgentClient, and a mirrored copy would pass regardless.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, afterEach } from "vitest";
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { HttpTunnelHandler } from "../../apps/hub/src/handlers/HttpTunnel.handler";
import { MessageRouter } from "../../apps/hub/src/router/Message.router";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { AgentClient } from "../../packages/agent/src/AgentClient";
import { serialize } from "../../packages/protocol/src";
import { makeAgentSession } from "./testHelpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(10);
  }
  return cond();
}

interface Rig {
  hubPort: number;
  backendConns: WebSocket[];
  /** connectionId of the first tunnel:ws:open the hub sent to the owning agent */
  openedConnectionId(): string | undefined;
  router: MessageRouter;
  ownerHubWs: any; // hub-side socket of the agent that owns the tunnel
  attackerHubWs: any; // hub-side socket of a different, legitimately registered agent
  agent: AgentClient;
  killBackend(): Promise<void>;
  close(): Promise<void>;
}

async function makeRig(onBackendConn?: (ws: WebSocket) => void): Promise<Rig> {
  // ── local backend (real ws server) ──
  const backendConns: WebSocket[] = [];
  const backendHttp = createServer();
  const backendWss = new WebSocketServer({ server: backendHttp });
  backendWss.on("connection", (ws) => {
    backendConns.push(ws);
    onBackendConn?.(ws);
  });
  await new Promise<void>((r) => backendHttp.listen(0, "127.0.0.1", r));
  const backendPort = (backendHttp.address() as AddressInfo).port;

  // ── hub side ──
  const sentToOwner: string[] = [];
  const agentRegistry = new AgentRegistry();
  let agent!: AgentClient;
  let router!: MessageRouter;

  const ownerHubWs = {
    readyState: 1,
    close() {},
    // hub → agent: deliver into the real AgentClient's message handler
    send(raw: string) {
      sentToOwner.push(raw);
      queueMicrotask(() => (agent as any).onMessage(Buffer.from(raw)));
    },
  };
  const attackerHubWs = { readyState: 1, send() {}, close() {} };

  agentRegistry.register(
    makeAgentSession({ agentId: "agt_owner", accountId: "acct_1", label: "app", ws: ownerHubWs }),
  );
  agentRegistry.register(
    makeAgentSession({ agentId: "agt_other", accountId: "acct_2", label: "other", ws: attackerHubWs }),
  );

  const handler = new HttpTunnelHandler(
    {
      resolve: async () => ({ agentId: "agt_owner", accountId: "acct_1" }),
      unregister: async () => {},
    } as any,
    agentRegistry,
    {} as any,
    "vhyxvoid.com",
  );
  router = new MessageRouter(
    agentRegistry,
    {} as any,
    { rejectAllForAgent: () => 0 } as any,
    { authenticateAgent: async () => ({ accountId: "acct_1", keyId: "key_1" }) } as any,
    {} as any,
    {} as any,
    {} as any,
    {
      markDisconnected: async () => {},
      findAccountSlug: async () => "acme",
      findApiKeyByPublicId: async () => ({ id: "key_1", accountId: "acct_1" }),
      upsert: async () => {},
    } as any,
    {} as any,
    "hub_1",
    { unregister: async () => {}, register: async () => {} } as any,
    "vhyxvoid.com",
    handler,
  );

  // ── agent side: the real AgentClient, wired to the hub in-process ──
  agent = new AgentClient({
    hubUrl: "ws://127.0.0.1:1/agent", // never dialed — see header comment
    keyId: "k",
    secret: "s",
    label: "app",
    port: backendPort,
    disableQueue: true,
    localDiscovery: false,
    logger: { info() {}, warn() {}, error() {} },
  });
  (agent as any).ws = {
    readyState: WebSocket.OPEN,
    // agent → hub
    send: (data: string) => void router.routeAgentMessage(ownerHubWs, Buffer.from(data), "127.0.0.1"),
    close() {},
  };
  (agent as any).state = "CONNECTED";

  // ── hub http server: only the upgrade path matters ──
  const hub: Server = createServer();
  hub.on("upgrade", (req, socket, head) => {
    handler.handleWebSocket(req, socket as any, head).catch(() => {
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      socket.destroy();
    });
  });
  await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
  const hubPort = (hub.address() as AddressInfo).port;

  return {
    hubPort,
    backendConns,
    openedConnectionId: () => {
      for (const raw of sentToOwner) {
        const m = JSON.parse(raw);
        if (m.type === "tunnel:ws:open") return m.connectionId as string;
      }
      return undefined;
    },
    router,
    ownerHubWs,
    attackerHubWs,
    agent,
    killBackend: async () => {
      backendWss.close();
      backendHttp.closeAllConnections();
      await new Promise<void>((r) => backendHttp.close(() => r()));
    },
    close: async () => {
      // Cancel a reconnect timer a test may have started via onClose() so the
      // AgentClient never dials the placeholder hubUrl.
      const t = (agent as any).reconnectTimer;
      if (t) clearTimeout(t);
      agent.stop();
      hub.closeAllConnections();
      hub.close();
      backendWss.close();
      backendHttp.closeAllConnections();
      backendHttp.close();
    },
  };
}

interface Browser {
  ws: WebSocket;
  events: string[]; // ordered: "msg:<text>" | "close:<code>"
  messages: string[];
  closed(): boolean;
  closeReason(): string;
}

function connectBrowser(rig: Rig): Browser {
  const ws = new WebSocket(`ws://127.0.0.1:${rig.hubPort}/socket`, {
    headers: { host: "acme--app.vhyxvoid.com", origin: "https://acme--app.vhyxvoid.com" },
  });
  const b: Browser = {
    ws,
    events: [],
    messages: [],
    closed: () => closed,
    closeReason: () => reason,
  };
  let closed = false;
  let reason = "";
  ws.on("message", (d) => {
    b.events.push(`msg:${d.toString()}`);
    b.messages.push(d.toString());
  });
  ws.on("close", (code, r) => {
    closed = true;
    reason = r.toString();
    b.events.push(`close:${code}`);
  });
  ws.on("error", () => {});
  return b;
}

const opened = (b: Browser) => new Promise<void>((r) => b.ws.on("open", () => r()));

let rig: Rig | undefined;
afterEach(async () => {
  await rig?.close();
  rig = undefined;
});

describe("tunnel WS relay — baseline (must keep passing)", () => {
  it("relays a single echo round-trip end to end", async () => {
    rig = await makeRig((ws) => ws.on("message", (d) => ws.send(d.toString())));
    const b = connectBrowser(rig);
    await opened(b);
    await waitFor(() => rig!.backendConns.length === 1);
    await sleep(100); // backend leg needs a beat to reach OPEN (101 precedes it — Phase 2)
    b.ws.send("hello");
    expect(await waitFor(() => b.messages.length === 1)).toBe(true);
    expect(b.messages).toEqual(["hello"]);
  });

  it("closing the browser socket closes the backend socket", async () => {
    rig = await makeRig();
    const b = connectBrowser(rig);
    await opened(b);
    await waitFor(() => rig!.backendConns.length === 1);
    b.ws.close(1000, "bye");
    expect(await waitFor(() => rig!.backendConns[0].readyState === WebSocket.CLOSED)).toBe(true);
  });
});

describe("D1 — frames inside an agent:batch are not dropped", () => {
  it("delivers a burst of 5 frames sent immediately, in order", async () => {
    rig = await makeRig((ws) => {
      for (let i = 0; i < 5; i++) ws.send(`m${i}`);
    });
    const b = connectBrowser(rig);
    await waitFor(() => b.messages.length >= 5);
    expect(b.messages).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });

  it("delivers two back-to-back frames (same 50 ms window)", async () => {
    rig = await makeRig((ws) => {
      setTimeout(() => {
        ws.send("first");
        ws.send("second");
      }, 150);
    });
    const b = connectBrowser(rig);
    await waitFor(() => b.messages.length >= 2);
    expect(b.messages).toEqual(["first", "second"]);
  });
});

describe("D2 — close never overtakes frames sent before it", () => {
  it("delivers the last frame before the close", async () => {
    rig = await makeRig((ws) => {
      setTimeout(() => {
        ws.send("last");
        ws.close(1000, "done");
      }, 150);
    });
    const b = connectBrowser(rig);
    await waitFor(() => b.closed());
    expect(b.events).toEqual(["msg:last", "close:1000"]);
  });
});

describe("D5 — an agent-link drop cleans up WS state on both ends", () => {
  it("hub: onAgentClose closes the browser socket with 1012", async () => {
    rig = await makeRig((ws) => ws.on("message", (d) => ws.send(d.toString())));
    const b = connectBrowser(rig);
    await opened(b);
    await waitFor(() => rig!.backendConns.length === 1);
    await rig.router.onAgentClose(rig.ownerHubWs);
    expect(await waitFor(() => b.closed())).toBe(true);
    expect(b.events).toContain("close:1012");
  });

  it("agent: AgentClient.onClose closes the backend socket", async () => {
    rig = await makeRig();
    const b = connectBrowser(rig);
    await opened(b);
    await waitFor(() => rig!.backendConns.length === 1);
    await sleep(100);
    (rig.agent as any).onClose(1006, "link lost");
    expect(await waitFor(() => rig!.backendConns[0].readyState === WebSocket.CLOSED)).toBe(true);
  });

  it("only the dropped agent's tunnels are closed", async () => {
    rig = await makeRig();
    const b = connectBrowser(rig);
    await opened(b);
    await waitFor(() => rig!.backendConns.length === 1);
    await rig.router.onAgentClose(rig.attackerHubWs); // a different agent disconnects
    await sleep(200);
    expect(b.closed()).toBe(false);
  });
});

describe("D7 — abnormal / code-less closes still close the browser socket", () => {
  it("backend closes without a status code (ws reports 1005)", async () => {
    rig = await makeRig((ws) => setTimeout(() => ws.close(), 150));
    const b = connectBrowser(rig);
    expect(await waitFor(() => b.closed())).toBe(true);
    expect(b.events.at(-1)).toBe("close:1000");
  });

  it("backend dies abnormally (ws reports 1006)", async () => {
    rig = await makeRig((ws) => setTimeout(() => ws.terminate(), 150));
    const b = connectBrowser(rig);
    expect(await waitFor(() => b.closed())).toBe(true);
  });

  it("agent reports close codes 1005/1006/1015 directly to the hub", async () => {
    for (const code of [1005, 1006, 1015]) {
      rig = await makeRig();
      const b = connectBrowser(rig);
      await opened(b);
      await waitFor(() => rig!.openedConnectionId() !== undefined);
      await rig.router.routeAgentMessage(
        rig.ownerHubWs,
        Buffer.from(
          serialize({
            v: "1",
            type: "tunnel:ws:close",
            connectionId: rig.openedConnectionId()!,
            code,
            reason: "x",
          } as any),
        ),
        "127.0.0.1",
      );
      expect(await waitFor(() => b.closed()), `code ${code}`).toBe(true);
      await rig.close();
      rig = undefined;
    }
  });
});

describe("D10 — tunnel:ws:* is only accepted from the connection's owning agent", () => {
  async function connected() {
    rig = await makeRig((ws) => ws.on("message", (d) => ws.send(d.toString())));
    const b = connectBrowser(rig);
    await opened(b);
    await waitFor(() => rig!.openedConnectionId() !== undefined);
    await sleep(100);
    return { b, id: rig.openedConnectionId()! };
  }

  it("another agent cannot inject frames into the browser socket", async () => {
    const { b, id } = await connected();
    await rig!.router.routeAgentMessage(
      rig!.attackerHubWs,
      Buffer.from(serialize({ v: "1", type: "tunnel:ws:message", connectionId: id, data: "evil", isBinary: false } as any)),
      "127.0.0.1",
    );
    await sleep(150);
    expect(b.messages).not.toContain("evil");
  });

  it("another agent cannot close the browser socket", async () => {
    const { b, id } = await connected();
    await rig!.router.routeAgentMessage(
      rig!.attackerHubWs,
      Buffer.from(serialize({ v: "1", type: "tunnel:ws:close", connectionId: id, code: 1000, reason: "evil" } as any)),
      "127.0.0.1",
    );
    await rig!.router.routeAgentMessage(
      rig!.attackerHubWs,
      Buffer.from(serialize({ v: "1", type: "tunnel:ws:error", connectionId: id, message: "evil" } as any)),
      "127.0.0.1",
    );
    await sleep(150);
    expect(b.closed()).toBe(false);
  });

  it("the owning agent still works after a rejected attempt", async () => {
    const { b, id } = await connected();
    await rig!.router.routeAgentMessage(
      rig!.attackerHubWs,
      Buffer.from(serialize({ v: "1", type: "tunnel:ws:message", connectionId: id, data: "evil", isBinary: false } as any)),
      "127.0.0.1",
    );
    b.ws.send("legit");
    expect(await waitFor(() => b.messages.includes("legit"))).toBe(true);
  });
});

describe("D3 (information leak only) — backend connection errors are not shown to the browser", () => {
  it("an unreachable backend closes the browser socket with a generic reason", async () => {
    rig = await makeRig();
    await rig.killBackend();
    const b = connectBrowser(rig);
    expect(await waitFor(() => b.closed())).toBe(true);
    const reason = b.closeReason();
    expect(reason).not.toMatch(/ECONNREFUSED/i);
    expect(reason).not.toMatch(/127\.0\.0\.1/);
    expect(reason).not.toMatch(/\d{4,5}/); // no local port number
    expect(b.events.at(-1)).toBe("close:1011");
  });
});

describe("D5 — a same-label re-registration closes the replaced agent's tunnels", () => {
  it("closes the browser socket when a new agent registers the same label", async () => {
    rig = await makeRig((ws) => ws.on("message", (d) => ws.send(d.toString())));
    const b = connectBrowser(rig);
    await opened(b);
    await waitFor(() => rig!.backendConns.length === 1);

    // A new connection registers acct_1/app. AgentRegistry.register evicts the old
    // session and closes its socket, whose close event then finds no session — so
    // onAgentClose never runs for it; the register path has to do the cleanup.
    const newHubWs = { readyState: 1, send() {}, close() {} };
    await rig.router.routeAgentMessage(
      newHubWs,
      Buffer.from(
        serialize({
          v: "1",
          type: "agent:register",
          keyId: "key_1",
          label: "app",
          rawSecret: "x",
          agentVersion: "1.0.0",
        } as any),
      ),
      "127.0.0.1",
    );
    expect(await waitFor(() => b.closed())).toBe(true);
    expect(b.events).toContain("close:1012");
  });
});
