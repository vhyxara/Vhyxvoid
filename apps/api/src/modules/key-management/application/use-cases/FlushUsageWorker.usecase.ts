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
    // One SCAN per tick; each account's drain reuses its slice of it.
    const keysByAccount =
      await this.cacheService.listPendingUsageKeysByAccount();
    if (keysByAccount.size === 0) return;
    await this.run(
      await filterKnownAccounts([...keysByAccount.keys()]),
      keysByAccount,
    );
  }

  async run(
    accountIds: string[],
    keysByAccount?: Map<string, string[]>,
  ): Promise<void> {
    for (const accountId of accountIds) {
      const counters = await this.cacheService.drainUsageCounters(
        accountId,
        keysByAccount?.get(accountId),
      );

      if (counters.length === 0) continue;

      const BUCKET_MS = 5 * 60_000;
      const resolvedKeyIds = new Map<string, string | null>();

      for (const counter of counters) {
        const periodStart = new Date(
          counter.periodStart.getTime() -
            (counter.periodStart.getTime() % BUCKET_MS),
        );
        // The bucket's own end, not the flush time: a later flush into the
        // same bucket then agrees with the first, and a window ending in the
        // past is answered correctly.
        const periodEnd = new Date(periodStart.getTime() + BUCKET_MS);

        // A failed write must not abort every counter and account after it
        // in this tick; its count goes back to Redis for the next tick.
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
          const restored =
            await this.cacheService.restoreUsageCounter(counter);
          console.error(
            {
              err: (err as Error).message,
              accountId,
              apiKeyId: counter.apiKeyId,
              metric: counter.metric,
              periodStart,
              quantity: counter.quantity.toString(),
            },
            restored
              ? "[FlushUsageWorker] failed to write a usage counter; put back in Redis for the next tick"
              : "[FlushUsageWorker] failed to write a usage counter; it is lost",
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
