// apps/hub/src/services/Inbox.service.ts
//
// Webhook inbox (rules: packages/shared/src/inbox.ts). Two jobs:
//
//   store   HttpTunnel.handler calls tryStore() when a write request arrives
//           for a tunnel whose agent is offline and whose inbox is on.
//   deliver When the tunnel's agent registers (Message.router), on an API
//           request (/internal/inbox/drain) and on a 30 s sweep, queued
//           requests are sent oldest first by the hub to itself over
//           loopback, so delivery takes exactly the path live traffic takes.
//           One tunnel drains at a time per process; rows are claimed with a
//           conditional update, so two hubs never deliver the same row.
//
// Order: a retryable failure (the app's 5xx) stops the tunnel's drain until
// that row's next attempt, so later webhooks never overtake an earlier one.

import http from 'http';
import {
  deliveryOutcome,
  HUB_ERROR_HEADER,
  INBOX_DELIVERY_HEADER,
  INBOX_RETENTION_DAYS,
  PLAN_LIMITS,
  readSetting,
  type PlanLimits,
} from '@vhyxvoid/shared';

const CONFIG_TTL_MS = 30_000;
const SWEEP_MS = 30_000;
const CLEANUP_MS = 60 * 60_000;
const STUCK_DELIVERING_MS = 2 * 60_000;
const DELIVERY_TIMEOUT_MS = 60_000;

type Prisma = any; // the generated client (apps/api owns the schema)

export interface InboxDeps {
  prisma: Prisma;
  limits: { findPlanLimitsForAccount(accountId: string): Promise<Partial<PlanLimits> & { plan: keyof typeof PLAN_LIMITS }> };
  isConnected(accountId: string, label: string): boolean;
  hubPort: number;
  hubDomain: string;
  secret: () => string | undefined;
  now?: () => number;
  /** Sends one stored request; injectable for tests. */
  send?: (req: DeliveryRequest) => Promise<{ status: number | null; hubError: string | null }>;
}

export interface DeliveryRequest {
  host: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Buffer | null;
  inboxId: string;
}

export type StoreResult = { stored: true; id: string } | { stored: false; reason: 'disabled' | 'full' };

