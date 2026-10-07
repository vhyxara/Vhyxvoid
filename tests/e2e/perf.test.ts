// The performance engine (packages/shared/src/perf.ts) and the MONITOR alert
// rule (packages/shared/src/alerts.ts).
import { describe, expect, it } from "vitest";

import {
  ENDPOINT_HIST_BOUNDS,
  ENDPOINT_HIST_SIZE,
  LatencyHistogram,
  LoadRecorder,
  compareLoadTests,
  endpointHistIndex,
  loadTestConfigProblem,
  nextMonitorRun,
  percentileFromBuckets,
  routeOf,
  runLoadTest,
  specDrift,
  specFromMock,
  specFromOpenApi,
  summarizeEndpoints,
  uptimeSummary,
  vusAt,
  type EndpointStatRow,
  type LoadTestConfig,
} from "../../packages/shared/src/perf";
import { describeAlertRule, monitorSubjects } from "../../packages/shared/src/alerts";

const hist = (pairs: Array<[number, number]>) => {
  const h = new Array(ENDPOINT_HIST_SIZE).fill(0);
  for (const [ms, n] of pairs) h[endpointHistIndex(ms)] += n;
  return h;
};

describe("histograms", () => {
  it("coarse buckets: index by bound, percentiles interpolate inside a bucket and cap at the max seen", () => {
    expect(endpointHistIndex(10)).toBe(0);
    expect(endpointHistIndex(11)).toBe(1);
    expect(endpointHistIndex(99_999)).toBe(ENDPOINT_HIST_BOUNDS.length);
    const h = hist([[40, 90], [400, 10]]);
    expect(percentileFromBuckets(h, ENDPOINT_HIST_BOUNDS, 50, 450)).toBeGreaterThan(25);
    expect(percentileFromBuckets(h, ENDPOINT_HIST_BOUNDS, 50, 450)).toBeLessThanOrEqual(50);
    expect(percentileFromBuckets(h, ENDPOINT_HIST_BOUNDS, 99, 450)).toBeGreaterThan(250);
    expect(percentileFromBuckets(h, ENDPOINT_HIST_BOUNDS, 99, 450)).toBeLessThanOrEqual(450);
    expect(percentileFromBuckets(hist([[30_000, 5]]), ENDPOINT_HIST_BOUNDS, 99, 31_000)).toBeLessThanOrEqual(31_000);
    expect(percentileFromBuckets(new Array(ENDPOINT_HIST_SIZE).fill(0), ENDPOINT_HIST_BOUNDS, 50)).toBeNull();
  });

  it("fine histogram: percentiles within about 3 %, min/avg/max exact", () => {
    const h = new LatencyHistogram();
    for (let i = 1; i <= 1000; i++) h.add(i);
    const s = h.summary();
    expect(s.min).toBe(1);
    expect(s.max).toBe(1000);
    expect(s.avg).toBe(500.5);
    for (const [p, want] of [[50, 500], [95, 950], [99, 990]] as const) expect(Math.abs(s[`p${p}`] - want) / want).toBeLessThan(0.035);
    const other = new LatencyHistogram();
    other.add(5000);
    h.merge(other);
    expect(h.summary().max).toBe(5000);
  });
});

