// apps/hub/src/services/TrafficStats.service.ts
//
// Requests per tunnel per minute (requests, 4xx, 5xx, total time) for
// error-rate alerts and traffic charts. Counted in memory and written every
// FLUSH_MS as ONE upsert statement for all tunnels that had traffic, so the
// request path never waits on Postgres. Rows older than RETENTION_DAYS are
// deleted hourly. Counting is best effort: a crash loses up to FLUSH_MS.
//
// Per endpoint too (phase 4 analytics): method + route pattern ("/users/:id")
// per 5 minutes, with status classes and a latency histogram whose buckets
// add up in SQL, so percentiles survive merging. At most
// ENDPOINT_ROUTES_PER_TUNNEL distinct routes per tunnel per flush; the rest
// count as "(other)".

import {
  ENDPOINT_BUCKET_MS,
  ENDPOINT_HIST_SIZE,
  ENDPOINT_OTHER_ROUTE,
  ENDPOINT_ROUTES_PER_TUNNEL,
  ENDPOINT_STATS_RETENTION_DAYS,
  endpointHistIndex,
  routeOf,
} from '@vhyxvoid/shared';

const FLUSH_MS = 30_000;
const CLEANUP_MS = 60 * 60_000;
export const TUNNEL_STATS_RETENTION_DAYS = 7;
const MAX_ROWS_PER_FLUSH = 2_000;

type Prisma = any;

interface EndpointBucket {
  accountId: string;
  label: string;
  method: string;
  route: string;
  bucket: number;
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

interface Bucket {
  accountId: string;
  label: string;
  minute: number;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  totalMs: number;
}

export class TrafficStatsService {
  private buckets = new Map<string, Bucket>();
  private endpoints = new Map<string, EndpointBucket>();
  /** Routes counted per tunnel since the last flush (the cardinality cap). */
  private routes = new Map<string, Set<string>>();
  private flushTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: Prisma,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.flushTimer ??= setInterval(() => void this.flush().catch((err) => console.warn({ err: err.message }, '[stats] flush failed')), FLUSH_MS);
    this.cleanupTimer ??= setInterval(() => void this.cleanup().catch(() => {}), CLEANUP_MS);
    this.flushTimer.unref?.();
    this.cleanupTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.flushTimer = this.cleanupTimer = null;
    await this.flush().catch(() => {});
  }

