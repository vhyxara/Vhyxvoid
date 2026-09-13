import { UsageAggregate } from "@/modules/key-management/domain/entities/usage.entities";

export interface UsageAggregateProps {
  id: string;
  accountId: string;
  apiKeyId: string | null; // null = account-level rollup
  metric: UsageMetric;
  periodStart: Date;
  periodEnd: Date;
  quantity: bigint;

  reportedToStripe: boolean;
  stripeUsageRecordId: string | null;
  lockedAt: Date | null; // set after invoice finalization

  createdAt: Date;
}

export type UsageMetric = "requests" | "bandwidth_bytes" | "tunnel_minutes";

export interface UsagePeriod {
  start: Date;
  end: Date;
}

export interface UsageAggregateRepository {
  save(aggregate: UsageAggregate): Promise<void>;
  saveBatch(aggregates: UsageAggregate[]): Promise<void>;

  findByAccountAndPeriod(
    accountId: string,
    period: UsagePeriod,
    metric?: UsageMetric,
  ): Promise<UsageAggregate[]>;

  findByApiKeyAndPeriod(
    apiKeyId: string,
    period: UsagePeriod,
    metric?: UsageMetric,
  ): Promise<UsageAggregate[]>;

  /**
   * Upsert a usage aggregate — used by the flush worker.
   * Adds quantity to existing record if it exists for the same period.
   * Never mutates locked records.
   */
  upsertQuantity(params: {
    accountId: string;
    apiKeyId: string | null;
    metric: UsageMetric;
    periodStart: Date;
    periodEnd: Date;
    quantity: bigint;
  }): Promise<void>;

  lockPeriod(accountId: string, periodStart: Date): Promise<void>;
}
