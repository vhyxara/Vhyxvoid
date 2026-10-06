// apps/hub/src/services/TunnelPolicyCache.service.ts
//
// Access rules per tunnel (TunnelPolicy rows), cached in-process so the
// public path does not query Postgres per request. "No rule" is cached too.
// apps/api calls /internal/policies/invalidate after a change, so edits apply
// at once on this instance; the TTL bounds staleness if that call is lost.
// A failed lookup denies (fail closed): a protected tunnel must not open up
// because the database blinked.

import type { TunnelPolicyRecord } from '@vhyxvoid/shared';

const TTL_MS = 30_000;

export interface TunnelPolicySource {
  findTunnelPolicy(accountId: string, label: string): Promise<TunnelPolicyRecord | null>;
}

export class PolicyLookupError extends Error {}

export class TunnelPolicyCache {
  private readonly cache = new Map<string, { policy: TunnelPolicyRecord | null; expiresAt: number }>();

  constructor(
    private readonly source: TunnelPolicySource,
    private readonly now: () => number = Date.now,
  ) {}

  private key(accountId: string, label: string) {
    return `${accountId}\u0000${label}`;
  }

  async get(accountId: string, label: string): Promise<TunnelPolicyRecord | null> {
    const k = this.key(accountId, label);
    const hit = this.cache.get(k);
    if (hit && hit.expiresAt > this.now()) return hit.policy;
    try {
      const policy = await this.source.findTunnelPolicy(accountId, label);
      this.cache.set(k, { policy, expiresAt: this.now() + TTL_MS });
      if (this.cache.size > 50_000) this.cache.delete(this.cache.keys().next().value as string);
      return policy;
    } catch (err) {
      throw new PolicyLookupError((err as Error).message);
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
