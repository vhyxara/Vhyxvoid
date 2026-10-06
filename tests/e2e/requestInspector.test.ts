// Request inspector capture rules (packages/shared/src/inspector.ts) and the
// hub service that decides how many requests to keep.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureBody,
  INSPECT_BODY_MAX_BYTES,
  inspectorKeys,
  installSettingsReader,
  maskHeaders,
  parseInspectedRequests,
  replayableHeaders,
  SettingsReader,
  writeInspectedRequest,
} from "../../packages/shared/src";
import { RequestInspectorService } from "../../apps/hub/src/services/RequestInspector.service";

function fakeRedis() {
  const ops: Array<[string, ...unknown[]]> = [];
  return {
    ops,
    pipeline() {
      const p = {
        lpush: (...a: unknown[]) => (ops.push(["lpush", ...a]), p),
        ltrim: (...a: unknown[]) => (ops.push(["ltrim", ...a]), p),
        expire: (...a: unknown[]) => (ops.push(["expire", ...a]), p),
        hset: (...a: unknown[]) => (ops.push(["hset", ...a]), p),
        exec: async () => ops.push(["exec"]),
      };
      return p;
    },
  };
}

const entry = (over = {}) => ({
  id: "req_" + "a".repeat(32),
  at: new Date().toISOString(),
  label: "app",
  accountSlug: "acme",
  host: "acme--app.vhyxvoid.com",
  method: "POST",
  path: "/hook",
  clientIp: "1.2.3.4",
  request: { headers: {}, body: captureBody(null, false) },
  response: null,
  durationMs: 3,
  error: null,
  replayOf: null,
  ...over,
});

afterEach(() => installSettingsReader(null));

describe("capture rules", () => {
  it("masks credentials and lower-cases names", () => {
    const h = maskHeaders({ Authorization: "Bearer x", Cookie: "s=1", "X-Api-Key": "k", "Content-Type": "application/json", "X-Multi": ["a", "b"] });
    expect(h).toEqual({ authorization: "[hidden]", cookie: "[hidden]", "x-api-key": "[hidden]", "content-type": "application/json", "x-multi": "a, b" });
  });

  it("replays without masked or hop-by-hop headers", () => {
    expect(replayableHeaders({ authorization: "[hidden]", host: "h", "content-length": "3", "x-sig": "abc" })).toEqual({ "x-sig": "abc" });
  });

  it("cuts bodies at the limit and remembers the full size", () => {
    const big = Buffer.alloc(INSPECT_BODY_MAX_BYTES + 10, "a");
    const c = captureBody(big, false);
    expect(c).toMatchObject({ size: INSPECT_BODY_MAX_BYTES + 10, truncated: true, encoding: "utf8" });
    expect(c.data!.length).toBe(INSPECT_BODY_MAX_BYTES);
    expect(captureBody(Buffer.from([0, 255]), true)).toMatchObject({ data: "AP8=", encoding: "base64", truncated: false });
  });

  it("writes one pipeline: push, trim to the limit, expire, index the label", async () => {
    const redis = fakeRedis();
    await writeInspectedRequest(redis, "acc1", entry(), 20);
    const names = redis.ops.map((o) => o[0]);
    expect(names).toEqual(["lpush", "ltrim", "expire", "hset", "expire", "exec"]);
    expect(redis.ops[1]).toEqual(["ltrim", inspectorKeys.list("acc1", "app"), 0, 19]);
  });

  it("writes nothing when the limit is 0", async () => {
    const redis = fakeRedis();
    await writeInspectedRequest(redis, "acc1", entry(), 0);
    expect(redis.ops).toEqual([]);
  });

  it("skips malformed stored entries", () => {
    expect(parseInspectedRequests(["not json", JSON.stringify(entry()), JSON.stringify({ nope: 1 })])).toHaveLength(1);
  });
});

describe("RequestInspectorService", () => {
  const limits = (n: number) => ({ findPlanLimitsForAccount: vi.fn(async () => ({ plan: "FREE" as const, inspectorRequests: n })) });

  it("keeps the plan's number, cached per account", async () => {
    const src = limits(20);
    const svc = new RequestInspectorService(fakeRedis(), src);
    expect(await svc.keepFor("a")).toBe(20);
    expect(await svc.keepFor("a")).toBe(20);
    expect(src.findPlanLimitsForAccount).toHaveBeenCalledTimes(1);
  });

  it("caps unlimited and turns off with the global switch", async () => {
    expect(await new RequestInspectorService(fakeRedis(), limits(Infinity)).keepFor("a")).toBe(5000);
    installSettingsReader(new SettingsReader(async () => [{ key: "features.requestInspector", value: false }]));
    expect(await new RequestInspectorService(fakeRedis(), limits(20)).keepFor("a")).toBe(0);
  });

  it("a failing lookup means no capture, never an error", async () => {
    const svc = new RequestInspectorService(fakeRedis(), { findPlanLimitsForAccount: async () => { throw new Error("db"); } });
    expect(await svc.keepFor("a")).toBe(0);
  });
});
