import { describe, it, expect, vi } from "vitest";
import { AccountStatusSweepService } from "../../apps/hub/src/services/AccountStatusSweep.service";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { PendingRegistry } from "../../apps/hub/src/registry/Pending.registry";
import { makeAgentSession } from "./testHelpers";

// Covers shared/context.md Known Risk #57 (E6, Part 3): "no status check
// exists on live traffic" — an agent, once connected, was never re-checked
// against its account's real status. This periodic sweep is what closes it.
// The registry and pending registry are real; only Postgres (via a fake
// TunnelSessionRepository) and the WS/Redis edges are faked.

function makeFakeSessionRepo(statuses: Record<string, string>) {
  return {
    findStatusesByAccountIds: vi.fn(async (accountIds: string[]) => {
      const map = new Map<string, string>();
      for (const id of accountIds) if (id in statuses) map.set(id, statuses[id]);
      return map;
    }),
    markDisconnected: vi.fn(async () => {}),
  } as any;
}

function makeFakeHttpTunnelHandler() {
  return { closeAllForAgent: vi.fn(() => 0) } as any;
}

function makeFakeRedis() {
  return { del: vi.fn(async () => 1) };
}

function makeFakePendingRegistry(): PendingRegistry {
  return new PendingRegistry({ set: async () => {}, del: async () => {} } as any);
}

