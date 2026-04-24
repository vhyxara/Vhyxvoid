// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/services/HubUsageService.ts
// Fire-and-forget usage counter. Never throws. Never blocks request path.
// Reuses the same Redis bucket pattern as RedisApiKeyCacheService.
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis as RedisT } from '@upstash/redis';

export class HubUsageService {
  constructor(private readonly redis: RedisT) {}

  /** Increment usage counter — fire and forget. */
  increment(
    accountId: string,
    keyId: string,
    metric: 'requests' | 'tunnel_minutes' | 'bandwidth_bytes',
    amount: number,
  ): void {
    const bucket = this.bucket5min();
    const redisKey = `usage:${accountId}:${keyId}:${metric}:${bucket}`;

    this.redis
      .incrby(redisKey, amount)
      .then((count) => {
        if (count === amount) {
          // First write — set TTL (25h covers flush window + buffer)
          return this.redis.expire(redisKey, 60 * 60 * 25);
        }
      })
      .catch(() => {}); // usage failure must never affect the tunnel
  }

  private bucket5min(): string {
    const d = new Date();
    const min = Math.floor(d.getUTCMinutes() / 5) * 5;
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(min)}`;
  }
}
