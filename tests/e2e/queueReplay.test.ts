import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  clearQueue,
  readQueueLength,
  pushToDurableQueue,
} from "../../apps/agent/src/utils/queue";
import { replayQueue } from "../../apps/agent/src/utils/queue";
// import { forwardToLocalBackend } from "../../apps/agent/src/utils/forward";

vi.mock("../../apps/agent/src/utils/forward", () => ({
  forwardToLocalBackend: vi.fn().mockResolvedValue({ status: 200 }),
}));

describe("Queue replay behavior", () => {
  beforeAll(clearQueue);

  it("stores + replays when backend returns", async () => {
    pushToDurableQueue({ msg: { path: "/demo", method: "GET" } });

    expect(readQueueLength()).toBe(1);

    await replayQueue();
    expect(readQueueLength()).toBe(0); // flushed after success
  });
});
