import { describe, it, expect } from "vitest";
import { AGENTS, runHeartbeatCheck } from "../../apps/hub/src/ws_heartbeat";

describe("Agent heartbeat removal", () => {
  it("removes agent after missed heartbeats", () => {
    const mockWs = {
      send: () => {
        throw new Error("mock send error");
      },
      close: () => {},
      on: () => {},
      readyState: 1,
    } as unknown as WebSocket;

    AGENTS.set("agent1", { ws: mockWs, missed: 3, lastSeen: 0 });

    // simulate loop check
    // for (let i = 0; i < 3; i++) {
    //   try {
    //     AGENTS.get("agent1")!.ws.send("ping");
    //   } catch {}
    // }
    runHeartbeatCheck();
    runHeartbeatCheck();
    runHeartbeatCheck();
    expect(AGENTS.has("agent1")).toBe(false);
  });
});
