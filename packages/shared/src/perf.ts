// packages/shared/src/perf.ts
//
// Performance and monitoring (internal-tools/shared/api-platform-plan.md,
// phase 4), the pure parts:
//
//   - latency histograms: a coarse fixed one the hub stores per endpoint per
//     5 minutes (mergeable in SQL), and a fine log-scale one for load tests;
//     percentiles from both;
//   - endpoint analytics: route patterns from paths, summaries with error
//     rate and percentiles, new endpoints, spec drift against a mock API or
//     an OpenAPI document;
//   - load tests: virtual users with ramp-up, think time and an optional
//     request-rate cap, a per-second timeline, thresholds (k6 style) and a
//     comparison of two runs;
//   - monitors: uptime and the next run time.

import { generalizePath } from "./mockInterop";
import { matchMockPath, type MockApiDefinition } from "./mockApi";

// ── Histograms ───────────────────────────────────────────────────────────────

/** Upper bounds (ms) of the coarse histogram the hub stores; the last bucket is open. */
export const ENDPOINT_HIST_BOUNDS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export const ENDPOINT_HIST_SIZE = ENDPOINT_HIST_BOUNDS.length + 1;

export function endpointHistIndex(ms: number): number {
  for (let i = 0; i < ENDPOINT_HIST_BOUNDS.length; i++) if (ms <= ENDPOINT_HIST_BOUNDS[i]) return i;
  return ENDPOINT_HIST_BOUNDS.length;
}

/**
 * Percentile from bucket counts: linear inside the bucket that holds it. The
 * open last bucket ends at `maxMs` (the largest value seen), so p99 of a slow
 * endpoint is not stuck at the last bound.
 */
export function percentileFromBuckets(counts: readonly number[], bounds: readonly number[], p: number, maxMs?: number): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const rank = Math.min(total, Math.max(1, Math.ceil((p / 100) * total)));
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    if (!counts[i]) continue;
    if (seen + counts[i] >= rank) {
      const lo = i === 0 ? 0 : bounds[i - 1];
      const hi = i < bounds.length ? bounds[i] : Math.max(maxMs ?? lo * 2, lo);
      const within = (rank - seen) / counts[i];
      const v = lo + (Math.min(hi, maxMs ?? hi) - lo) * within;
      return Math.round(Math.max(lo, Math.min(v, maxMs ?? v)) * 10) / 10;
    }
    seen += counts[i];
  }
  return null;
}

/** Fine log-scale histogram (about 3 % resolution from 0.1 ms to 10 min) for load tests. */
export class LatencyHistogram {
  static readonly RATIO = 1.03;
  static readonly MIN = 0.1;
  readonly counts = new Map<number, number>();
  count = 0;
  sum = 0;
  min = Infinity;
  max = 0;

  static index(ms: number): number {
    return ms <= LatencyHistogram.MIN ? 0 : Math.ceil(Math.log(ms / LatencyHistogram.MIN) / Math.log(LatencyHistogram.RATIO));
  }

  static upper(i: number): number {
    return LatencyHistogram.MIN * LatencyHistogram.RATIO ** i;
  }

  add(ms: number): void {
    const v = Math.max(0, ms);
    const i = LatencyHistogram.index(v);
    this.counts.set(i, (this.counts.get(i) ?? 0) + 1);
    this.count++;
    this.sum += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }

  merge(other: LatencyHistogram): void {
    for (const [i, c] of other.counts) this.counts.set(i, (this.counts.get(i) ?? 0) + c);
    this.count += other.count;
    this.sum += other.sum;
    this.min = Math.min(this.min, other.min);
    this.max = Math.max(this.max, other.max);
  }

  percentile(p: number): number | null {
    if (!this.count) return null;
    const rank = Math.min(this.count, Math.max(1, Math.ceil((p / 100) * this.count)));
    let seen = 0;
    for (const i of [...this.counts.keys()].sort((a, b) => a - b)) {
      seen += this.counts.get(i)!;
      if (seen >= rank) return Math.round(Math.min(this.max, Math.max(this.min, LatencyHistogram.upper(i))) * 10) / 10;
    }
    return Math.round(this.max * 10) / 10;
  }

