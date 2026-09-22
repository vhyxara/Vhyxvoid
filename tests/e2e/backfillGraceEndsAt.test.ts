import { describe, it, expect } from "vitest";
import { backfillGraceEndsAt } from "../../apps/api/src/modules/billing/infrastructure/scripts/backfill-grace-ends-at";
import { DAY_MS, makeFakePrisma } from "./billingHarness";

// shared/decision.md, 2026-09-22, session S1: defensive one-off for PAST_DUE
// accounts that predate the webhook fix and have no grace deadline.

const NOW = new Date("2026-09-22T12:00:00.000Z");
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY_MS);

function fixture() {
  return makeFakePrisma([
    { id: "stuck_recent", status: "PAST_DUE", graceEndsAt: null, updatedAt: at(2) },
    { id: "stuck_old", status: "PAST_DUE", graceEndsAt: null, updatedAt: at(20) },
    { id: "has_deadline", status: "PAST_DUE", graceEndsAt: at(-3), updatedAt: at(4) },
    { id: "active", status: "ACTIVE", graceEndsAt: null, updatedAt: at(50) },
    { id: "suspended", status: "SUSPENDED", graceEndsAt: null, updatedAt: at(50) },
  ]);
}

describe("backfillGraceEndsAt", () => {
  it("dry run reports updatedAt + 7 days for stuck accounts and writes nothing", async () => {
    const db = fixture();

    const rows = await backfillGraceEndsAt(db.prisma as any, { apply: false, now: NOW });

    expect(rows.map((r) => r.accountId).sort()).toEqual(["stuck_old", "stuck_recent"]);
    const recent = rows.find((r) => r.accountId === "stuck_recent")!;
    expect(recent.graceEndsAt).toEqual(new Date(at(2).getTime() + 7 * DAY_MS));
    expect(recent.alreadyExpired).toBe(false);
    expect(rows.find((r) => r.accountId === "stuck_old")!.alreadyExpired).toBe(true);
    expect(rows.every((r) => !r.written)).toBe(true);
    expect(db.get("stuck_recent").graceEndsAt).toBeNull();
    expect(db.get("stuck_old").graceEndsAt).toBeNull();
  });

  it("--apply writes the deadline and touches nothing else", async () => {
    const db = fixture();

    await backfillGraceEndsAt(db.prisma as any, { apply: true, now: NOW });

    expect(db.get("stuck_recent").graceEndsAt).toEqual(new Date(at(2).getTime() + 7 * DAY_MS));
    expect(db.get("stuck_old").graceEndsAt).toEqual(new Date(at(20).getTime() + 7 * DAY_MS));
    expect(db.get("has_deadline").graceEndsAt).toEqual(at(-3)); // unchanged
    expect(db.get("active").graceEndsAt).toBeNull();
    expect(db.get("suspended").graceEndsAt).toBeNull();
  });

  it("is idempotent: a second --apply finds nothing", async () => {
    const db = fixture();
    await backfillGraceEndsAt(db.prisma as any, { apply: true, now: NOW });

    const second = await backfillGraceEndsAt(db.prisma as any, { apply: true, now: NOW });

    expect(second).toEqual([]);
  });

  it("does not overwrite a deadline a webhook set between the read and the write", async () => {
    const db = fixture();
    const realFindMany = db.prisma.account.findMany;
    db.prisma.account.findMany = async (args: any) => {
      const found = await realFindMany(args);
      // A webhook lands after the read, before the write.
      await db.prisma.account.update({
        where: { id: "stuck_recent" },
        data: { graceEndsAt: new Date(NOW.getTime() + 6 * DAY_MS) },
      });
      return found;
    };

    const rows = await backfillGraceEndsAt(db.prisma as any, { apply: true, now: NOW });

    expect(rows.find((r) => r.accountId === "stuck_recent")!.written).toBe(false);
    expect(db.get("stuck_recent").graceEndsAt).toEqual(new Date(NOW.getTime() + 6 * DAY_MS));
  });
});
