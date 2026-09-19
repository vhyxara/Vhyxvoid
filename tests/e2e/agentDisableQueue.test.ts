import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgentClient } from "../../packages/agent/src/AgentClient";
import { NoOpQueue } from "../../packages/agent/src/queue/NoOpQueue";
import { replayQueue } from "../../packages/agent/src/replay/replayQueue";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";

// Covers context.md risk #17 / decision.md 2026-09-13: packages/middleware and
// packages/next run the agent in-process and pass `disableQueue: true` so no
// SQLite queue file is created. The published @vhyxvoid/middleware 1.0.3 was
// built before that option existed and still opened a DurableQueue (crashing
// at startup where the native module could not be located). These tests pin
// the behavior in the source so a republish carries it.

const dirs: string[] = [];
const agents: AgentClient[] = [];

function tempQueuePath(): { dir: string; file: string } {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vhyx-queue-")), "nested");
  dirs.push(path.dirname(dir));
  return { dir, file: path.join(dir, "queue.db") };
}

function makeAgent(extra: Record<string, unknown>): AgentClient {
  const agent = new AgentClient({
    hubUrl: "ws://127.0.0.1:1",
    keyId: "k",
    secret: "s",
    label: "t",
    port: 1,
    agentVersion: "0.0.0",
    localDiscovery: false,
    ...extra,
  });
  agents.push(agent);
  return agent;
}

afterEach(() => {
  for (const a of agents.splice(0)) a.stop();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("AgentClient — disableQueue", () => {
  it("creates no queue directory or database file when disableQueue is true", () => {
    const { dir, file } = tempQueuePath();
    const agent = makeAgent({ disableQueue: true, queuePath: file });

    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(agent.getQueueStatus()).toEqual({ ready: 0, pending: 0, deadLetter: 0 });
  });

  it("still creates the on-disk queue by default (control)", () => {
    const { file } = tempQueuePath();
    makeAgent({ queuePath: file });

    expect(fs.existsSync(file)).toBe(true);
  });
});

describe("NoOpQueue", () => {
  it("is accepted by replayQueue and replays nothing", async () => {
    const sent: string[] = [];
    const proxy = new BackendProxy(1);
    try {
      const result = await replayQueue(new NoOpQueue(), (d) => sent.push(d), proxy);
      expect(result).toMatchObject({ succeeded: 0, failed: 0 });
      expect(sent).toEqual([]);
    } finally {
      proxy.stop();
    }
  });

  it("swallows enqueues instead of throwing", () => {
    const q = new NoOpQueue();
    expect(() => q.enqueueOutbound({} as never)).not.toThrow();
    expect(q.drainForReplay()).toEqual([]);
    expect(q.count()).toEqual({ ready: 0, pending: 0, deadLetter: 0 });
  });
});
