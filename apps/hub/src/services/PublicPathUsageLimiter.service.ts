// apps/hub/src/services/PublicPathUsageLimiter.service.ts
//
// Per-account limiting for the public tunnel-URL path (E3), which has no
// API key at all — callers are webhook providers, browsers, and teammates
// hitting a shared URL. See shared/decision.md, 2026-09-22, "S5
// investigation and proposal", Part 2.
//
// Two separate jobs, deliberately not one:
//
//   1. A real-time per-minute abuse limiter, checked synchronously on every
//      request before it's forwarded. In-process only — no Redis command
//      per request, since the hub runs as a single instance today
//      (HubPubSub/multi-hub is a confirmed stub) and public-path traffic
//      (unsigned webhooks, browsers) is exactly what Upstash's per-command
//      billing would punish hardest if this went to Redis on every request.
//
//   2. A batched monthly usage counter feeding the SAME Redis/Postgres
//      pipeline the keyed SDK path already uses (HubUsageService ->
//      apps/api's FlushUsageWorker -> UsageAggregate), via
//      PUBLIC_USAGE_SENTINEL standing in for apiKeyId. Accumulated
//      in-process and flushed on an interval, one INCRBY per account with a
//      nonzero delta rather than one per request — this counter is
//      explicitly soft (decision.md, 2026-09-22, "Answers to the E1-E7
//      open questions" #6, maxRequestsPerMonth is counted and shown, not
//      enforced), so losing a few seconds of counts on a hub crash is an
//      acceptable trade for the much lower Redis command volume.
//
// Plan limits are looked up once per account per PLAN_CACHE_TTL_MS and
// cached in-process — never per request. A failed lookup falls back to the
// PRO number, logged, matching the identical failure mode S3 chose for the
// hub's agent-limit check (Message.router.ts's resolveAgentLimit): not
// unlimited (would silently defeat the limiter on a DB blip) and not
// refuse-everything (nothing about the specific request caused the
// failure).

import { Plan, PLAN_LIMITS, PUBLIC_USAGE_SENTINEL } from '@vhyxvoid/shared';
import type { TunnelSessionRepository } from '@/repositories/TunnelSession.repository';
import type { HubUsageService } from '@/services/HubUsage.service';

const FLUSH_INTERVAL_MS = 30_000;
const PLAN_CACHE_TTL_MS = 60_000;

export interface PublicPathRateLimitResult {
  allowed: boolean;
  limitPerMinute: number;
  retryAfterSeconds: number;
}

export class PublicPathUsageLimiter {
  private timer: NodeJS.Timeout | null = null;
  private readonly planCache = new Map<
    string,
    { limitPerMinute: number; expiresAt: number }
  >();
  private readonly minuteCounters = new Map<
    string,
    { bucket: string; count: number }
  >();
  private readonly monthlyAccumulator = new Map<string, number>();

  constructor(
    private readonly sessionRepo: TunnelSessionRepository,
    private readonly usageService: HubUsageService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Call once per incoming public-path request, before forwarding. Records
   * the request toward the monthly counter only when it's allowed through —
   * a 429'd request never reached an agent, so it shouldn't count against
   * the account's tunnel usage.
   */
  async checkRequest(accountId: string): Promise<PublicPathRateLimitResult> {
    const limitPerMinute = await this.getRateLimitPerMinute(accountId);

    if (limitPerMinute === Infinity) {
      this.recordMonthlyUsage(accountId);
      return { allowed: true, limitPerMinute, retryAfterSeconds: 0 };
    }

    const bucket = currentMinuteBucket();
    let entry = this.minuteCounters.get(accountId);
    if (!entry || entry.bucket !== bucket) {
      entry = { bucket, count: 0 };
      this.minuteCounters.set(accountId, entry);
    }
    entry.count++;

    if (entry.count > limitPerMinute) {
      return {
        allowed: false,
        limitPerMinute,
        retryAfterSeconds: secondsUntilNextMinute(),
      };
    }

    this.recordMonthlyUsage(accountId);
    return { allowed: true, limitPerMinute, retryAfterSeconds: 0 };
  }

  /**
   * Flush the in-process monthly accumulator into Redis — one INCRBY per
   * account with a nonzero delta, not one per request. Exposed (not just
   * called from the interval) so tests can flush deterministically instead
   * of waiting on a real 30s timer.
   */
  flush(): void {
    for (const [accountId, delta] of this.monthlyAccumulator) {
      if (delta > 0) {
        this.usageService.increment(
          accountId,
          PUBLIC_USAGE_SENTINEL,
          'requests',
          delta,
        );
      }
    }
    this.monthlyAccumulator.clear();
  }

  private recordMonthlyUsage(accountId: string): void {
    this.monthlyAccumulator.set(
      accountId,
      (this.monthlyAccumulator.get(accountId) ?? 0) + 1,
    );
  }

  private async getRateLimitPerMinute(accountId: string): Promise<number> {
    const cached = this.planCache.get(accountId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.limitPerMinute;

    try {
      const { plan } = await this.sessionRepo.findPlanLimitsForAccount(accountId);
      const limitPerMinute = PLAN_LIMITS[plan].publicPathRateLimitPerMinute;
      this.planCache.set(accountId, {
        limitPerMinute,
        expiresAt: now + PLAN_CACHE_TTL_MS,
      });
      return limitPerMinute;
    } catch (err) {
      console.error(
        { err: (err as Error).message, accountId },
        '[public-path-limiter] plan lookup failed; applying the PRO rate limit',
      );
      // Deliberately not cached — a DB hiccup should self-heal on the very
      // next request rather than pinning the fallback for a full TTL window.
      return PLAN_LIMITS[Plan.PRO].publicPathRateLimitPerMinute;
    }
  }
}

function currentMinuteBucket(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function secondsUntilNextMinute(): number {
  return 60 - new Date().getUTCSeconds();
}
