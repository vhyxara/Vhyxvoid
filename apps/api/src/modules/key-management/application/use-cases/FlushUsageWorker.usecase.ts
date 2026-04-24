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
