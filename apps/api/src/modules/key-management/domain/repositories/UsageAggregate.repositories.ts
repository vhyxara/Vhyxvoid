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
    // Prisma's compound-unique `where` shorthand (accountId_apiKeyId_metric_
    // periodStart) cannot express a null member — a known Prisma limitation
    // for composite indexes with a nullable column, confirmed by tsc
    // rejecting `apiKeyId: null` there even though Postgres itself matches
    // NULL in a plain multi-column WHERE without any trouble. The account-
    // level rollup (apiKeyId: null — the public tunnel path, added
    // 2026-09-22) needs exactly that null match, so it can't go through the
    // upsert() shorthand below; do a plain find-then-write instead for this
    // one case. (The previous version used `apiKeyId ?? ""` as a stand-in
    // in the where clause while create() wrote a real null — those never
    // matched each other, so every flush for a null-apiKeyId row would have
    // inserted a fresh duplicate instead of accumulating. Never triggered
    // before now because apiKeyId was always a real key id until this
    // session introduced the first null-apiKeyId writer.)
    if (params.apiKeyId === null) {
      const existing = await this.prisma.usageAggregate.findFirst({
        where: {
          accountId: params.accountId,
          apiKeyId: null,
          metric: params.metric,
          periodStart: params.periodStart,
        },
      });
      if (existing) {
        await this.prisma.usageAggregate.update({
          where: { id: existing.id },
          data: { quantity: { increment: params.quantity } },
        });
      } else {
        await this.prisma.usageAggregate.create({
          data: {
            id: crypto.randomUUID(),
            accountId: params.accountId,
            apiKeyId: null,
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
      return;
    }

    // Upsert based on natural key — never double-count.
    await this.prisma.usageAggregate.upsert({
      where: {
        accountId_apiKeyId_metric_periodStart: {
          accountId: params.accountId,
          apiKeyId: params.apiKeyId,
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