  summary(): LatencySummary {
    const r = (n: number | null) => (n === null ? 0 : n);
    return {
      min: this.count ? Math.round(this.min * 10) / 10 : 0,
      avg: this.count ? Math.round((this.sum / this.count) * 10) / 10 : 0,
      p50: r(this.percentile(50)),
      p90: r(this.percentile(90)),
      p95: r(this.percentile(95)),
      p99: r(this.percentile(99)),
      max: Math.round(this.max * 10) / 10,
    };
  }
}

export interface LatencySummary {
  min: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

// ── Endpoint analytics ───────────────────────────────────────────────────────

/** At most this many distinct routes per tunnel per flush; the rest count as "(other)". */
export const ENDPOINT_ROUTES_PER_TUNNEL = 300;
export const ENDPOINT_OTHER_ROUTE = "(other)";
export const ENDPOINT_BUCKET_MS = 5 * 60_000;
export const ENDPOINT_STATS_RETENTION_DAYS = 7;

/** "/users/42?x=1" -> "/users/:id" (ids by shape: numbers, UUIDs, long tokens). */
export function routeOf(path: string): string {
  const p = generalizePath(path).pattern;
  return p.length > 300 ? `${p.slice(0, 299)}…` : p;
}

/** One stored row (tunnel_endpoint_stats). */
export interface EndpointStatRow {
  label: string;
  method: string;
  route: string;
  bucket: Date;
  requests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  totalMs: number;
  maxMs: number;
  hist: number[];
  sample: string;
}

export interface EndpointSummary {
  label: string;
  method: string;
  route: string;
  sample: string;
  requests: number;
  rpm: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  errorRate: number;
  avgMs: number;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  maxMs: number;
  firstSeen: string;
  lastSeen: string;
  /** No traffic before the window (within what is kept). */
  isNew: boolean;
  /** Requests per bucket over the window, for a sparkline. */
  trend: number[];
}

export function summarizeEndpoints(rows: readonly EndpointStatRow[], window: { from: Date; to: Date; firstSeen?: Map<string, Date>; buckets?: number }): EndpointSummary[] {
  const groups = new Map<string, EndpointStatRow[]>();
  for (const r of rows) {
    const k = `${r.label}\u0000${r.method}\u0000${r.route}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const minutes = Math.max(1, (window.to.getTime() - window.from.getTime()) / 60_000);
  const nBuckets = window.buckets ?? 24;
  const span = (window.to.getTime() - window.from.getTime()) / nBuckets;
  const out: EndpointSummary[] = [];
  for (const [k, list] of groups) {
    const [label, method, route] = k.split("\u0000");
    const hist = new Array(ENDPOINT_HIST_SIZE).fill(0);
    const sum = { requests: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, totalMs: 0, maxMs: 0 };
    const trend = new Array(nBuckets).fill(0);
    let first = list[0].bucket;
    let last = list[0].bucket;
    for (const r of list) {
      sum.requests += r.requests;
      sum.s2xx += r.s2xx;
      sum.s3xx += r.s3xx;
      sum.s4xx += r.s4xx;
      sum.s5xx += r.s5xx;
      sum.totalMs += r.totalMs;
      sum.maxMs = Math.max(sum.maxMs, r.maxMs);
      r.hist.forEach((c, i) => (hist[i] += c));
      if (r.bucket < first) first = r.bucket;
      if (r.bucket > last) last = r.bucket;
      const ti = Math.min(nBuckets - 1, Math.max(0, Math.floor((r.bucket.getTime() - window.from.getTime()) / span)));
      trend[ti] += r.requests;
    }
    const known = window.firstSeen?.get(k);
    const firstSeen = known && known < first ? known : first;
    const pct = (p: number) => percentileFromBuckets(hist, ENDPOINT_HIST_BOUNDS, p, sum.maxMs);
    out.push({
      label,
      method,
      route,
      sample: list.find((r) => r.sample)?.sample ?? route,
      requests: sum.requests,
      rpm: Math.round((sum.requests / minutes) * 100) / 100,
      s2xx: sum.s2xx,
      s3xx: sum.s3xx,
      s4xx: sum.s4xx,
      s5xx: sum.s5xx,
      errorRate: sum.requests ? Math.round((sum.s5xx / sum.requests) * 1000) / 10 : 0,
      avgMs: sum.requests ? Math.round(sum.totalMs / sum.requests) : 0,
      p50: pct(50),
      p90: pct(90),
      p95: pct(95),
      p99: pct(99),
      maxMs: sum.maxMs,
      firstSeen: firstSeen.toISOString(),
      lastSeen: last.toISOString(),
      isNew: firstSeen >= window.from,
      trend,
    });
  }
  return out.sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route));
}

// ── Spec drift ───────────────────────────────────────────────────────────────

export interface SpecOperation {
  method: string;
  /** /users/{id} or /users/:id */
  path: string;
  /** Documented response codes ("200", "4XX", "default"); empty when unknown. */
  statuses: string[];
}

/** Operations from a mock API definition (its endpoints and resource routes). */
export function specFromMock(def: Pick<MockApiDefinition, "endpoints" | "resources">): SpecOperation[] {
  const ops: SpecOperation[] = def.endpoints.filter((e) => e.enabled).map((e) => ({ method: e.method, path: e.path, statuses: [...new Set(e.responses.map((r) => String(r.status)))] }));
  for (const r of def.resources ?? []) {
    if (!r.enabled) continue;
    const item = `${r.path.replace(/\/$/, "")}/:id`;
    ops.push(
      { method: "GET", path: r.path, statuses: ["200"] },
      { method: "POST", path: r.path, statuses: ["201", "400", "409"] },
      { method: "GET", path: item, statuses: ["200", "404"] },
      { method: "PUT", path: item, statuses: ["200", "400", "404"] },
      { method: "PATCH", path: item, statuses: ["200", "400", "404"] },
      { method: "DELETE", path: item, statuses: ["204", "404"] },
    );
  }
  return ops;
}

const OPENAPI_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/** Operations from an OpenAPI 3 / Swagger 2 document, with the server's path prefix (throws a readable Error). */
export function specFromOpenApi(doc: unknown): SpecOperation[] {
  if (!doc || typeof doc !== "object") throw new Error("Not an OpenAPI document");
  const d = doc as Record<string, unknown>;
  const v3 = typeof d.openapi === "string" && d.openapi.startsWith("3");
  if (!v3 && d.swagger !== "2.0") throw new Error('Not an OpenAPI 3.x or Swagger 2.0 document (no "openapi: 3.x" or "swagger: 2.0")');
  let prefix = "";
  if (v3 && Array.isArray(d.servers) && d.servers[0] && typeof (d.servers[0] as Record<string, unknown>).url === "string") {
    const url = String((d.servers[0] as Record<string, unknown>).url).replace(/\{[^}]+\}/g, "x");
    try {
      prefix = new URL(url, "http://placeholder").pathname;
    } catch {
      prefix = "";
    }
  } else if (!v3 && typeof d.basePath === "string") prefix = d.basePath;
  prefix = prefix.replace(/\/+$/, "");
  const ops: SpecOperation[] = [];
  for (const [path, item] of Object.entries((d.paths as Record<string, Record<string, unknown>>) ?? {})) {
    if (!item || typeof item !== "object") continue;
    for (const m of OPENAPI_METHODS) {
      const op = item[m] as { responses?: Record<string, unknown> } | undefined;
      if (!op || typeof op !== "object") continue;
      ops.push({ method: m.toUpperCase(), path: `${prefix}${path}` || "/", statuses: Object.keys(op.responses ?? {}) });
    }
  }
  if (!ops.length) throw new Error("The document has no operations");
  return ops;
}

export interface DriftReport {
  /** Traffic with no matching operation in the spec. */
  undocumented: Array<{ method: string; route: string; sample: string; requests: number }>;
  /** Operations in the spec with no traffic in the window. */
  unused: Array<{ method: string; path: string }>;
  /** Matched traffic answering with a status class the spec doesn't document. */
  unexpectedStatuses: Array<{ method: string; route: string; path: string; statusClass: string; requests: number }>;
  matched: number;
  coverage: number;
}

/**
 * Compares observed endpoints with a spec. Matching uses the concrete sample
 * path against the spec's pattern, so "/users/:id" seen as "/users/42"
 * matches "/users/{userId}". ANY in the spec matches every method.
 */
export function specDrift(observed: ReadonlyArray<Pick<EndpointSummary, "method" | "route" | "sample" | "requests" | "s2xx" | "s3xx" | "s4xx" | "s5xx">>, spec: readonly SpecOperation[]): DriftReport {
  const used = new Set<number>();
  const undocumented: DriftReport["undocumented"] = [];
  const unexpected: DriftReport["unexpectedStatuses"] = [];
  let matched = 0;
  for (const o of observed) {
    if (o.route === ENDPOINT_OTHER_ROUTE) continue;
    const path = (o.sample || o.route).split("?")[0];
    const idx = spec.findIndex((s) => (s.method === o.method || s.method === "ANY" || (s.method === "GET" && o.method === "HEAD")) && matchMockPath(s.path, path) !== null);
    if (idx === -1) {
      undocumented.push({ method: o.method, route: o.route, sample: path, requests: o.requests });
      continue;
    }
    matched++;
    used.add(idx);
    const op = spec[idx];
    for (const [cls, n] of [["2", o.s2xx], ["3", o.s3xx], ["4", o.s4xx], ["5", o.s5xx]] as const) {
      if (!n) continue;
      // "404", "4XX" and "default" all document a 4xx answer.
      const ok = op.statuses.length === 0 || op.statuses.some((d) => d === "default" || d[0] === cls);
      if (!ok) unexpected.push({ method: o.method, route: o.route, path: op.path, statusClass: `${cls}xx`, requests: n });
    }
  }
  const unused = spec.filter((_, i) => !used.has(i)).map((s) => ({ method: s.method, path: s.path }));
  return {
    undocumented: undocumented.sort((a, b) => b.requests - a.requests),
    unused,
    unexpectedStatuses: unexpected.sort((a, b) => b.requests - a.requests),
    matched,
    coverage: spec.length ? Math.round((used.size / spec.length) * 1000) / 10 : 0,
  };
}

// ── Load tests ───────────────────────────────────────────────────────────────

export interface LoadTestRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
}

export interface LoadTestThresholds {
  p95Ms?: number;
  p99Ms?: number;
  avgMs?: number;
  /** Percent of requests that failed (network errors and 5xx; 4xx too when count4xxAsErrors). */
  errorRatePct?: number;
  /** Minimum requests per second over the run. */
  minRps?: number;
}

export interface LoadTestConfig {
  request: LoadTestRequest;
  vus: number;
  durationSec: number;
  rampUpSec: number;
  thinkTimeMs: number;
  /** Cap on requests started per second across all VUs (0 = none). */
  maxRps: number;
  count4xxAsErrors?: boolean;
  thresholds?: LoadTestThresholds;
}

export const LOAD_TEST_BOUNDS = {
  vus: { min: 1, max: 1000 },
  durationSec: { min: 5, max: 3600 },
  rampUpSec: { min: 0, max: 600 },
  thinkTimeMs: { min: 0, max: 60_000 },
  maxRps: { min: 0, max: 10_000 },
  timeoutMs: 30_000,
} as const;

export function loadTestConfigProblem(c: LoadTestConfig, limits: { maxVus: number; maxSeconds: number; maxRps: number }): string | null {
  const int = (v: unknown) => typeof v === "number" && Number.isInteger(v);
  if (!int(c.vus) || c.vus < 1) return "Use at least 1 virtual user";
  if (c.vus > limits.maxVus) return `Your plan allows up to ${limits.maxVus} virtual users`;
  if (!int(c.durationSec) || c.durationSec < LOAD_TEST_BOUNDS.durationSec.min) return `Run for at least ${LOAD_TEST_BOUNDS.durationSec.min} seconds`;
  if (c.durationSec > limits.maxSeconds) return `Your plan allows tests up to ${limits.maxSeconds} seconds`;
  if (!int(c.rampUpSec) || c.rampUpSec < 0 || c.rampUpSec > c.durationSec) return "The ramp-up must be between 0 and the test's duration";
  if (!int(c.thinkTimeMs) || c.thinkTimeMs < 0 || c.thinkTimeMs > LOAD_TEST_BOUNDS.thinkTimeMs.max) return "Think time must be between 0 and 60,000 ms";
  if (!int(c.maxRps) || c.maxRps < 0) return "The request rate cap must be 0 (your plan's limit) or more";
  if (limits.maxRps > 0 && c.maxRps > limits.maxRps) return `Your plan allows up to ${limits.maxRps} requests per second`;
  if (!c.request || typeof c.request.url !== "string" || !c.request.url) return "Pick a target URL";
  if (c.request.body !== undefined && c.request.body.length > 100_000) return "The body can be up to 100 KB";
  return null;
}

/** Virtual users active at `elapsedMs`: linear ramp to `vus` over the ramp-up. */
export function vusAt(c: Pick<LoadTestConfig, "vus" | "rampUpSec">, elapsedMs: number): number {
  if (c.rampUpSec <= 0) return c.vus;
  return Math.max(1, Math.min(c.vus, Math.ceil((c.vus * elapsedMs) / (c.rampUpSec * 1000))));
}

export interface LoadSample {
  status: number;
  ms: number;
  /** Network failure (no response); `status` is 0. */
  error?: string;
  bytes?: number;
}

export interface LoadTimelinePoint {
  /** Seconds since the start. */
  t: number;
  vus: number;
  requests: number;
  errors: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
}

export interface LoadTestSummary {
  requests: number;
  durationSec: number;
  rps: number;
  errors: number;
  errorRate: number;
  bytes: number;
  statuses: Record<string, number>;
  /** Network errors by message (connection refused, timeout…). */
  failures: Record<string, number>;
  latency: LatencySummary;
  maxVus: number;
  thresholds: Array<{ name: string; limit: number; actual: number; pass: boolean }>;
  passed: boolean;
  /** Stopped before the planned duration (cancelled or a limit). */
  stoppedEarly?: string;
}

const isError = (s: LoadSample, count4xx: boolean) => !!s.error || s.status >= 500 || s.status === 0 || (count4xx && s.status >= 400);

export function evaluateThresholds(t: LoadTestThresholds | undefined, s: Pick<LoadTestSummary, "latency" | "errorRate" | "rps">): LoadTestSummary["thresholds"] {
  if (!t) return [];
  const out: LoadTestSummary["thresholds"] = [];
  if (t.p95Ms !== undefined) out.push({ name: "p95 latency (ms) <", limit: t.p95Ms, actual: s.latency.p95, pass: s.latency.p95 < t.p95Ms });
  if (t.p99Ms !== undefined) out.push({ name: "p99 latency (ms) <", limit: t.p99Ms, actual: s.latency.p99, pass: s.latency.p99 < t.p99Ms });
  if (t.avgMs !== undefined) out.push({ name: "average latency (ms) <", limit: t.avgMs, actual: s.latency.avg, pass: s.latency.avg < t.avgMs });
  if (t.errorRatePct !== undefined) out.push({ name: "error rate (%) ≤", limit: t.errorRatePct, actual: s.errorRate, pass: s.errorRate <= t.errorRatePct });
  if (t.minRps !== undefined) out.push({ name: "requests per second ≥", limit: t.minRps, actual: s.rps, pass: s.rps >= t.minRps });
  return out;
}

/** Collects samples into per-second points and the overall summary. */
export class LoadRecorder {
  private readonly total = new LatencyHistogram();
  private second = new LatencyHistogram();
  private cur: Omit<LoadTimelinePoint, "p50" | "p95" | "p99" | "avg"> = { t: 1, vus: 0, requests: 0, errors: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
  readonly timeline: LoadTimelinePoint[] = [];
  readonly statuses: Record<string, number> = {};
  readonly failures: Record<string, number> = {};
  requests = 0;
  errors = 0;
  bytes = 0;
  maxVus = 0;

  constructor(private readonly count4xx = false) {}

  add(s: LoadSample): void {
    this.requests++;
    this.cur.requests++;
    this.bytes += s.bytes ?? 0;
    if (s.error) this.failures[s.error] = (this.failures[s.error] ?? 0) + 1;
    else this.statuses[String(s.status)] = (this.statuses[String(s.status)] ?? 0) + 1;
    if (isError(s, this.count4xx)) {
      this.errors++;
      this.cur.errors++;
    }
    const cls = Math.floor(s.status / 100);
    if (cls === 2) this.cur.s2xx++;
    else if (cls === 3) this.cur.s3xx++;
    else if (cls === 4) this.cur.s4xx++;
    else if (cls === 5) this.cur.s5xx++;
    // Latency of answered requests only: a refused connection is not "fast".
    if (!s.error) {
      this.total.add(s.ms);
      this.second.add(s.ms);
    }
  }

  /** Closes the current second (called once a second); returns the point. */
  tick(t: number, vus: number): LoadTimelinePoint {
    this.maxVus = Math.max(this.maxVus, vus);
    const sum = this.second.summary();
    const point: LoadTimelinePoint = { ...this.cur, t, vus, p50: sum.p50, p95: sum.p95, p99: sum.p99, avg: sum.avg };
    this.timeline.push(point);
    this.second = new LatencyHistogram();
    this.cur = { t: t + 1, vus, requests: 0, errors: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
    return point;
  }

  /** Requests that finished after the last tick (in flight at the end) join the last second. */
  foldRemainder(): void {
    const last = this.timeline[this.timeline.length - 1];
    if (!last || !this.cur.requests) return;
    for (const k of ["requests", "errors", "s2xx", "s3xx", "s4xx", "s5xx"] as const) last[k] += this.cur[k];
    this.cur = { ...this.cur, requests: 0, errors: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
  }

  summary(durationSec: number, thresholds?: LoadTestThresholds, stoppedEarly?: string): LoadTestSummary {
    const latency = this.total.summary();
    const rps = durationSec > 0 ? Math.round((this.requests / durationSec) * 10) / 10 : 0;
    const errorRate = this.requests ? Math.round((this.errors / this.requests) * 1000) / 10 : 0;
    const t = evaluateThresholds(thresholds, { latency, errorRate, rps });
    return {
      requests: this.requests,
      durationSec: Math.round(durationSec * 10) / 10,
      rps,
      errors: this.errors,
      errorRate,
      bytes: this.bytes,
      statuses: this.statuses,
      failures: this.failures,
      latency,
      maxVus: this.maxVus,
      thresholds: t,
      passed: t.every((x) => x.pass),
      ...(stoppedEarly ? { stoppedEarly } : {}),
    };
  }
}

export interface RunLoadOptions {
  config: LoadTestConfig;
  /** Sends one request; resolves with what happened (never rejects). */
  send: () => Promise<LoadSample>;
  /** Once a second, with the closed point (for live progress). */
  onTick?: (p: LoadTimelinePoint, rec: LoadRecorder) => void | Promise<void>;
  /** Checked once a second; a string stops the test with that reason. */
  shouldStop?: () => string | null | Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Runs a load test: VU loops start as the ramp allows, each sending, then
 * thinking, until the duration ends. With maxRps, a shared token bucket paces
 * request starts. In-flight requests finish (or time out) after the end and
 * still count.
 */
export async function runLoadTest(o: RunLoadOptions): Promise<{ summary: LoadTestSummary; timeline: LoadTimelinePoint[] }> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const c = o.config;
  const rec = new LoadRecorder(!!c.count4xxAsErrors);
  const start = now();
  const endAt = start + c.durationSec * 1000;
  let stopped: string | null = null;
  let active = 0;

  // Token bucket for maxRps: refills continuously, starts with one token and
  // bursts at most a tenth of a second, so the cap holds over any second.
  const burst = Math.max(1, Math.ceil(c.maxRps / 10));
  let tokens = c.maxRps > 0 ? 1 : Infinity;
  let lastRefill = start;
  const take = async () => {
    if (c.maxRps <= 0) return true;
    for (;;) {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - lastRefill) / 1000) * c.maxRps);
      lastRefill = t;
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      if (stopped || t >= endAt) return false;
      await sleep(Math.max(1, Math.ceil(((1 - tokens) / c.maxRps) * 1000)));
    }
  };

  const vu = async () => {
    active++;
    try {
      while (!stopped && now() < endAt) {
        if (!(await take())) break;
        rec.add(await o.send());
        if (c.thinkTimeMs > 0 && !stopped && now() < endAt) await sleep(c.thinkTimeMs);
      }
    } finally {
      active--;
    }
  };

  const loops: Promise<void>[] = [];
  let started = 0;
  let second = 1;
  const spawn = () => {
    const want = vusAt(c, now() - start);
    while (started < want && !stopped && now() < endAt) {
      started++;
      loops.push(vu());
    }
  };
  spawn();
  while (!stopped && now() < endAt) {
    const nextTick = start + second * 1000;
    // Spawn as the ramp allows, at most every 100 ms.
    while (now() < Math.min(nextTick, endAt) && !stopped) {
      await sleep(Math.min(100, Math.max(1, Math.min(nextTick, endAt) - now())));
      spawn();
    }
    if (now() >= nextTick || now() >= endAt) {
      const p = rec.tick(second, active);
      await o.onTick?.(p, rec);
      second++;
      const why = await o.shouldStop?.();
      if (why) stopped = why;
    }
  }
  await Promise.all(loops);
  // Requests that finished after the last tick count in the last second.
  if (rec.timeline.length) rec.foldRemainder();
  else await o.onTick?.(rec.tick(1, 0), rec);
  const elapsed = Math.min(now() - start, c.durationSec * 1000 + LOAD_TEST_BOUNDS.timeoutMs) / 1000;
  return { summary: rec.summary(stopped ? elapsed : c.durationSec, c.thresholds, stopped ?? undefined), timeline: rec.timeline };
}

export interface LoadComparison {
  metric: string;
  a: number;
  b: number;
  /** Percent change from a to b; null when a is 0. */
  change: number | null;
  /** Whether b is better than a for this metric. */
  better: boolean | null;
}

/** Side by side of two runs: latency, throughput and errors, with which side is better. */
export function compareLoadTests(a: LoadTestSummary, b: LoadTestSummary): LoadComparison[] {
  const rows: Array<[string, number, number, "lower" | "higher"]> = [
    ["Requests per second", a.rps, b.rps, "higher"],
    ["Average (ms)", a.latency.avg, b.latency.avg, "lower"],
    ["p50 (ms)", a.latency.p50, b.latency.p50, "lower"],
    ["p90 (ms)", a.latency.p90, b.latency.p90, "lower"],
    ["p95 (ms)", a.latency.p95, b.latency.p95, "lower"],
    ["p99 (ms)", a.latency.p99, b.latency.p99, "lower"],
    ["Max (ms)", a.latency.max, b.latency.max, "lower"],
    ["Error rate (%)", a.errorRate, b.errorRate, "lower"],
    ["Requests", a.requests, b.requests, "higher"],
  ];
  return rows.map(([metric, x, y, dir]) => ({
    metric,
    a: x,
    b: y,
    change: x ? Math.round(((y - x) / x) * 1000) / 10 : null,
    better: x === y ? null : dir === "lower" ? y < x : y > x,
  }));
}

// ── Monitors ─────────────────────────────────────────────────────────────────

export const MONITOR_INTERVALS = [1, 5, 10, 15, 30, 60] as const;

export interface MonitorResultLike {
  at: Date;
  ok: boolean;
  durationMs: number;
}

export interface UptimeSummary {
  checks: number;
  ok: number;
  uptime: number | null;
  avgMs: number | null;
  /** Per bucket: share of checks that passed (null = no check), oldest first. */
  bars: Array<{ from: string; checks: number; ok: number; uptime: number | null; avgMs: number | null }>;
}

export function uptimeSummary(results: readonly MonitorResultLike[], from: Date, to: Date, buckets: number): UptimeSummary {
  const span = (to.getTime() - from.getTime()) / buckets;
  const bars = Array.from({ length: buckets }, (_, i) => ({ from: new Date(from.getTime() + i * span).toISOString(), checks: 0, ok: 0, ms: 0 }));
  let ok = 0;
  let ms = 0;
  let n = 0;
  for (const r of results) {
    const t = r.at.getTime();
    if (t < from.getTime() || t > to.getTime()) continue;
    n++;
    if (r.ok) ok++;
    ms += r.durationMs;
    const b = bars[Math.min(buckets - 1, Math.floor((t - from.getTime()) / span))];
    b.checks++;
    if (r.ok) b.ok++;
    b.ms += r.durationMs;
  }
  return {
    checks: n,
    ok,
    uptime: n ? Math.round((ok / n) * 10000) / 100 : null,
    avgMs: n ? Math.round(ms / n) : null,
    bars: bars.map((b) => ({ from: b.from, checks: b.checks, ok: b.ok, uptime: b.checks ? Math.round((b.ok / b.checks) * 1000) / 10 : null, avgMs: b.checks ? Math.round(b.ms / b.checks) : null })),
  };
}

/** The next run of a monitor: aligned to its interval, never in the past. */
export function nextMonitorRun(intervalMinutes: number, after: number): Date {
  const step = intervalMinutes * 60_000;
  return new Date(Math.floor(after / step) * step + step);
}
