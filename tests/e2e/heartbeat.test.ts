import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeartbeatService } from "../../apps/hub/src/services/Heartbeat.service";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { PendingRegistry } from "../../apps/hub/src/registry/Pending.registry";
import { TIMING } from "../../packages/protocol/src/constants";
import { makeAgentSession } from "./testHelpers";

// REPLACED 2026-09-12 (broken-test-repair session). The original file
// imported AGENTS/runHeartbeatCheck from apps/hub/src/ws_heartbeat, which
// no longer exists — that flat module-level Map + free function design was
// replaced by HeartbeatService, a proper class taking AgentRegistry /
// PendingRegistry / a session repo / redis as constructor dependencies.
// There's no like-for-like REPAIR possible (the API shape is completely
// different), so this rebuilds the same real behavior — "an agent stops
// responding to heartbeats and gets evicted" — against the current class.
// See context.md risk #38 and decision.md, 2026-09-12, "Broken e2e test
// suite repair".
//
// HeartbeatService.tick() is private and driven by a real setInterval, so
// this uses vitest's fake timers to advance simulated time deterministically
// rather than waiting out MAX_MISSED_PINGS * HEARTBEAT_INTERVAL_MS for real
// (90s at current constants).

function makeHarness(agentRegistry: AgentRegistry) {
  const redis = {
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  };
  const pendingRegistry = new PendingRegistry(redis as any);
  const sessionRepo = { markDisconnected: vi.fn().mockResolvedValue(undefined) };
  const service = new HeartbeatService(
    agentRegistry,
    pendingRegistry,
    sessionRepo as any,
    redis as any,
    "hub_test",
  );
  return { service, redis, sessionRepo };
}

describe("HeartbeatService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes an agent from the registry after MAX_MISSED_PINGS heartbeats with no pong", () => {
    const agentRegistry = new AgentRegistry();
    const ws = { send: vi.fn(), close: vi.fn() };
    const session = makeAgentSession({ ws });
    agentRegistry.register(session);

    const { service } = makeHarness(agentRegistry);
    service.start();

    vi.advanceTimersByTime(TIMING.HEARTBEAT_INTERVAL_MS * TIMING.MAX_MISSED_PINGS);

    expect(agentRegistry.findByAgentId(session.agentId)).toBeUndefined();
    expect(ws.close).toHaveBeenCalled();

    service.stop();
  });

  it("keeps the agent connected as long as it sends a pong before the missed-ping threshold", () => {
    const agentRegistry = new AgentRegistry();
    const ws = { send: vi.fn(), close: vi.fn() };
    const session = makeAgentSession({ ws });
    agentRegistry.register(session);

    const { service } = makeHarness(agentRegistry);
    service.start();

    // Advance one tick at a time, sending a pong right after each one —
    // missedPings should never reach MAX_MISSED_PINGS.
    for (let i = 0; i < TIMING.MAX_MISSED_PINGS * 3; i++) {
      vi.advanceTimersByTime(TIMING.HEARTBEAT_INTERVAL_MS);
      service.handlePong(session.agentId);
    }

    expect(agentRegistry.findByAgentId(session.agentId)).toBe(session);
    expect(ws.close).not.toHaveBeenCalled();

    service.stop();
  });

  it("evicts even when ws.send throws (a dead socket) — missed pings still accumulate", () => {
    const agentRegistry = new AgentRegistry();
    const ws = {
      send: vi.fn(() => {
        throw new Error("socket is closed");
      }),
      close: vi.fn(),
    };
    const session = makeAgentSession({ ws });
    agentRegistry.register(session);

    const { service } = makeHarness(agentRegistry);
    service.start();

    vi.advanceTimersByTime(TIMING.HEARTBEAT_INTERVAL_MS * TIMING.MAX_MISSED_PINGS);

    expect(agentRegistry.findByAgentId(session.agentId)).toBeUndefined();

    service.stop();
  });
});