  /** One finished request (the status the caller received). */
  record(accountId: string, label: string, status: number, durationMs: number, method?: string, path?: string): void {
    if (method && path) this.recordEndpoint(accountId, label, status, durationMs, method, path);
    const minute = Math.floor(this.now() / 60_000) * 60_000;
    const key = `${accountId}\u0000${label}\u0000${minute}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { accountId, label, minute, requests: 0, errors4xx: 0, errors5xx: 0, totalMs: 0 };
      this.buckets.set(key, b);
    }
    b.requests++;
    if (status >= 500) b.errors5xx++;
    else if (status >= 400) b.errors4xx++;
    b.totalMs += Math.max(0, Math.round(durationMs));
  }

  private recordEndpoint(accountId: string, label: string, status: number, durationMs: number, method: string, path: string): void {
    const tunnel = `${accountId}\u0000${label}`;
    let seen = this.routes.get(tunnel);
    if (!seen) this.routes.set(tunnel, (seen = new Set()));
    let route = routeOf(path);
    if (!seen.has(route)) {
      if (seen.size >= ENDPOINT_ROUTES_PER_TUNNEL) route = ENDPOINT_OTHER_ROUTE;
      else seen.add(route);
    }
    const m = method.toUpperCase().slice(0, 10);
    const bucket = Math.floor(this.now() / ENDPOINT_BUCKET_MS) * ENDPOINT_BUCKET_MS;
    const key = `${tunnel}\u0000${m}\u0000${route}\u0000${bucket}`;
    let e = this.endpoints.get(key);
    if (!e) {
      e = { accountId, label, method: m, route, bucket, requests: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, totalMs: 0, maxMs: 0, hist: new Array(ENDPOINT_HIST_SIZE).fill(0), sample: path.split('?')[0].slice(0, 500) };
      this.endpoints.set(key, e);
    }
    const ms = Math.max(0, Math.round(durationMs));
    e.requests++;
    if (status >= 500) e.s5xx++;
    else if (status >= 400) e.s4xx++;
    else if (status >= 300) e.s3xx++;
    else e.s2xx++;
    e.totalMs += ms;
    e.maxMs = Math.max(e.maxMs, ms);
    e.hist[endpointHistIndex(ms)]++;
  }

  /** Writes and clears what was counted. Returns the number of rows written. */
  async flush(): Promise<number> {
    const endpoints = await this.flushEndpoints();
    if (this.buckets.size === 0) return endpoints;
    const all = [...this.buckets.values()];
    this.buckets = new Map();
    let written = 0;
    for (let i = 0; i < all.length; i += MAX_ROWS_PER_FLUSH) {
      const chunk = all.slice(i, i + MAX_ROWS_PER_FLUSH);
      const values: unknown[] = [];
      const rows = chunk.map((b, j) => {
        const o = j * 7;
        values.push(b.accountId, b.label, new Date(b.minute), b.requests, b.errors4xx, b.errors5xx, BigInt(b.totalMs));
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`;
      });
      try {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "tunnel_minute_stats" ("accountId", "label", "minute", "requests", "errors4xx", "errors5xx", "totalMs")
           VALUES ${rows.join(', ')}
           ON CONFLICT ("accountId", "label", "minute") DO UPDATE SET
             "requests" = "tunnel_minute_stats"."requests" + EXCLUDED."requests",
             "errors4xx" = "tunnel_minute_stats"."errors4xx" + EXCLUDED."errors4xx",
             "errors5xx" = "tunnel_minute_stats"."errors5xx" + EXCLUDED."errors5xx",
             "totalMs" = "tunnel_minute_stats"."totalMs" + EXCLUDED."totalMs"`,
          ...values,
        );
        written += chunk.length;
      } catch (err) {
        // Put the counts back so the next flush retries them (bounded: a
        // database that stays down only loses what exceeds memory sanity).
        if (this.buckets.size < 100_000) for (const b of chunk) this.merge(b);
        throw err;
      }
    }
    return written + endpoints;
  }

  private async flushEndpoints(): Promise<number> {
    if (this.endpoints.size === 0) return 0;
    const all = [...this.endpoints.values()];
    this.endpoints = new Map();
    this.routes = new Map();
    let written = 0;
    const per = 13;
    for (let i = 0; i < all.length; i += 1000) {
      const chunk = all.slice(i, i + 1000);
      const values: unknown[] = [];
      const rows = chunk.map((e, j) => {
        const o = j * per;
        values.push(e.accountId, e.label, e.method, e.route, new Date(e.bucket), e.requests, e.s2xx, e.s3xx, e.s4xx, e.s5xx, BigInt(e.totalMs), e.maxMs, e.hist);
        return `(${Array.from({ length: per }, (_, k) => `$${o + k + 1}${k === per - 1 ? '::int[]' : ''}`).join(', ')}, $${chunk.length * per + j + 1})`;
      });
      values.push(...chunk.map((e) => e.sample));
      try {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "tunnel_endpoint_stats" ("accountId", "label", "method", "route", "bucket", "requests", "s2xx", "s3xx", "s4xx", "s5xx", "totalMs", "maxMs", "hist", "sample")
           VALUES ${rows.join(', ')}
           ON CONFLICT ("accountId", "label", "method", "route", "bucket") DO UPDATE SET
             "requests" = "tunnel_endpoint_stats"."requests" + EXCLUDED."requests",
             "s2xx" = "tunnel_endpoint_stats"."s2xx" + EXCLUDED."s2xx",
             "s3xx" = "tunnel_endpoint_stats"."s3xx" + EXCLUDED."s3xx",
             "s4xx" = "tunnel_endpoint_stats"."s4xx" + EXCLUDED."s4xx",
             "s5xx" = "tunnel_endpoint_stats"."s5xx" + EXCLUDED."s5xx",
             "totalMs" = "tunnel_endpoint_stats"."totalMs" + EXCLUDED."totalMs",
             "maxMs" = GREATEST("tunnel_endpoint_stats"."maxMs", EXCLUDED."maxMs"),
             "hist" = ARRAY(SELECT COALESCE(a, 0) + COALESCE(b, 0) FROM unnest("tunnel_endpoint_stats"."hist", EXCLUDED."hist") AS x(a, b))`,
          ...values,
        );
        written += chunk.length;
      } catch (err) {
        // Dropped rather than retried: endpoint analytics are best effort and
        // must never grow the hub's memory while the database is down.
        console.warn({ err: (err as Error).message, rows: chunk.length }, '[stats] endpoint flush failed');
      }
    }
    return written;
  }

  private merge(b: Bucket): void {
    const key = `${b.accountId}\u0000${b.label}\u0000${b.minute}`;
    const cur = this.buckets.get(key);
    if (!cur) this.buckets.set(key, { ...b });
    else {
      cur.requests += b.requests;
      cur.errors4xx += b.errors4xx;
      cur.errors5xx += b.errors5xx;
      cur.totalMs += b.totalMs;
    }
  }

  async cleanup(): Promise<number> {
    const res = await this.prisma.tunnelMinuteStat.deleteMany({
      where: { minute: { lt: new Date(this.now() - TUNNEL_STATS_RETENTION_DAYS * 86_400_000) } },
    });
    const ep = await this.prisma.tunnelEndpointStat.deleteMany({
      where: { bucket: { lt: new Date(this.now() - ENDPOINT_STATS_RETENTION_DAYS * 86_400_000) } },
    });
    return res.count + ep.count;
  }
}
