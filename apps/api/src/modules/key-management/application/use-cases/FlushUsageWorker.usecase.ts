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
      const resolvedKeyIds = new Map<string, string | null>();

      for (const counter of counters) {
        const periodStart = new Date(
          counter.periodStart.getTime() -
            (counter.periodStart.getTime() % (BUCKET_MINUTES * 60_000)),
        );

        // The drain has already deleted these Redis keys, so a failed write
        // loses only this one counter — it must not abort every counter and
        // account after it in this tick.
        try {
          const apiKeyId =
            counter.apiKeyId === null
              ? null
              : await this.resolveApiKeyRowId(
                  accountId,
                  counter.apiKeyId,
                  resolvedKeyIds,
                );

          await this.usageRepository.upsertQuantity({
            accountId,
            apiKeyId,
            metric: counter.metric as any,
            periodStart,
            periodEnd,
            quantity: counter.quantity,
          });
        } catch (err) {
          console.error(
            {
              err: (err as Error).message,
              accountId,
              apiKeyId: counter.apiKeyId,
              metric: counter.metric,
              periodStart,
              quantity: counter.quantity.toString(),
            },
            "[FlushUsageWorker] failed to write a usage counter; it is lost",
          );
        }
      }
    }
  }

  /**
   * Redis counters carry the PUBLIC keyId (`vhyxvoid_dev_…`, what
   * ValidateApiKeyUseCase and the hub know), but UsageAggregate.apiKeyId is a
   * foreign key to ApiKey.id. Writing the public id straight through failed
   * that constraint on every keyed counter. A key that no longer resolves to
   * this account (deleted, or not this account's) falls back to the
   * account-level rollup (null) rather than dropping the count.
   */
  private async resolveApiKeyRowId(
    accountId: string,
    counterKeyId: string,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    if (cache.has(counterKeyId)) return cache.get(counterKeyId)!;

    const key =
      (await this.apiKeyRepository.findByKeyId(counterKeyId)) ??
      (await this.apiKeyRepository.findById(counterKeyId));
    const rowId = key && key.accountId === accountId ? key.id : null;
    if (rowId === null) {
      console.warn(
        { accountId, counterKeyId },
        "[FlushUsageWorker] usage counter's key not found for this account; recording it in the account-level rollup",
      );
    }
    cache.set(counterKeyId, rowId);
    return rowId;
  }
}