describe("endpoint analytics", () => {
  it("route patterns hide ids and query strings", () => {
    expect(routeOf("/users/42/orders/3f2504e0-4f89-41d3-9a0c-0305e82c3301?x=1")).toBe("/users/:id/orders/:id2");
    expect(routeOf("/health")).toBe("/health");
  });

  const from = new Date("2026-10-07T00:00:00Z");
  const to = new Date("2026-10-08T00:00:00Z");
  const row = (over: Partial<EndpointStatRow>): EndpointStatRow => ({ label: "api", method: "GET", route: "/users/:id", bucket: new Date("2026-10-07T10:00:00Z"), requests: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, totalMs: 0, maxMs: 0, hist: new Array(ENDPOINT_HIST_SIZE).fill(0), sample: "/users/7", ...over });

  it("summaries merge buckets: volume, error rate, percentiles, trend, new endpoints", () => {
    const rows = [
      row({ requests: 90, s2xx: 85, s5xx: 5, totalMs: 90 * 40, maxMs: 60, hist: hist([[40, 90]]) }),
      row({ bucket: new Date("2026-10-07T20:00:00Z"), requests: 10, s2xx: 5, s5xx: 5, totalMs: 10 * 400, maxMs: 800, hist: hist([[400, 10]]) }),
      row({ method: "POST", route: "/users", requests: 4, s4xx: 4, totalMs: 40, maxMs: 12, hist: hist([[10, 4]]) }),
    ];
    const seen = new Map([["api\u0000GET\u0000/users/:id", new Date("2026-10-01T00:00:00Z")]]);
    const [get, post] = summarizeEndpoints(rows, { from, to, firstSeen: seen, buckets: 24 });
    expect(get).toMatchObject({ method: "GET", route: "/users/:id", requests: 100, s5xx: 10, errorRate: 10, avgMs: 76, maxMs: 800, isNew: false, sample: "/users/7" });
    expect(get.p50).toBeLessThanOrEqual(50);
    expect(get.p99).toBeGreaterThan(250);
    expect(get.trend[10]).toBe(90);
    expect(get.trend[20]).toBe(10);
    expect(post).toMatchObject({ route: "/users", isNew: true, errorRate: 0, s4xx: 4 });
  });

  it("spec drift against a mock API: undocumented traffic, unused operations, unexpected status classes, coverage", () => {
    const spec = specFromMock({
      endpoints: [
        { id: "e1", enabled: true, method: "GET", path: "/users/{userId}", responses: [{ id: "r", status: 200 }] },
        { id: "e2", enabled: true, method: "DELETE", path: "/users/:id", responses: [{ id: "r", status: 204 }] },
      ],
      resources: [{ id: "t", name: "todos", path: "/todos", enabled: true, seed: [] }],
    });
    expect(spec).toHaveLength(8);
    const observed = [
      { method: "GET", route: "/users/:id", sample: "/users/7", requests: 50, s2xx: 40, s3xx: 0, s4xx: 0, s5xx: 10 },
      { method: "GET", route: "/todos", sample: "/todos", requests: 5, s2xx: 5, s3xx: 0, s4xx: 0, s5xx: 0 },
      { method: "GET", route: "/admin", sample: "/admin", requests: 3, s2xx: 3, s3xx: 0, s4xx: 0, s5xx: 0 },
      { method: "GET", route: "(other)", sample: "", requests: 9, s2xx: 9, s3xx: 0, s4xx: 0, s5xx: 0 },
    ];
    const d = specDrift(observed, spec);
    expect(d.undocumented).toEqual([{ method: "GET", route: "/admin", sample: "/admin", requests: 3 }]);
    expect(d.unexpectedStatuses).toEqual([{ method: "GET", route: "/users/:id", path: "/users/{userId}", statusClass: "5xx", requests: 10 }]);
    expect(d.unused.map((u) => `${u.method} ${u.path}`)).toContain("DELETE /users/:id");
    expect(d.matched).toBe(2);
    expect(d.coverage).toBe(25);
  });

  it("spec from OpenAPI keeps the server's path prefix and documented codes (4XX, default)", () => {
    const ops = specFromOpenApi({ openapi: "3.0.0", servers: [{ url: "https://api.example.com/v1" }], paths: { "/pets/{id}": { get: { responses: { "200": {}, "4XX": {} } } }, "/pets": { post: { responses: { default: {} } } } } });
    expect(ops).toEqual([{ method: "GET", path: "/v1/pets/{id}", statuses: ["200", "4XX"] }, { method: "POST", path: "/v1/pets", statuses: ["default"] }]);
    const d = specDrift([{ method: "GET", route: "/v1/pets/:id", sample: "/v1/pets/1", requests: 3, s2xx: 1, s3xx: 0, s4xx: 2, s5xx: 0 }, { method: "POST", route: "/v1/pets", sample: "/v1/pets", requests: 1, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 1 }], ops);
    expect(d.unexpectedStatuses).toEqual([]);
    expect(specFromOpenApi({ swagger: "2.0", basePath: "/api", paths: { "/x": { get: { responses: { "200": {} } } } } })[0].path).toBe("/api/x");
    expect(() => specFromOpenApi({ hello: 1 })).toThrow(/Not an OpenAPI/);
  });
});