export class InboxService {
  private readonly config = new Map<string, { enabled: boolean; keep: number; expiresAt: number }>();
  private readonly slugs = new Map<string, { accountId: string | null; expiresAt: number }>();
  private readonly draining = new Set<string>();
  private readonly again = new Set<string>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: InboxDeps) {
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    this.sweepTimer ??= setInterval(() => void this.sweep().catch(() => {}), SWEEP_MS);
    this.cleanupTimer ??= setInterval(() => void this.cleanup().catch(() => {}), CLEANUP_MS);
    this.sweepTimer.unref?.();
    this.cleanupTimer.unref?.();
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.sweepTimer = this.cleanupTimer = null;
  }

  private key(accountId: string, label: string) {
    return `${accountId}\u0000${label}`;
  }

  /** accountId for a URL's account slug (cached; null when unknown). */
  async accountIdForSlug(slug: string): Promise<string | null> {
    const hit = this.slugs.get(slug);
    if (hit && hit.expiresAt > this.now()) return hit.accountId;
    const row = await this.deps.prisma.account.findUnique({ where: { slug }, select: { id: true, status: true } });
    const accountId = row && row.status !== 'DELETED' ? (row.id as string) : null;
    this.slugs.set(slug, { accountId, expiresAt: this.now() + CONFIG_TTL_MS * 2 });
    return accountId;
  }

  /** Inbox switched on for this tunnel, and how many requests it may hold. */
  async configFor(accountId: string, label: string): Promise<{ enabled: boolean; keep: number }> {
    const k = this.key(accountId, label);
    const hit = this.config.get(k);
    if (hit && hit.expiresAt > this.now()) return hit;
    const [row, limits, globallyOn] = await Promise.all([
      this.deps.prisma.tunnelInbox.findUnique({ where: { accountId_label: { accountId, label } }, select: { enabled: true } }),
      this.deps.limits.findPlanLimitsForAccount(accountId),
      readSetting('features.webhookInbox'),
    ]);
    const raw = limits.inboxRequests ?? PLAN_LIMITS[limits.plan]?.inboxRequests ?? 0;
    const keep = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 100_000;
    const value = { enabled: Boolean(globallyOn) && Boolean(row?.enabled) && keep > 0, keep, expiresAt: this.now() + CONFIG_TTL_MS };
    this.config.set(k, value);
    return value;
  }

  invalidate(accountId: string, label?: string): void {
    if (label) this.config.delete(this.key(accountId, label));
    else for (const k of this.config.keys()) if (k.startsWith(`${accountId}\u0000`)) this.config.delete(k);
  }

  async tryStore(
    accountId: string,
    label: string,
    req: { method: string; path: string; headers: Record<string, string>; body: Buffer | null },
  ): Promise<StoreResult> {
    const cfg = await this.configFor(accountId, label);
    if (!cfg.enabled) return { stored: false, reason: 'disabled' };
    const waiting = await this.deps.prisma.inboxRequest.count({
      where: { accountId, label, status: { in: ['QUEUED', 'DELIVERING'] } },
    });
    if (waiting >= cfg.keep) return { stored: false, reason: 'full' };
    const row = await this.deps.prisma.inboxRequest.create({
      data: {
        accountId,
        label,
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: req.body && req.body.length ? req.body : null,
        bodySize: req.body?.length ?? 0,
      },
      select: { id: true },
    });
    return { stored: true, id: row.id };
  }

  /** Deliver soon (agent just registered); no-op when there is nothing queued. */
  drainSoon(accountId: string, label: string, delayMs = 500): void {
    const t = setTimeout(() => void this.drain(accountId, label).catch(() => {}), delayMs);
    t.unref?.();
  }

  /** Deliver queued requests of one tunnel, oldest first. Returns how many were delivered. */
  async drain(accountId: string, label: string): Promise<number> {
    const k = this.key(accountId, label);
    if (this.draining.has(k)) {
      this.again.add(k);
      return 0;
    }
    this.draining.add(k);
    let delivered = 0;
    try {
      do {
        this.again.delete(k);
        delivered += await this.drainOnce(accountId, label);
      } while (this.again.has(k));
    } finally {
      this.draining.delete(k);
    }
    return delivered;
  }

  private async drainOnce(accountId: string, label: string): Promise<number> {
    const p = this.deps.prisma;
    const account = await p.account.findUnique({ where: { id: accountId }, select: { slug: true } });
    if (!account?.slug) return 0;
    const host = `${account.slug}--${label}.${this.deps.hubDomain}`;
    let delivered = 0;

    for (;;) {
      if (!this.deps.isConnected(accountId, label)) return delivered;
      const next = await p.inboxRequest.findFirst({
        where: { accountId, label, status: 'QUEUED' },
        orderBy: { receivedAt: 'asc' },
      });
      // Oldest first: when the oldest is waiting for its retry time, everything behind it waits too.
      if (!next || new Date(next.nextAttemptAt).getTime() > this.now()) return delivered;

      const attemptsBefore: number = next.attempts;
      const claimed = await p.inboxRequest.updateMany({
        where: { id: next.id, status: 'QUEUED' },
        data: { status: 'DELIVERING', attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue; // another hub took it

      const attempts = attemptsBefore + 1;
      let result: { status: number | null; hubError: string | null };
      try {
        result = await (this.deps.send ?? ((r) => this.sendLoopback(r)))({
          host,
          method: next.method,
          path: next.path,
          headers: (next.headers ?? {}) as Record<string, string>,
          body: next.body ? Buffer.from(next.body) : null,
          inboxId: next.id,
        });
      } catch (err) {
        result = { status: null, hubError: (err as Error).message };
      }

      const outcome = deliveryOutcome(result.status, result.hubError, attempts, this.now());
      if (outcome.state === 'DELIVERED') {
        await p.inboxRequest.update({
          where: { id: next.id },
          data: { status: 'DELIVERED', responseStatus: result.status, deliveredAt: new Date(this.now()), lastError: null },
        });
        delivered++;
        continue;
      }
      if (outcome.state === 'FAILED') {
        await p.inboxRequest.update({ where: { id: next.id }, data: { status: 'FAILED', responseStatus: result.status, lastError: outcome.reason } });
        continue;
      }
      if (outcome.state === 'RETRY') {
        await p.inboxRequest.update({
          where: { id: next.id },
          data: { status: 'QUEUED', responseStatus: result.status, lastError: outcome.reason, nextAttemptAt: outcome.nextAttemptAt },
        });
        return delivered;
      }
      // PAUSED: the tunnel went away; this was not a real attempt.
      await p.inboxRequest.update({ where: { id: next.id }, data: { status: 'QUEUED', attempts: attemptsBefore, lastError: outcome.reason } });
      return delivered;
    }
  }

  /** Retries due, deliveries interrupted by a crash, tunnels that came back on another path. */
  async sweep(): Promise<void> {
    const p = this.deps.prisma;
    await p.inboxRequest.updateMany({
      where: { status: 'DELIVERING', updatedAt: { lt: new Date(this.now() - STUCK_DELIVERING_MS) } },
      data: { status: 'QUEUED' },
    });
    const due: Array<{ accountId: string; label: string }> = await p.inboxRequest.findMany({
      where: { status: 'QUEUED', nextAttemptAt: { lte: new Date(this.now()) } },
      distinct: ['accountId', 'label'],
      select: { accountId: true, label: true },
      take: 500,
    });
    for (const t of due) if (this.deps.isConnected(t.accountId, t.label)) await this.drain(t.accountId, t.label).catch(() => 0);
  }

  async cleanup(): Promise<number> {
    const res = await this.deps.prisma.inboxRequest.deleteMany({
      where: { receivedAt: { lt: new Date(this.now() - INBOX_RETENTION_DAYS * 86_400_000) } },
    });
    return res.count;
  }

  private sendLoopback(r: DeliveryRequest): Promise<{ status: number | null; hubError: string | null }> {
    const secret = this.deps.secret();
    if (!secret) return Promise.resolve({ status: null, hubError: 'HUB_INTERNAL_SECRET is not set' });
    const headers: Record<string, string | number> = {
      ...r.headers,
      host: r.host,
      'x-vhyxvoid-internal': secret,
      [INBOX_DELIVERY_HEADER]: r.inboxId,
    };
    if (r.body) headers['content-length'] = r.body.length;
    return new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: this.deps.hubPort, method: r.method, path: r.path, headers, timeout: DELIVERY_TIMEOUT_MS },
        (res) => {
          res.resume();
          res.on('end', () => {
            const hubError = res.headers[HUB_ERROR_HEADER];
            resolve({ status: res.statusCode ?? null, hubError: typeof hubError === 'string' ? hubError : null });
          });
          res.on('error', () => resolve({ status: null, hubError: 'Connection lost' }));
        },
      );
      req.on('timeout', () => req.destroy(new Error('Delivery timed out')));
      req.on('error', (err) => resolve({ status: null, hubError: err.message }));
      req.end(r.body ?? undefined);
    });
  }
}
