import { describe, it, expect, vi } from "vitest";
import { GracePeriodWorker } from "../../apps/api/src/modules/billing/infrastructure/workers/GracePeriod.worker";

// Covers context.md item 41: GracePeriodWorker was fully written and
// correct but never instantiated or scheduled anywhere — a PAST_DUE
// account had no automatic path to SUSPENDED once its grace period
// expired. Now scheduled in billing.plugin.ts (see decision.md,
// 2026-09-14, "Schedule GracePeriodWorker"). This file tests the worker's
// own sweep logic directly (its private tick(), same convention as other
// tests in this suite reaching into private/instance state when the
// class's public API is deliberately self-managing — see
// LocalAgentClient.test's cachedAgent poke).

function makePrisma(accounts: Array<{ id: string; graceEndsAt: Date }>) {
  return {
    account: {
      findMany: vi.fn().mockResolvedValue(accounts),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("GracePeriodWorker", () => {
  it("moves a PAST_DUE account past its graceEndsAt to SUSPENDED", async () => {
    const expiredAccount = { id: "acct_1", graceEndsAt: new Date(Date.now() - 60_000) };
    const prisma = makePrisma([expiredAccount]);
    const worker = new GracePeriodWorker(prisma as any);

    await (worker as any).tick();

    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PAST_DUE" }),
      }),
    );
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acct_1" },
        data: expect.objectContaining({ status: "SUSPENDED", graceEndsAt: null }),
      }),
    );
  });

  it("does nothing when no PAST_DUE accounts have an expired grace period", async () => {
    const prisma = makePrisma([]);
    const worker = new GracePeriodWorker(prisma as any);

    await (worker as any).tick();

    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it("suspends multiple expired accounts in one sweep", async () => {
    const prisma = makePrisma([
      { id: "acct_1", graceEndsAt: new Date(Date.now() - 60_000) },
      { id: "acct_2", graceEndsAt: new Date(Date.now() - 1_000) },
    ]);
    const worker = new GracePeriodWorker(prisma as any);

    await (worker as any).tick();

    expect(prisma.account.update).toHaveBeenCalledTimes(2);
  });

  it("logs and continues if one account's update fails, rather than aborting the sweep", async () => {
    const prisma = makePrisma([
      { id: "acct_bad", graceEndsAt: new Date(Date.now() - 60_000) },
      { id: "acct_good", graceEndsAt: new Date(Date.now() - 60_000) },
    ]);
    prisma.account.update = vi
      .fn()
      .mockRejectedValueOnce(new Error("db error"))
      .mockResolvedValueOnce(undefined);
    const worker = new GracePeriodWorker(prisma as any);

    await expect((worker as any).tick()).resolves.not.toThrow();
    expect(prisma.account.update).toHaveBeenCalledTimes(2);
  });

  it("start() runs an immediate sweep rather than waiting for the first hourly interval", async () => {
    const expiredAccount = { id: "acct_1", graceEndsAt: new Date(Date.now() - 60_000) };
    const prisma = makePrisma([expiredAccount]);
    const worker = new GracePeriodWorker(prisma as any);

    worker.start();
    // start() fires tick() without awaiting it (fire-and-forget with a
    // .catch) — flush microtasks so the immediate sweep completes before
    // asserting, matching how the real immediate-run behavior is used to
    // answer the "stale accounts on first deploy" question.
    await new Promise((resolve) => setImmediate(resolve));
    worker.stop();

    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "acct_1" } }),
    );
  });
});
