// ─────────────────────────────────────────────────────────────────────────────
// USAGE AGGREGATE REPOSITORY
// ─────────────────────────────────────────────────────────────────────────────

import {
  UsageAggregateProps,
  UsageMetric,
} from "@/core/types/api-key/usage.type";
import { UsageAggregate } from "@/modules/key-management/domain/entities/usage.entities";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import {
  UsageAggregateRepository,
  UsagePeriod,
} from "@/core/types/api-key/usage.type";

export class PrismaUsageAggregateRepository implements UsageAggregateRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(aggregate: UsageAggregate): Promise<void> {
    const p = aggregate.toPersistence();
    await this.prisma.usageAggregate.upsert({
      where: { id: p.id },
      update: {
        quantity: p.quantity,
        reportedToStripe: p.reportedToStripe,
        stripeUsageRecordId: p.stripeUsageRecordId,
        lockedAt: p.lockedAt,
      },
      create: {
        id: p.id,
        accountId: p.accountId,
        apiKeyId: p.apiKeyId,
        metric: p.metric,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        quantity: p.quantity,
        reportedToStripe: p.reportedToStripe,
        stripeUsageRecordId: p.stripeUsageRecordId,
        lockedAt: p.lockedAt,
        createdAt: p.createdAt,
      },
    });
  }

  async saveBatch(aggregates: UsageAggregate[]): Promise<void> {
    // Use transaction for batch
    for (const a of aggregates) await this.save(a);
  }

  async findByAccountAndPeriod(
    accountId: string,
    period: UsagePeriod,
    metric?: UsageMetric,
  ): Promise<UsageAggregate[]> {
    const data = await this.prisma.usageAggregate.findMany({
      where: {
        accountId,
        apiKeyId: null, // account-level rollups only
        metric: metric ?? undefined,
        periodStart: { gte: period.start },
        periodEnd: { lte: period.end },
      },
      orderBy: { periodStart: "asc" },
    });
    return data.map((d) =>
      UsageAggregate.rehydrate(d as unknown as UsageAggregateProps),
    );
  }

  async findByApiKeyAndPeriod(
    apiKeyId: string,
    period: UsagePeriod,
    metric?: UsageMetric,
  ): Promise<UsageAggregate[]> {
    const data = await this.prisma.usageAggregate.findMany({
      where: {
        apiKeyId,
        metric: metric ?? undefined,
        periodStart: { gte: period.start },
        periodEnd: { lte: period.end },
      },
      orderBy: { periodStart: "asc" },
    });
    return data.map((d) =>
      UsageAggregate.rehydrate(d as unknown as UsageAggregateProps),
    );
  }

  async upsertQuantity(params: {
    accountId: string;
    apiKeyId: string | null;
    metric: UsageMetric;
    periodStart: Date;
    periodEnd: Date;
    quantity: bigint;
  }): Promise<void> {
    // Upsert based on natural key — never double-count
    await this.prisma.usageAggregate.upsert({
      where: {
        accountId_apiKeyId_metric_periodStart: {
          accountId: params.accountId,
          apiKeyId: params.apiKeyId ?? "",
          metric: params.metric,
          periodStart: params.periodStart,
        },
      },
      update: {
        quantity: { increment: params.quantity },
      },
      create: {
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
      },
    });
  }

  async lockPeriod(accountId: string, periodStart: Date): Promise<void> {
    await this.prisma.usageAggregate.updateMany({
      where: { accountId, periodStart, lockedAt: null },
      data: { lockedAt: new Date() },
    });
  }
}