describe("load tests", () => {
  const base: LoadTestConfig = { request: { method: "GET", url: "https://acme--api.vv.test/", headers: [] }, vus: 5, durationSec: 2, rampUpSec: 0, thinkTimeMs: 0, maxRps: 0 };

  it("validates against the plan", () => {
    const lim = { maxVus: 10, maxSeconds: 60, maxRps: 50 };
    expect(loadTestConfigProblem({ ...base, durationSec: 10 }, lim)).toBeNull();
    expect(loadTestConfigProblem({ ...base, vus: 11, durationSec: 10 }, lim)).toMatch(/up to 10 virtual users/);
    expect(loadTestConfigProblem({ ...base, durationSec: 61 }, lim)).toMatch(/up to 60 seconds/);
    expect(loadTestConfigProblem({ ...base, durationSec: 10, rampUpSec: 20 }, lim)).toMatch(/ramp-up/);
    expect(loadTestConfigProblem({ ...base, durationSec: 10, maxRps: 51 }, lim)).toMatch(/50 requests per second/);
  });

  it("ramps virtual users linearly", () => {
    expect(vusAt({ vus: 10, rampUpSec: 10 }, 0)).toBe(1);
    expect(vusAt({ vus: 10, rampUpSec: 10 }, 5_000)).toBe(5);
    expect(vusAt({ vus: 10, rampUpSec: 10 }, 20_000)).toBe(10);
    expect(vusAt({ vus: 10, rampUpSec: 0 }, 0)).toBe(10);
  });

  it("runs for the duration, paces to maxRps, builds a per-second timeline and evaluates thresholds", async () => {
    let n = 0;
    const send = async () => {
      n++;
      await new Promise((r) => setTimeout(r, 5));
      return n % 10 === 0 ? { status: 500, ms: 5 } : { status: 200, ms: 5, bytes: 10 };
    };
    const ticks: number[] = [];
    const { summary, timeline } = await runLoadTest({ config: { ...base, maxRps: 20, thresholds: { p95Ms: 1000, errorRatePct: 5 } }, send, onTick: (p) => void ticks.push(p.t) });
    expect(ticks).toEqual([1, 2]);
    expect(timeline).toHaveLength(2);
    expect(summary.requests).toBeGreaterThanOrEqual(30);
    expect(summary.requests).toBeLessThanOrEqual(45);
    expect(summary.statuses["500"]).toBe(Math.floor(summary.requests / 10));
    expect(summary.errorRate).toBeCloseTo((summary.errors / summary.requests) * 100, 0);
    expect(summary.maxVus).toBe(5);
    expect(summary.thresholds.map((t) => [t.name, t.pass])).toEqual([["p95 latency (ms) <", true], ["error rate (%) ≤", false]]);
    expect(summary.passed).toBe(false);
  });

  it("stops early when asked and records network failures without latency", async () => {
    const send = async () => {
      await new Promise((r) => setTimeout(r, 2));
      return { status: 0, ms: 1, error: "connection refused" };
    };
    let calls = 0;
    const { summary } = await runLoadTest({ config: { ...base, vus: 2, durationSec: 10 }, send, shouldStop: () => (++calls >= 1 ? "Cancelled" : null) });
    expect(summary.stoppedEarly).toBe("Cancelled");
    expect(summary.durationSec).toBeLessThan(3);
    expect(summary.failures["connection refused"]).toBe(summary.requests);
    expect(summary.errorRate).toBe(100);
    expect(summary.latency.p95).toBe(0);
  });

  it("4xx count as errors only when asked; compare shows which run is better", () => {
    const a = new LoadRecorder(false);
    const b = new LoadRecorder(true);
    for (const r of [a, b]) {
      r.add({ status: 200, ms: 10 });
      r.add({ status: 404, ms: 20 });
      r.tick(1, 1);
    }
    expect(a.summary(1).errors).toBe(0);
    expect(b.summary(1).errors).toBe(1);
    const rows = compareLoadTests(a.summary(1), b.summary(2));
    expect(rows.find((r) => r.metric === "Requests per second")).toMatchObject({ a: 2, b: 1, change: -50, better: false });
    expect(rows.find((r) => r.metric === "Error rate (%)")).toMatchObject({ a: 0, b: 50, better: false });
  });
});

describe("monitors", () => {
  it("uptime and bars over a window", () => {
    const from = new Date("2026-10-07T00:00:00Z");
    const to = new Date("2026-10-07T04:00:00Z");
    const at = (h: number) => new Date(from.getTime() + h * 3_600_000);
    const s = uptimeSummary(
      [
        { at: at(0.5), ok: true, durationMs: 100 },
        { at: at(1.5), ok: false, durationMs: 300 },
        { at: at(1.6), ok: true, durationMs: 100 },
        { at: at(5), ok: false, durationMs: 1 },
      ],
      from,
      to,
      4,
    );
    expect(s).toMatchObject({ checks: 3, ok: 2, uptime: 66.67, avgMs: 167 });
    expect(s.bars.map((b) => b.uptime)).toEqual([100, 50, null, null]);
  });

  it("next run is aligned to the interval and in the future", () => {
    expect(nextMonitorRun(5, Date.parse("2026-10-07T10:02:10Z")).toISOString()).toBe("2026-10-07T10:05:00.000Z");
    expect(nextMonitorRun(60, Date.parse("2026-10-07T10:00:00Z")).toISOString()).toBe("2026-10-07T11:00:00.000Z");
  });

  it("MONITOR alert rules fire on consecutive failures, for one monitor or any", () => {
    const monitors = [
      { id: "m1", name: "Checkout", enabled: true, consecutiveFailures: 3 },
      { id: "m2", name: "Login", enabled: true, consecutiveFailures: 1 },
      { id: "m3", name: "Paused", enabled: false, consecutiveFailures: 9 },
    ];
    const rule = { type: "MONITOR" as const, label: null, threshold: 2, windowMinutes: null, minRequests: null };
    expect(monitorSubjects(rule, monitors).map((m) => m.id)).toEqual(["m1"]);
    expect(monitorSubjects({ ...rule, threshold: 1 }, monitors).map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(monitorSubjects({ ...rule, label: "m2", threshold: 1 }, monitors).map((m) => m.id)).toEqual(["m2"]);
    expect(describeAlertRule(rule)).toBe("any monitor fails 2 checks in a row");
  });
});
