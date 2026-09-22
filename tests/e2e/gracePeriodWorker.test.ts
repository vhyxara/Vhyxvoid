import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { GracePeriodWorker } from "../../apps/api/src/modules/billing/infrastructure/workers/GracePeriod.worker";
import { DAY_MS, makeBillingHarness } from "./billingHarness";

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

// Added 2026-09-22 (shared/decision.md, session S1). Everything above feeds
// the worker rows that ALREADY carry a graceEndsAt, which is why that suite
// passed while the worker could never fire in production: the Stripe webhook
// never left a deadline set (context.md Known Risk #57, E7). Here the deadline
// is whatever the real webhook use case wrote, in each realistic Stripe event
// order, and the worker sweeps that same table.
describe("GracePeriodWorker on state written by the real Stripe webhook", () => {
  const NOW = new Date("2026-09-22T12:00:00.000Z");

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const orders: Array<[string, (h: ReturnType<typeof makeBillingHarness>) => Promise<void>]> = [
    ["payment_failed, then subscription.updated(past_due)", async (h) => {
      await h.events.paymentFailed();
      await h.events.subscriptionUpdated("past_due");
    }],
    ["subscription.updated(past_due), then payment_failed", async (h) => {
      await h.events.subscriptionUpdated("past_due");
      await h.events.paymentFailed();
    }],
    ["payment_failed only", async (h) => {
      await h.events.paymentFailed();
    }],
  ];

  it.each(orders)("suspends the account once the 7-day deadline passes (%s)", async (_name, fail) => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await fail(h);

    // Inside the grace period: nothing happens.
    vi.setSystemTime(new Date(NOW.getTime() + 7 * DAY_MS - 60_000));
    await h.sweep();
    expect(h.account().status).toBe("PAST_DUE");

    // Just past the deadline: suspended, deadline cleared by the worker.
    vi.setSystemTime(new Date(NOW.getTime() + 7 * DAY_MS + 60_000));
    await h.sweep();
    expect(h.account().status).toBe("SUSPENDED");
    expect(h.account().graceEndsAt).toBeNull();
  });

  it("never suspends an account that paid within the grace period", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    await h.events.subscriptionUpdated("past_due");
    await h.events.paymentSucceeded();

    vi.setSystemTime(new Date(NOW.getTime() + 30 * DAY_MS));
    await h.sweep();

    expect(h.account().status).toBe("ACTIVE");
  });

  it("does not suspend an ACTIVE account, or one whose checkout never completed", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionUpdated("incomplete");

    vi.setSystemTime(new Date(NOW.getTime() + 30 * DAY_MS));
    await h.sweep();

    expect(h.account().status).toBe("ACTIVE");
  });
});
