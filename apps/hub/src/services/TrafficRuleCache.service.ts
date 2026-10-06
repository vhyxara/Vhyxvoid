// apps/hub/src/services/TrafficRuleCache.service.ts
//
// Traffic rules per tunnel (TunnelRuleSet rows), cached in-process like
// access rules: 30 s TTL, "no rules" cached too, dropped at once by the
// API's /internal/policies/invalidate call. Unlike access rules, a failed
// lookup means "no rules" (fail open): rules shape traffic for development,
// they are not a security boundary, and a database blip should not turn a
// tunnel into errors. `features.trafficRules` off ignores every rule.

import { readSetting, type TrafficRule } from '@vhyxvoid/shared';

const TTL_MS = 30_000;
const SLUG_TTL_MS = 60_000;

export interface TrafficRuleSource {
  findTrafficRules(accountId: string, label: string): Promise<TrafficRule[] | null>;
  findAccountIdBySlug(slug: string): Promise<string | null>;
}

export class TrafficRuleCache {
  private readonly cache = new Map<string, { rules: TrafficRule[]; expiresAt: number }>();
  private readonly slugs = new Map<string, { accountId: string | null; expiresAt: number }>();

  constructor(
    private readonly source: TrafficRuleSource,
    private readonly now: () => number = Date.now,
  ) {}

  private key(accountId: string, label: string) {
    return `${accountId}\u0000${label}`;
  }

  /** Enabled-or-not rules of a tunnel; [] when there are none, the feature is off, or the lookup failed. */
  async get(accountId: string, label: string): Promise<TrafficRule[]> {
    if (!(await readSetting('features.trafficRules'))) return [];
    const k = this.key(accountId, label);
    const hit = this.cache.get(k);
    if (hit && hit.expiresAt > this.now()) return hit.rules;
    try {
      const rules = (await this.source.findTrafficRules(accountId, label)) ?? [];
      this.cache.set(k, { rules, expiresAt: this.now() + TTL_MS });
      if (this.cache.size > 50_000) this.cache.delete(this.cache.keys().next().value as string);
      return rules;
    } catch (err) {
      console.warn({ err: (err as Error).message, accountId, label }, '[rules] lookup failed; forwarding without rules');
      return [];
    }
  }

  /** Account of a tunnel URL whose agent is not registered (offline rules). */
  async accountIdForSlug(slug: string): Promise<string | null> {
    const hit = this.slugs.get(slug);
    if (hit && hit.expiresAt > this.now()) return hit.accountId;
    try {
      const accountId = await this.source.findAccountIdBySlug(slug);
      this.slugs.set(slug, { accountId, expiresAt: this.now() + SLUG_TTL_MS });
      if (this.slugs.size > 50_000) this.slugs.delete(this.slugs.keys().next().value as string);
      return accountId;
    } catch {
      return null;
    }
  }

  invalidate(accountId: string, label?: string): void {
    if (label) {
      this.cache.delete(this.key(accountId, label));
      return;
    }
    for (const k of this.cache.keys()) if (k.startsWith(`${accountId}\u0000`)) this.cache.delete(k);
  }
}