describe("AccountStatusSweepService", () => {
  it("does nothing when every connected account is ACTIVE", async () => {
    const agentRegistry = new AgentRegistry();
    const ws = { send: vi.fn(), close: vi.fn() };
    agentRegistry.register(makeAgentSession({ agentId: "a1", accountId: "acct_ok", label: "web", ws }));
    const sessionRepo = makeFakeSessionRepo({ acct_ok: "ACTIVE" });
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      sessionRepo,
      makeFakeHttpTunnelHandler(),
      makeFakeRedis(),
    );

    await sweep.tick();

    expect(ws.close).not.toHaveBeenCalled();
    expect(agentRegistry.findByAgentId("a1")).toBeDefined();
  });

  it("does nothing when every connected account is PAST_DUE (grace period keeps service running)", async () => {
    const agentRegistry = new AgentRegistry();
    const ws = { send: vi.fn(), close: vi.fn() };
    agentRegistry.register(makeAgentSession({ agentId: "a1", accountId: "acct_grace", label: "web", ws }));
    const sessionRepo = makeFakeSessionRepo({ acct_grace: "PAST_DUE" });
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      sessionRepo,
      makeFakeHttpTunnelHandler(),
      makeFakeRedis(),
    );

    await sweep.tick();

    expect(ws.close).not.toHaveBeenCalled();
  });

  it("evicts a connected agent whose account is SUSPENDED, sending a real hub:error first", async () => {
    const agentRegistry = new AgentRegistry();
    const ws = { send: vi.fn(), close: vi.fn() };
    agentRegistry.register(makeAgentSession({ agentId: "a1", accountId: "acct_bad", label: "web", ws }));
    const sessionRepo = makeFakeSessionRepo({ acct_bad: "SUSPENDED" });
    const httpTunnelHandler = makeFakeHttpTunnelHandler();
    const redis = makeFakeRedis();
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      sessionRepo,
      httpTunnelHandler,
      redis,
    );

    await sweep.tick();

    // A real, specific reason, not a bare disconnect.
    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(ws.send.mock.calls[0][0]);
    expect(sent).toMatchObject({
      type: "hub:error",
      code: "AUTH_FAILED",
      message: "Account is not active",
      fatal: true,
    });
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect(agentRegistry.findByAgentId("a1")).toBeUndefined();
    expect(sessionRepo.markDisconnected).toHaveBeenCalledWith("a1", "EVICTED");
    expect(httpTunnelHandler.closeAllForAgent).toHaveBeenCalledWith("a1", 1008, expect.any(String));
    expect(redis.del).toHaveBeenCalledWith("hub:agent:acct_bad:web");
  });

  it.each(["RESTRICTED", "CANCELED", "DELETED"])("also evicts a %s account", async (status) => {
    const agentRegistry = new AgentRegistry();
    const ws = { send: vi.fn(), close: vi.fn() };
    agentRegistry.register(makeAgentSession({ agentId: "a1", accountId: "acct_x", label: "web", ws }));
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      makeFakeSessionRepo({ acct_x: status }),
      makeFakeHttpTunnelHandler(),
      makeFakeRedis(),
    );

    await sweep.tick();

    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it("evicts an agent whose account no longer has a row at all (deleted, or a read gap) — never treated as implicitly fine", async () => {
    const agentRegistry = new AgentRegistry();
    const ws = { send: vi.fn(), close: vi.fn() };
    agentRegistry.register(makeAgentSession({ agentId: "a1", accountId: "acct_gone", label: "web", ws }));
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      makeFakeSessionRepo({}), // no row for acct_gone
      makeFakeHttpTunnelHandler(),
      makeFakeRedis(),
    );

    await sweep.tick();

    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it("checks each account once (batched), not once per agent — three agents, two accounts, one query", async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register(makeAgentSession({ agentId: "a1", accountId: "acct_1", label: "web" }));
    agentRegistry.register(makeAgentSession({ agentId: "a2", accountId: "acct_1", label: "api" }));
    agentRegistry.register(makeAgentSession({ agentId: "a3", accountId: "acct_2", label: "web" }));
    const sessionRepo = makeFakeSessionRepo({ acct_1: "ACTIVE", acct_2: "ACTIVE" });
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      sessionRepo,
      makeFakeHttpTunnelHandler(),
      makeFakeRedis(),
    );

    await sweep.tick();

    expect(sessionRepo.findStatusesByAccountIds).toHaveBeenCalledTimes(1);
    expect(sessionRepo.findStatusesByAccountIds).toHaveBeenCalledWith(
      expect.arrayContaining(["acct_1", "acct_2"]),
    );
  });

  it("evicts only the affected agent, leaving a healthy one on a different account connected", async () => {
    const agentRegistry = new AgentRegistry();
    const wsGood = { send: vi.fn(), close: vi.fn() };
    const wsBad = { send: vi.fn(), close: vi.fn() };
    agentRegistry.register(makeAgentSession({ agentId: "a1", accountId: "acct_good", label: "web", ws: wsGood }));
    agentRegistry.register(makeAgentSession({ agentId: "a2", accountId: "acct_bad", label: "web", ws: wsBad }));
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      makeFakeSessionRepo({ acct_good: "ACTIVE", acct_bad: "SUSPENDED" }),
      makeFakeHttpTunnelHandler(),
      makeFakeRedis(),
    );

    await sweep.tick();

    expect(wsGood.close).not.toHaveBeenCalled();
    expect(wsBad.close).toHaveBeenCalledTimes(1);
    expect(agentRegistry.findByAgentId("a1")).toBeDefined();
    expect(agentRegistry.findByAgentId("a2")).toBeUndefined();
  });

  it("does nothing when nothing is connected (no query at all)", async () => {
    const agentRegistry = new AgentRegistry();
    const sessionRepo = makeFakeSessionRepo({});
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      sessionRepo,
      makeFakeHttpTunnelHandler(),
      makeFakeRedis(),
    );

    await sweep.tick();

    expect(sessionRepo.findStatusesByAccountIds).not.toHaveBeenCalled();
  });

  it("a failed status lookup this tick doesn't touch any live connection", async () => {
    const agentRegistry = new AgentRegistry();
    const ws = { send: vi.fn(), close: vi.fn() };
    agentRegistry.register(makeAgentSession({ agentId: "a1", accountId: "acct_1", label: "web", ws }));
    const sessionRepo = {
      findStatusesByAccountIds: vi.fn(async () => {
        throw new Error("db down");
      }),
    } as any;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      sessionRepo,
      makeFakeHttpTunnelHandler(),
      makeFakeRedis(),
    );

    await expect(sweep.tick()).resolves.not.toThrow();

    expect(ws.close).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("a socket that throws on send() is still evicted (the send failure doesn't abort cleanup)", async () => {
    const agentRegistry = new AgentRegistry();
    const ws = {
      send: vi.fn(() => {
        throw new Error("socket gone");
      }),
      close: vi.fn(),
    };
    agentRegistry.register(makeAgentSession({ agentId: "a1", accountId: "acct_bad", label: "web", ws }));
    const sweep = new AccountStatusSweepService(
      agentRegistry,
      makeFakePendingRegistry(),
      makeFakeSessionRepo({ acct_bad: "SUSPENDED" }),
      makeFakeHttpTunnelHandler(),
      makeFakeRedis(),
    );

    await sweep.tick();

    expect(agentRegistry.findByAgentId("a1")).toBeUndefined();
  });
});
