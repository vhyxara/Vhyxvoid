// ─────────────────────────────────────────────────────────────────────────────
// AccountKeyCacheInvalidator
//
// Closes context.md Known Risk #57's E6 cache-staleness gap: an account's
// status reaches the hub/gateway only through each API key's `apikey:data:*`
// Redis entry (5-minute TTL), read at connection/request time — nothing
// invalidated it when the ACCOUNT's status changed (only per-key events did:
// rotate/update/revoke). So a webhook or the grace-period worker moving an
// account to PAST_DUE/ACTIVE/SUSPENDED/CANCELED could take up to 5 minutes to
// actually take effect.
//
// This is a thin coordinator, not a new cache layer: it resolves which keys
// belong to an account, then reuses ApiKeyCacheService's existing per-key
// invalidate() (already used by rotate/update/revoke) for each one — the
// Redis key format itself stays defined in exactly one place
// (RedisApiKeyCacheService), not duplicated here.
//
// Called from wherever Account.status actually changes: the Stripe webhook's
// handlers (via AccountBillingRepository) and GracePeriodWorker's
// suspension. See shared/decision.md, 2026-09-22, "S4".
// ─────────────────────────────────────────────────────────────────────────────

import { ApiKeyRepository } from "@/core/types/api-key/apiKeys.type";
import { ApiKeyCacheService } from "@/core/types/api-key/cacheservice.type";

export class AccountKeyCacheInvalidator {
  constructor(
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly cacheService: ApiKeyCacheService,
  ) {}

  /**
   * Fails soft — the status change itself has already committed to Postgres
   * by the time this runs (every caller does the DB write first); a Redis
   * failure here must never turn a successful status change into an error.
   * Worst case if this fails: the stale cache entry self-heals within its
   * own 5-minute TTL, same as before this existed.
   */
  async invalidate(accountId: string): Promise<void> {
    try {
      const keys = await this.apiKeyRepository.findAllByAccount(accountId);
      if (keys.length === 0) return;
      await this.cacheService.invalidateAllForAccount(keys.map((k) => k.keyId));
    } catch (err) {
      console.error(
        { accountId, err },
        "[billing] failed to invalidate account key cache after a status change",
      );
    }
  }
}
