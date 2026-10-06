// Usage and trial notices: levels, and exactly-once delivery to owners/admins
// against a real database (opt-in: VHYXVOID_TEST_DATABASE_URL).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { monthKey, runAccountNotices, sendTrialEndingNotice, usageNoticeLevel } from "../../apps/api/src/modules/platform/alerts/notices";

describe("usageNoticeLevel", () => {
  it("picks the highest level reached; unlimited plans never notify", () => {
    expect(usageNoticeLevel(7_999, 10_000)).toBeNull();
    expect(usageNoticeLevel(8_000, 10_000)).toBe(80);
    expect(usageNoticeLevel(10_000, 10_000)).toBe(100);
    expect(usageNoticeLevel(50_000, 10_000)).toBe(100);
    expect(usageNoticeLevel(1e9, Infinity)).toBeNull();
    expect(usageNoticeLevel(5, 0)).toBeNull();
  });

  it("month keys are UTC", () => {
    expect(monthKey(Date.UTC(2026, 0, 31, 23, 59))).toBe("2026-01");
  });
});

const url = process.env.VHYXVOID_TEST_DATABASE_URL;

function fakeService() {
  return {
    createInApp: { execute: vi.fn(async () => ({})) },
    sendAlert: { execute: vi.fn(async () => {}) },
    sendTrialEnding: { execute: vi.fn(async () => {}) },
  };
}

describe.skipIf(!url)("account notices against a real database", () => {
  let prisma: PrismaClient;
  const tag = `notice-${Date.now()}`;
  let accountId = "";
  let freeAccountId = "";
  const userIds: string[] = [];

  async function user(name: string) {
    const u = await prisma.user.create({ data: { email: `${tag}-${name}@notices.test`, password: "x", firstName: name } });
    userIds.push(u.id);
    return u;
  }

  async function account(ownerId: string, members: Array<{ id: string; level: number }>) {
    const a = await prisma.account.create({ data: { name: `${tag} workspace`, type: "ORGANIZATION", createdById: ownerId } });
    const role = await prisma.role.create({ data: { accountId: a.id, name: "r", level: 100 } });
    for (const m of members) await prisma.accountMember.create({ data: { userId: m.id, accountId: a.id, roleId: role.id, roleLevel: m.level } });
    return a;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    const owner = await user("owner");
    const admin = await user("admin");
    const member = await user("member");
    const a = await account(owner.id, [
      { id: owner.id, level: 100 },
      { id: admin.id, level: 70 },
      { id: member.id, level: 10 },
    ]);
    accountId = a.id;
    freeAccountId = (await account(owner.id, [{ id: owner.id, level: 100 }])).id;
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // FREE allows 10,000 requests a month: one account at 105 %, one at 10 %.
    await prisma.usageAggregate.createMany({
      data: [
        { accountId, metric: "requests", periodStart, periodEnd: new Date(periodStart.getTime() + 3_600_000), quantity: 10_500n },
        { accountId: freeAccountId, metric: "requests", periodStart, periodEnd: new Date(periodStart.getTime() + 3_600_000), quantity: 1_000n },
      ],
    });
  });

  afterAll(async () => {
    await prisma.usageAggregate.deleteMany({ where: { accountId: { in: [accountId, freeAccountId] } } });
    await prisma.account.deleteMany({ where: { id: { in: [accountId, freeAccountId] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("sends one 100 % notice to owners and admins, then nothing on the next run", async () => {
    const svc = fakeService();
    const first = await runAccountNotices(prisma, svc as never);
    expect(first.usage).toBeGreaterThanOrEqual(1);
    const mine = svc.sendAlert.execute.mock.calls.filter((c: any[]) => String(c[0].to).startsWith(tag));
    expect(mine.map((c: any[]) => c[0].to).sort()).toEqual([`${tag}-admin@notices.test`, `${tag}-owner@notices.test`]);
    expect((mine[0] as any[])[0].title).toMatch(/used this month's requests/);

    const notices = await prisma.accountNotice.findMany({ where: { accountId }, orderBy: { kind: "asc" } });
    expect(notices.map((n) => n.kind)).toEqual(["USAGE_100", "USAGE_80"]); // 80 claimed too: no second mail later
    expect(await prisma.accountNotice.count({ where: { accountId: freeAccountId } })).toBe(0);

    const again = fakeService();
    await runAccountNotices(prisma, again as never);
    expect(again.sendAlert.execute.mock.calls.filter((c: any[]) => String(c[0].to).startsWith(tag))).toHaveLength(0);
  });

  it("a trial reminder goes out once per trial, whoever sends it first", async () => {
    const svc = fakeService();
    const ends = new Date(Date.now() + 2 * 86_400_000);
    const [a, b] = await Promise.all([sendTrialEndingNotice(prisma, svc as never, accountId, ends), sendTrialEndingNotice(prisma, svc as never, accountId, ends)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(svc.sendTrialEnding.execute).toHaveBeenCalledTimes(2); // owner + admin
    expect(svc.createInApp.execute.mock.calls.every((c: any[]) => c[0].type === "TRIAL_ENDING")).toBe(true);
    expect((svc.sendTrialEnding.execute.mock.calls[0] as any[])[0].daysLeft).toBe(2);
  });
});
