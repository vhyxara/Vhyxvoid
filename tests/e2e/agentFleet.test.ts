// Agent fleet: version comparison and status, health, the console's minimum
// agent version enforced by the real hub MessageRouter, and its setting checks.
import { afterEach, describe, expect, it } from "vitest";

import { agentHealth, agentVersionStatus, compareVersions, minimumVersionProblem } from "../../packages/shared/src/agentFleet";
import { SettingsReader, installSettingsReader, validateSettingValue } from "../../packages/shared/src/settings";
import { MessageRouter } from "../../apps/hub/src/router/Message.router";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { TunnelSessionRepository } from "../../apps/hub/src/repositories/TunnelSession.repository";

describe("versions", () => {
  it("compares numerically, with pre-releases below their release", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBe(-1);
    expect(compareVersions("v2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("abc", "1.0.0")).toBeNull();
  });

  it("status against the recommended and minimum versions", () => {
    expect(agentVersionStatus("1.1.0", "1.1.0", "")).toBe("current");
    expect(agentVersionStatus("1.0.20", "1.1.0", "")).toBe("outdated");
    expect(agentVersionStatus("0.9.0", "1.1.0", "1.0.0")).toBe("unsupported");
    expect(agentVersionStatus(undefined, "1.1.0", "")).toBe("unknown");
    expect(agentVersionStatus("1.0.0", "", "")).toBe("current");
  });

  it("health from pings", () => {
    const now = Date.now();
    expect(agentHealth(new Date(now - 5_000), 0, now)).toBe("healthy");
    expect(agentHealth(new Date(now - 5_000), 1, now)).toBe("lagging");
    expect(agentHealth(new Date(now - 60_000), 0, now)).toBe("unresponsive");
  });

  it("the minimum check names the update command; empty minimum allows everything", () => {
    expect(minimumVersionProblem("1.0.0", "")).toBeNull();
    expect(minimumVersionProblem("1.2.0", "1.1.0")).toBeNull();
    expect(minimumVersionProblem("1.0.5", "1.1.0")).toMatch(/older than 1\.1\.0.*npm i -D @vhyxvoid\/agent@latest/);
    expect(minimumVersionProblem(undefined, "1.1.0")).toMatch(/does not report a version/);
  });

  it("console settings only accept versions", () => {
    expect(validateSettingValue("tunnels.minimumAgentVersion", "1.2.0")).toEqual({ ok: true, value: "1.2.0" });
    expect(validateSettingValue("tunnels.minimumAgentVersion", "")).toEqual({ ok: true, value: "" });
    expect(validateSettingValue("tunnels.recommendedAgentVersion", "latest")).toMatchObject({ ok: false });
  });
});

describe("the hub refuses agents below the minimum version", () => {
  afterEach(() => installSettingsReader(null));

  function makeRouter() {
    const prisma = {
      apiKey: { findUnique: async ({ where }: any) => ({ id: `uuid_${where.keyId}`, accountId: "acct" }) },
      account: { findUnique: async ({ select }: any) => (select.slug ? { slug: "acme" } : { status: "ACTIVE" }) },
      subscription: { findFirst: async () => null },
      tunnelSession: { upsert: async () => {} },
    };
    let authCalls = 0;
    const router = new MessageRouter(
      new AgentRegistry(),
      {} as any,
      { rejectAllForAgent: () => 0 } as any,
      { authenticateAgent: async (msg: any) => (authCalls++, { accountId: "acct", keyId: msg.keyId, scopes: ["*"] }) } as any,
      {} as any,
      {} as any,
      {} as any,
      new TunnelSessionRepository(prisma as any),
      {} as any,
      "hub_1",
      { register: async () => {}, unregister: async () => {} } as any,
      "vhyxvoid.com",
      { closeAllForAgent: () => {} } as any,
    );
    async function connect(agentVersion: string) {
      const sent: any[] = [];
      let closed = false;
      const ws = { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => void (closed = true) };
      const msg = { v: "1", type: "agent:register", keyId: "key_1", label: "web", rawSecret: "s", agentVersion };
      await router.routeAgentMessage(ws, Buffer.from(JSON.stringify(msg)), "127.0.0.1");
      return { reply: sent.find((m) => m.type === "hub:registered" || m.type === "hub:error"), closed };
    }
    return { connect, authCalls: () => authCalls };
  }

  it("older agents get a fatal VERSION_UNSUPPORTED before any key check; newer ones connect", async () => {
    installSettingsReader(new SettingsReader(async () => [{ key: "tunnels.minimumAgentVersion", value: "1.1.0" }]));
    const hub = makeRouter();
    const old = await hub.connect("1.0.20");
    expect(old.reply).toMatchObject({ type: "hub:error", code: "VERSION_UNSUPPORTED", fatal: true });
    expect(old.reply.message).toMatch(/older than 1\.1\.0/);
    expect(old.closed).toBe(true);
    expect(hub.authCalls()).toBe(0);
    expect((await hub.connect("1.1.0")).reply.type).toBe("hub:registered");
  });

  it("no minimum set: old agents still connect", async () => {
    const hub = makeRouter();
    expect((await hub.connect("0.1.0")).reply.type).toBe("hub:registered");
  });
});
