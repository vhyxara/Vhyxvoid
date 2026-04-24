// ─────────────────────────────────────────────────────────────────────────────
// USAGE AGGREGATE ENTITY
// Persisted cold storage of usage data flushed from Redis.
// Never mutated after lockedAt is set (billing period finalized).
// ─────────────────────────────────────────────────────────────────────────────

import {
  UsageAggregateProps,
  UsageMetric,
} from "@/core/types/api-key.types/usage";

export class UsageAggregate {
  private constructor(private props: UsageAggregateProps) {}

  static create(params: {
    accountId: string;
    apiKeyId: string | null;
    metric: UsageMetric;
    periodStart: Date;
    periodEnd: Date;
    quantity: bigint;
  }): UsageAggregate {
    return new UsageAggregate({
      id: crypto.randomUUID(),
      accountId: params.accountId,
      apiKeyId: params.apiKeyId,
      metric: params.metric,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      quantity: params.quantity,
      reportedToStripe: false,
      stripeUsageRecordId: null,
      lockedAt: null,
      createdAt: new Date(),
    });
  }

  static rehydrate(props: UsageAggregateProps): UsageAggregate {
    return new UsageAggregate(props);
  }

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get apiKeyId(): string | null {
    return this.props.apiKeyId;
  }
  get metric(): UsageMetric {
    return this.props.metric;
  }
  get periodStart(): Date {
    return this.props.periodStart;
  }
  get periodEnd(): Date {
    return this.props.periodEnd;
  }
  get quantity(): bigint {
    return this.props.quantity;
  }
  get isLocked(): boolean {
    return this.props.lockedAt !== null;
  }
  get reportedToStripe(): boolean {
    return this.props.reportedToStripe;
  }

  incrementQuantity(amount: bigint): void {
    if (this.isLocked)
      throw new Error("Cannot modify a locked usage aggregate");
    this.props.quantity += amount;
  }

  markReportedToStripe(recordId: string): void {
    this.props.reportedToStripe = true;
    this.props.stripeUsageRecordId = recordId;
  }

  lock(now: Date): void {
    this.props.lockedAt = now;
  }

  toPersistence(): UsageAggregateProps {
    return { ...this.props };
  }
}
