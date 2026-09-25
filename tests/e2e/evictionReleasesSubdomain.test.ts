import { describe, it, expect, vi, afterEach } from "vitest";
import { HeartbeatService } from "../../apps/hub/src/services/Heartbeat.service";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { PendingRegistry } from "../../apps/hub/src/registry/Pending.registry";
import { releaseSubdomain } from "../../apps/hub/src/utils/releaseSubdomain";
import { TIMING } from "../../packages/protocol/src/constants";
import { makeAgentSession } from "./testHelpers";

// hub backlog, 2026-09-24: an eviction (heartbeat or account/key sweep)
// removed the session from the AgentRegistry before closing the socket, so
// onAgentClose found no session and the agent's tunnel:sub:<slug>--<label>
// Redis entry leaked until a public request hit it. Evictions now release it.

afterEach(() => vi.useRealTimers());

describe("releaseSubdomain", () => {
  it("unregisters the label under the account's slug, as a compare-and-delete on agentId", async () => {
    const deps = {
      findAccountSlug: vi.fn(async () => "acme-k3x9p2qa"),
      unregister: vi.fn(async () => {}),
    };
    await releaseSubdomain(deps, { accountId: "acct_1", label: "api", agentId: "agt_1" });
    expect(deps.findAccountSlug).toHaveBeenCalledWith("acct_1");
    expect(deps.unregister).toHaveBeenCalledWith("api", "acme-k3x9p2qa", "agt_1");
  });

  it("does nothing without a slug, and never throws on a lookup failure", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const unregister = vi.fn(async () => {});
    await releaseSubdomain(
      { findAccountSlug: async () => null, unregister },
      { accountId: "a", label: "l", agentId: "g" },
    );
    await expect(
      releaseSubdomain(
        { findAccountSlug: async () => Promise.reject(new Error("db down")), unregister },
        { accountId: "a", label: "l", agentId: "g" },
      ),
    ).resolves.toBeUndefined();
    expect(unregister).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
  });
});

describe("HeartbeatService eviction releases the subdomain entry", () => {
  it("calls unregister for the evicted agent", async () => {
    vi.useFakeTimers();
    const agentRegistry = new AgentRegistry();
    const session = makeAgentSession({ ws: { send: vi.fn(), close: vi.fn() } });
    agentRegistry.register(session);

    const redis = { set: vi.fn().mockResolvedValue("OK"), del: vi.fn().mockResolvedValue(1) };
    const subdomains = {
      findAccountSlug: vi.fn(async () => "acme-k3x9p2qa"),
      unregister: vi.fn(async () => {}),
    };
    const service = new HeartbeatService(
      agentRegistry,
      new PendingRegistry(redis as any),
      { markDisconnected: vi.fn().mockResolvedValue(undefined) } as any,
      redis as any,
      "hub_test",
      subdomains,
    );
    service.start();
    vi.advanceTimersByTime(TIMING.HEARTBEAT_INTERVAL_MS * TIMING.MAX_MISSED_PINGS);
    service.stop();
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 0));

    expect(subdomains.unregister).toHaveBeenCalledWith(session.label, "acme-k3x9p2qa", session.agentId);
  });
});
