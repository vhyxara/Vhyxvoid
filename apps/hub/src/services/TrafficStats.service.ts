// apps/hub/src/services/TrafficStats.service.ts
//
// Requests per tunnel per minute (requests, 4xx, 5xx, total time) for
// error-rate alerts and traffic charts. Counted in memory and written every
// FLUSH_MS as ONE upsert statement for all tunnels that had traffic, so the
// request path never waits on Postgres. Rows older than RETENTION_DAYS are
// deleted hourly. Counting is best effort: a crash loses up to FLUSH_MS.

const FLUSH_MS = 30_000;
const CLEANUP_MS = 60 * 60_000;
export const TUNNEL_STATS_RETENTION_DAYS = 7;
const MAX_ROWS_PER_FLUSH = 2_000;

type Prisma = any;

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
  record(accountId: string, label: string, status: number, durationMs: number): void {
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

  /** Writes and clears what was counted. Returns the number of rows written. */
  async flush(): Promise<number> {
    if (this.buckets.size === 0) return 0;
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
    return res.count;
  }
}
