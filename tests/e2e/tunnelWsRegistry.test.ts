import { describe, it, expect, vi } from "vitest";
import {
  TunnelWsRegistry,
  closeBrowserSocket,
} from "../../apps/hub/src/registry/TunnelWs.registry";
import { toSendableCloseCode } from "../../packages/protocol/src";

// Unit coverage for the Phase 1 WS-relay pieces that have no behaviour of their
// own to observe through the relay (index bookkeeping, close-code translation).
// The end-to-end behaviour is in tunnelWsRelay.test.ts.

const fakeWs = (over: Partial<{ close: any; terminate: any }> = {}) =>
  ({ close: vi.fn(), terminate: vi.fn(), ...over }) as any;

const entry = (connectionId: string, agentId: string, ws = fakeWs()) => ({
  connectionId,
  accountId: "acct_1",
  agentId,
  browserWs: ws,
  openedAt: Date.now(),
});

describe("TunnelWsRegistry", () => {
  it("tracks entries and per-agent counts", () => {
    const r = new TunnelWsRegistry();
    r.add(entry("c1", "a1"));
    r.add(entry("c2", "a1"));
    r.add(entry("c3", "a2"));
    expect(r.size()).toBe(3);
    expect(r.countByAgent("a1")).toBe(2);
    expect(r.get("c3")?.agentId).toBe("a2");
  });

  it("delete is idempotent and cleans the per-agent index (no leak)", () => {
    const r = new TunnelWsRegistry();
    r.add(entry("c1", "a1"));
    expect(r.delete("c1")?.connectionId).toBe("c1");
    expect(r.delete("c1")).toBeUndefined();
    expect(r.size()).toBe(0);
    expect(r.countByAgent("a1")).toBe(0);
  });

  it("closeAllForAgent closes only that agent's sockets, with a sendable code", () => {
    const r = new TunnelWsRegistry();
    const mine = fakeWs();
    const other = fakeWs();
    r.add(entry("c1", "a1", mine));
    r.add(entry("c2", "a2", other));
    expect(r.closeAllForAgent("a1", 1012, "gone")).toBe(1);
    expect(mine.close).toHaveBeenCalledWith(1012, "gone");
    expect(other.close).not.toHaveBeenCalled();
    expect(r.size()).toBe(1);
    expect(r.closeAllForAgent("a1", 1012, "gone")).toBe(0);
  });
});

describe("closeBrowserSocket", () => {
  it("translates unsendable codes before closing", () => {
    const ws = fakeWs();
    closeBrowserSocket(ws, 1006, "x");
    expect(ws.close).toHaveBeenCalledWith(1011, "x");
  });

  it("terminates instead of leaving the socket open if close throws", () => {
    const ws = fakeWs({
      close: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    closeBrowserSocket(ws, 1000, "x");
    expect(ws.terminate).toHaveBeenCalled();
  });

  it("truncates an over-long reason instead of throwing", () => {
    const ws = fakeWs();
    closeBrowserSocket(ws, 1000, "é".repeat(200));
    const reason = ws.close.mock.calls[0][1] as string;
    expect(Buffer.byteLength(reason)).toBeLessThanOrEqual(123);
  });
});

describe("toSendableCloseCode", () => {
  it.each([
    [1000, 1000],
    [1001, 1001],
    [1003, 1003],
    [1011, 1011],
    [1012, 1012],
    [1014, 1014],
    [3000, 3000],
    [4999, 4999],
    [1005, 1000], // no status received -> clean close
    [1006, 1011], // abnormal
    [1015, 1011], // TLS failure
    [1004, 1011], // reserved
    [999, 1011],
    [5000, 1011],
    [1000.5, 1011],
  ])("%i -> %i", (input, expected) => {
    expect(toSendableCloseCode(input)).toBe(expected);
  });

  it("handles non-numbers", () => {
    expect(toSendableCloseCode(undefined)).toBe(1011);
    expect(toSendableCloseCode(null)).toBe(1011);
    expect(toSendableCloseCode(NaN)).toBe(1011);
  });

  it("only ever returns a code ws accepts", async () => {
    const { WebSocketServer, WebSocket } = await import("ws");
    const wss = new WebSocketServer({ port: 0 });
    await new Promise((r) => wss.on("listening", r));
    const port = (wss.address() as any).port;
    for (const code of [0, 999, 1000, 1004, 1005, 1006, 1015, 1016, 2999, 3000, 4999, 5000, -1]) {
      const sendable = toSendableCloseCode(code);
      const result = await new Promise<string>((res) => {
        const c = new WebSocket(`ws://127.0.0.1:${port}`);
        wss.once("connection", (ws) => {
          try {
            ws.close(sendable, "x");
            res("ok");
          } catch (e) {
            res(`threw for ${code} -> ${sendable}`);
          }
        });
        c.on("error", () => {});
      });
      expect(result).toBe("ok");
    }
    wss.close();
  });
});
