// Traffic charts: bucket windows, zero-filling, weighted means, and the
// Postgres aggregation behind GET /api/v1/traffic (real database, opt-in).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { fillTrafficSeries, trafficTotals, trafficWindow, isTrafficRange } from "../../packages/shared/src/traffic";
import { PrismaClient } from "../../packages/shared/generated/prisma";
import { queryTraffic } from "../../apps/api/src/modules/platform/traffic/traffic.routes";

describe("traffic series helpers", () => {
  it("windows are bucket-aligned and end after the current bucket", () => {
    const now = Date.UTC(2026, 9, 6, 10, 7, 30);
    const w = trafficWindow("24h", now);
    expect(w.bucketMs).toBe(15 * 60_000);
    expect(w.to).toBe(Date.UTC(2026, 9, 6, 10, 15));
    expect(w.to - w.from).toBe(24 * 3_600_000);
    expect(trafficWindow("1h", now).to).toBe(Date.UTC(2026, 9, 6, 10, 8));
  });

  it("zero-fills every bucket and merges rows that fall in the same bucket", () => {
    const series = fillTrafficSeries(
      [
        { t: 60_000, requests: 2, errors4xx: 1, errors5xx: 0, totalMs: 100 },
        { t: 90_000, requests: 2, errors4xx: 0, errors5xx: 1, totalMs: 300 },
      ],
      0,
      180_000,
      60_000,
    );
    expect(series).toHaveLength(3);
    expect(series[0]).toEqual({ t: new Date(0).toISOString(), requests: 0, errors4xx: 0, errors5xx: 0, avgMs: null });
    expect(series[1]).toMatchObject({ requests: 4, errors4xx: 1, errors5xx: 1, avgMs: 100 });
  });

  it("totals weight the mean by request count (not a mean of means)", () => {
    const t = trafficTotals([
      { requests: 1, errors4xx: 0, errors5xx: 1, totalMs: 1000 },
      { requests: 99, errors4xx: 0, errors5xx: 0, totalMs: 990 },
    ]);
    expect(t.avgMs).toBe(20);
    expect(t.errorRate).toBe(1);
    expect(trafficTotals([]).avgMs).toBeNull();
  });

  it("only known ranges are accepted", () => {
    expect(isTrafficRange("7d")).toBe(true);
    expect(isTrafficRange("30d")).toBe(false);
    expect(isTrafficRange("toString")).toBe(false);
  });
});

const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe.skipIf(!url)("queryTraffic against a real database", () => {
  let prisma: PrismaClient;
  const a = randomUUID();
  const b = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    const now = Date.now();
    const m = (ago: number) => new Date(Math.floor((now - ago * 60_000) / 60_000) * 60_000);
    await prisma.tunnelMinuteStat.createMany({
      data: [
        { accountId: a, label: "web", minute: m(1), requests: 10, errors4xx: 1, errors5xx: 2, totalMs: 1000n },
        { accountId: a, label: "web", minute: m(2), requests: 5, errors4xx: 0, errors5xx: 0, totalMs: 500n },
        { accountId: a, label: "api", minute: m(3), requests: 1, errors4xx: 0, errors5xx: 1, totalMs: 900n },
        { accountId: a, label: "web", minute: m(60 * 30), requests: 999, errors4xx: 0, errors5xx: 0, totalMs: 0n }, // outside 24h
        { accountId: b, label: "web", minute: m(1), requests: 7, errors4xx: 0, errors5xx: 0, totalMs: 70n },
      ],
    });
  });

  afterAll(async () => {
    await prisma.tunnelMinuteStat.deleteMany({ where: { accountId: { in: [a, b] } } });
    await prisma.$disconnect();
  });

  it("aggregates one account in the window, with per-tunnel totals", async () => {
    const r = await queryTraffic(prisma, trafficWindow("24h"), { accountId: a }, "label");
    expect(r.series).toHaveLength(96);
    expect(r.totals).toMatchObject({ requests: 16, errors4xx: 1, errors5xx: 3, avgMs: 150 });
    expect(r.top.map((t) => [t.key, t.requests])).toEqual([["web", 15], ["api", 1]]);
  });

  it("filters by label and spans every account for operators", async () => {
    const one = await queryTraffic(prisma, trafficWindow("1h"), { accountId: a, label: "api" }, "label");
    expect(one.totals.requests).toBe(1);
    const all = await queryTraffic(prisma, trafficWindow("1h"), {}, "accountId");
    const keys = all.top.map((t) => t.key);
    expect(keys).toContain(a);
    expect(keys).toContain(b);
  });
});
