// Traffic charts: turns per-minute tunnel stats (tunnel_minute_stats, written
// by the hub's TrafficStatsService) into evenly spaced buckets for a chart.
// Pure, so the API routes and the tests share one definition of a range.

export const TRAFFIC_RANGES = {
  "1h": { durationMs: 60 * 60_000, bucketMs: 60_000 }, // 60 bars of 1 minute
  "24h": { durationMs: 24 * 60 * 60_000, bucketMs: 15 * 60_000 }, // 96 bars of 15 minutes
  "7d": { durationMs: 7 * 24 * 60 * 60_000, bucketMs: 2 * 60 * 60_000 }, // 84 bars of 2 hours
} as const;

export type TrafficRange = keyof typeof TRAFFIC_RANGES;

export function isTrafficRange(v: unknown): v is TrafficRange {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TRAFFIC_RANGES, v);
}

/** One aggregated row as the database returns it (bucket start in epoch ms). */
export interface TrafficRow {
  t: number;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  totalMs: number;
}

export interface TrafficPoint {
  /** Bucket start, ISO 8601. */
  t: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  /** Mean duration in the bucket, weighted by request count; null without requests. */
  avgMs: number | null;
}

export interface TrafficTotals {
  requests: number;
  errors4xx: number;
  errors5xx: number;
  avgMs: number | null;
  /** 5xx share of requests in percent, one decimal; null without requests. */
  errorRate: number | null;
}

/** The window for a range ending now: bucket-aligned so bars never shift between refreshes. */
export function trafficWindow(range: TrafficRange, now = Date.now()): { from: number; to: number; bucketMs: number } {
  const { durationMs, bucketMs } = TRAFFIC_RANGES[range];
  const to = Math.floor(now / bucketMs) * bucketMs + bucketMs; // end of the current bucket
  return { from: to - durationMs, to, bucketMs };
}

/** Every bucket in [from, to), zero-filled where there was no traffic. */
export function fillTrafficSeries(rows: TrafficRow[], from: number, to: number, bucketMs: number): TrafficPoint[] {
  const byT = new Map<number, TrafficRow>();
  for (const r of rows) {
    const t = Math.floor(r.t / bucketMs) * bucketMs;
    const cur = byT.get(t);
    if (cur) {
      cur.requests += r.requests;
      cur.errors4xx += r.errors4xx;
      cur.errors5xx += r.errors5xx;
      cur.totalMs += r.totalMs;
    } else byT.set(t, { ...r, t });
  }
  const out: TrafficPoint[] = [];
  for (let t = from; t < to; t += bucketMs) {
    const r = byT.get(t);
    out.push({
      t: new Date(t).toISOString(),
      requests: r?.requests ?? 0,
      errors4xx: r?.errors4xx ?? 0,
      errors5xx: r?.errors5xx ?? 0,
      avgMs: r && r.requests > 0 ? Math.round(r.totalMs / r.requests) : null,
    });
  }
  return out;
}

export function trafficTotals(rows: Array<Pick<TrafficRow, "requests" | "errors4xx" | "errors5xx" | "totalMs">>): TrafficTotals {
  let requests = 0;
  let errors4xx = 0;
  let errors5xx = 0;
  let totalMs = 0;
  for (const r of rows) {
    requests += r.requests;
    errors4xx += r.errors4xx;
    errors5xx += r.errors5xx;
    totalMs += r.totalMs;
  }
  return {
    requests,
    errors4xx,
    errors5xx,
    avgMs: requests > 0 ? Math.round(totalMs / requests) : null,
    errorRate: requests > 0 ? Math.round((errors5xx / requests) * 1000) / 10 : null,
  };
}
