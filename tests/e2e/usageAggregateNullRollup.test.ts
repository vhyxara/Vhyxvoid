import { describe, it, expect } from "vitest";
import { PrismaUsageAggregateRepository } from "../../apps/api/src/modules/key-management/domain/repositories/UsageAggregate.repositories";

// Covers shared/decision.md, 2026-09-22, "S5 investigation and proposal",
// Part 2.1: upsertQuantity's account-level rollup (apiKeyId: null) must
// accumulate into ONE row across repeated flushes of the same period, not
// insert a fresh duplicate every time. Prisma's compound-unique `where`
// shorthand cannot express a null member, which is why this needed its own
// find-then-write path rather than the existing upsert() one — verified
// here against a fake Prisma, and separately against the real local dev
// Postgres in a rolled-back transaction (this session's own verification,
// not part of the committed suite).

function makeFakePrisma() {
  const rows: any[] = [];
  let nextId = 1;
  return {
    rows,
    usageAggregate: {
      findFirst: async ({ where }: any) => {
        return (
          rows.find(
            (r) =>
              r.accountId === where.accountId &&
              r.apiKeyId === where.apiKeyId &&
              r.metric === where.metric &&
              r.periodStart.getTime() === where.periodStart.getTime(),
          ) ?? null
        );
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        row.quantity += data.quantity.increment;
        return row;
      },
      create: async ({ data }: any) => {
        const row = { ...data, id: data.id ?? `row_${nextId++}` };
        rows.push(row);
        return row;
      },
      upsert: async ({ where, update, create }: any) => {
        const key = where.accountId_apiKeyId_metric_periodStart;
        const existing = rows.find(
          (r) =>
            r.accountId === key.accountId &&
            r.apiKeyId === key.apiKeyId &&
            r.metric === key.metric &&
            r.periodStart.getTime() === key.periodStart.getTime(),
        );
        if (existing) {
          existing.quantity += update.quantity.increment;
          return existing;
        }
        const row = { ...create };
        rows.push(row);
        return row;
      },
    },
  };
}

const ACCOUNT_ID = "acct_1";
const PERIOD_START = new Date("2026-09-22T10:00:00.000Z");
const PERIOD_END = new Date("2026-09-22T10:05:00.000Z");

describe("PrismaUsageAggregateRepository.upsertQuantity — apiKeyId: null accumulates, not duplicates", () => {
  it("three calls for the same account-level rollup period land in ONE row, summed", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaUsageAggregateRepository(prisma as any);

    await repo.upsertQuantity({
      accountId: ACCOUNT_ID,
      apiKeyId: null,
      metric: "requests",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      quantity: 7n,
    });
    await repo.upsertQuantity({
      accountId: ACCOUNT_ID,
      apiKeyId: null,
      metric: "requests",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      quantity: 3n,
    });
    await repo.upsertQuantity({
      accountId: ACCOUNT_ID,
      apiKeyId: null,
      metric: "requests",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      quantity: 5n,
    });

    const rows = prisma.rows.filter((r) => r.apiKeyId === null);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(15n);
  });

  it("a null-apiKeyId row and a real-apiKeyId row for the same account/period never collide", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaUsageAggregateRepository(prisma as any);

    await repo.upsertQuantity({
      accountId: ACCOUNT_ID,
      apiKeyId: null,
      metric: "requests",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      quantity: 10n,
    });
    await repo.upsertQuantity({
      accountId: ACCOUNT_ID,
      apiKeyId: "key_1",
      metric: "requests",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      quantity: 2n,
    });

    expect(prisma.rows).toHaveLength(2);
    expect(prisma.rows.find((r) => r.apiKeyId === null)?.quantity).toBe(10n);
    expect(prisma.rows.find((r) => r.apiKeyId === "key_1")?.quantity).toBe(2n);
  });

  it("a different period start for the same account starts a new null-apiKeyId row, not the same one", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaUsageAggregateRepository(prisma as any);
    const laterPeriod = new Date("2026-09-22T10:05:00.000Z");

    await repo.upsertQuantity({
      accountId: ACCOUNT_ID,
      apiKeyId: null,
      metric: "requests",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      quantity: 4n,
    });
    await repo.upsertQuantity({
      accountId: ACCOUNT_ID,
      apiKeyId: null,
      metric: "requests",
      periodStart: laterPeriod,
      periodEnd: new Date("2026-09-22T10:10:00.000Z"),
      quantity: 6n,
    });

    const nullRows = prisma.rows.filter((r) => r.apiKeyId === null);
    expect(nullRows).toHaveLength(2);
  });

  it("real-apiKeyId rows still go through the original upsert path unchanged", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaUsageAggregateRepository(prisma as any);

    await repo.upsertQuantity({
      accountId: ACCOUNT_ID,
      apiKeyId: "key_1",
      metric: "requests",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      quantity: 1n,
    });
    await repo.upsertQuantity({
      accountId: ACCOUNT_ID,
      apiKeyId: "key_1",
      metric: "requests",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      quantity: 1n,
    });

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].quantity).toBe(2n);
  });
});
