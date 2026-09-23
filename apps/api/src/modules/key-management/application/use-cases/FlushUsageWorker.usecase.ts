// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND WORKER USE CASES
// ─────────────────────────────────────────────────────────────────────────────

import { ApiKeyRepository } from "@/core/types/api-key/apiKeys.type";
import { ApiKeyCacheService } from "@/core/types/api-key/cacheservice.type";
import { UsageAggregateRepository } from "@/core/types/api-key/usage.type";

/**
 * Flush Redis usage counters → Postgres UsageAggregate.
 * Runs every 5 minutes via cron. Idempotent.
 */
export class FlushUsageWorker {
  constructor(
    private cacheService: ApiKeyCacheService,
    private usageRepository: UsageAggregateRepository,
    private apiKeyRepository: ApiKeyRepository,
  ) {}

  /**
   * Flush every account that actually has pending counters in Redis.
   *
   * Accounts come from Redis itself rather than from "accounts with an
   * ACTIVE key": an agent keeps serving public tunnel traffic after its key
   * is revoked or expires (the hub only re-checks account status on a live
   * connection), and the last few minutes of counts before a key goes
   * inactive would otherwise sit in Redis until their 25h TTL deletes them.
   *
   * `filterKnownAccounts` must return only the ids that exist in this
   * environment's database. Local dev and production share one Upstash
   * instance; draining another environment's account would delete its
   * counters and then fail the UsageAggregate foreign key here.
   */
  async runForPendingAccounts(
    filterKnownAccounts: (accountIds: string[]) => Promise<string[]>,
  ): Promise<void> {
    const pending = await this.cacheService.listAccountIdsWithPendingUsage();
    if (pending.length === 0) return;
    await this.run(await filterKnownAccounts(pending));
  }

  async run(accountIds: string[]): Promise<void> {
    for (const accountId of accountIds) {
      const counters = await this.cacheService.drainUsageCounters(accountId);

      if (counters.length === 0) continue;

      const BUCKET_MINUTES = 5;
      const periodEnd = new Date();

      for (const counter of counters) {
        const periodStart = new Date(
          counter.periodStart.getTime() -
            (counter.periodStart.getTime() % (BUCKET_MINUTES * 60_000)),
        );

        await this.usageRepository.upsertQuantity({
          accountId,
          apiKeyId: counter.apiKeyId,
          metric: counter.metric as any,
          periodStart,
          periodEnd,
          quantity: counter.quantity,
        });
      }
    }
  }
}
