// apps/hub/src/services/RequestInspector.service.ts
//
// Writes captured public-tunnel requests for the dashboard's request
// inspector (layout, masking and limits: packages/shared/src/inspector.ts).
// Always after the response has been sent and never awaited by the request
// path: a Redis problem costs an inspector entry, never a tunnel request.
//
// How many requests to keep comes from the account's effective plan limit
// `inspectorRequests`, cached in-process for a minute like the public-path
// limiter's rate limit; `features.requestInspector` switches capture off for
// everyone.

import {
  readSetting,
  writeInspectedRequest,
  PLAN_LIMITS,
  type InspectedRequest,
  type InspectorRedisWriter,
  type PlanLimits,
} from '@vhyxvoid/shared';

const LIMIT_CACHE_TTL_MS = 60_000;

export interface InspectorLimitSource {
  findPlanLimitsForAccount(accountId: string): Promise<Partial<PlanLimits> & { plan: keyof typeof PLAN_LIMITS }>;
}

export class RequestInspectorService {
  private readonly cache = new Map<string, { keep: number; expiresAt: number }>();

  constructor(
    private readonly redis: InspectorRedisWriter,
    private readonly limits: InspectorLimitSource,
    private readonly now: () => number = Date.now,
  ) {}

  /** Requests to keep for this account's tunnels; 0 means do not capture. */
  async keepFor(accountId: string): Promise<number> {
    if (!(await readSetting('features.requestInspector'))) return 0;
    const cached = this.cache.get(accountId);
    if (cached && cached.expiresAt > this.now()) return cached.keep;
    try {
      const l = await this.limits.findPlanLimitsForAccount(accountId);
      const raw = l.inspectorRequests ?? PLAN_LIMITS[l.plan]?.inspectorRequests ?? 0;
      // "Unlimited" (Infinity) is capped: the list lives in Redis.
      const keep = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 5_000;
      this.cache.set(accountId, { keep, expiresAt: this.now() + LIMIT_CACHE_TTL_MS });
      return keep;
    } catch {
      return 0;
    }
  }

  /** Fire and forget. */
  record(accountId: string, entry: InspectedRequest): void {
    void this.keepFor(accountId)
      .then((keep) => writeInspectedRequest(this.redis, accountId, entry, keep))
      .catch((err) => {
        console.warn({ err: (err as Error).message, accountId }, '[inspector] capture not stored');
      });
  }
}
