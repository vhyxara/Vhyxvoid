import { describe, it, expect } from "vitest";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { makeAgentSession as makeSession } from "./testHelpers";

// Covers context.md risk #20 (findByAgentId was O(n) despite an available
// O(1) reverse-index map).
describe("AgentRegistry.findByAgentId", () => {
  it("finds a registered agent by agentId", () => {
    const registry = new AgentRegistry();
    const session = makeSession();
    registry.register(session);

    expect(registry.findByAgentId("agt_1")).toBe(session);
  });

  it("returns undefined for an unknown agentId", () => {
    const registry = new AgentRegistry();
    registry.register(makeSession());

    expect(registry.findByAgentId("agt_does_not_exist")).toBeUndefined();
  });

  it("no longer finds an agent after it is evicted", () => {
    const registry = new AgentRegistry();
    registry.register(makeSession());

    registry.evict("acct_1", "default");

    expect(registry.findByAgentId("agt_1")).toBeUndefined();
  });

  it("correctly resolves across multiple accounts/labels", () => {
    const registry = new AgentRegistry();
    const a = makeSession({ agentId: "agt_a", accountId: "acct_a", label: "web" });
    const b = makeSession({ agentId: "agt_b", accountId: "acct_b", label: "api" });
    registry.register(a);
    registry.register(b);

    expect(registry.findByAgentId("agt_a")).toBe(a);
    expect(registry.findByAgentId("agt_b")).toBe(b);
  });
});
