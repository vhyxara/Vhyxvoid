import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, makeBillingHarness } from "./billingHarness";

// Covers shared/context.md Known Risk #57 (E6, Part 2): every place
// Account.status actually changes must invalidate that account's cached
// apikey:data:* entries, closing the up-to-5-minute lag between a real
// status change and the hub/gateway noticing. Drives the real webhook use
// case and the real GracePeriodWorker (billingHarness.ts), asserting on the
// (fake, trackable) cache invalidator each one calls — not just that
// Account.status changed in the fake Postgres table.

const NOW = new Date("2026-09-22T12:00:00.000Z");

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the webhook invalidates the account's cache on every real status change", () => {
  it("invoice.payment_failed (ACTIVE -> PAST_DUE) invalidates", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    h.cacheInvalidator.invalidate.mockClear();

    await h.events.paymentFailed();

    expect(h.cacheInvalidator.invalidate).toHaveBeenCalledWith("acct1");
  });

  it("customer.subscription.updated(active) (PAST_DUE -> ACTIVE) invalidates", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    h.cacheInvalidator.invalidate.mockClear();

    await h.events.subscriptionUpdated("active");

    expect(h.cacheInvalidator.invalidate).toHaveBeenCalledWith("acct1");
  });

  it("invoice.payment_succeeded (PAST_DUE -> ACTIVE) invalidates", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    h.cacheInvalidator.invalidate.mockClear();

    await h.events.paymentSucceeded();

    expect(h.cacheInvalidator.invalidate).toHaveBeenCalledWith("acct1");
  });

  it("customer.subscription.deleted (-> CANCELED) invalidates", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    h.cacheInvalidator.invalidate.mockClear();

    await h.events.subscriptionDeleted();

    expect(h.cacheInvalidator.invalidate).toHaveBeenCalledWith("acct1");
  });

  it("does NOT invalidate on a Stripe retry that changes nothing (already PAST_DUE, deadline already set)", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    h.cacheInvalidator.invalidate.mockClear();

    await h.events.paymentFailed(); // Stripe retry, set-if-absent no-ops
    await h.events.subscriptionUpdated("past_due"); // same status, no-op

    expect(h.cacheInvalidator.invalidate).not.toHaveBeenCalled();
  });

  it("does NOT invalidate when the event maps to no account-status change (incomplete/paused)", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    h.cacheInvalidator.invalidate.mockClear();

    await h.events.subscriptionUpdated("incomplete");
    await h.events.subscriptionUpdated("paused");

    expect(h.cacheInvalidator.invalidate).not.toHaveBeenCalled();
  });

  it("does NOT invalidate when trying (and failing, guarded) to reactivate a SUSPENDED account", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    vi.setSystemTime(new Date(NOW.getTime() + 8 * DAY_MS));
    await h.sweep(); // worker suspends it
    h.cacheInvalidator.invalidate.mockClear();

    await h.events.subscriptionUpdated("active"); // markActiveFromPastDue no-ops (not PAST_DUE anymore)

    expect(h.account().status).toBe("SUSPENDED");
    expect(h.cacheInvalidator.invalidate).not.toHaveBeenCalled();
  });
});

describe("GracePeriodWorker invalidates the account's cache when it suspends one", () => {
  it("invalidates on a real suspension", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    vi.setSystemTime(new Date(NOW.getTime() + 8 * DAY_MS));
    h.cacheInvalidator.invalidate.mockClear();

    await h.sweep();

    expect(h.account().status).toBe("SUSPENDED");
    expect(h.cacheInvalidator.invalidate).toHaveBeenCalledWith("acct1");
  });

  it("does not invalidate when the sweep finds nothing to suspend", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    h.cacheInvalidator.invalidate.mockClear();

    await h.sweep();

    expect(h.cacheInvalidator.invalidate).not.toHaveBeenCalled();
  });

  it("the pre-2026-09-22 no-arg-style construction (GracePeriodWorker(prisma) alone) still works, invalidation just no-ops", async () => {
    const { GracePeriodWorker } = await import(
      "../../apps/api/src/modules/billing/infrastructure/workers/GracePeriod.worker"
    );
    const prisma = {
      account: {
        findMany: vi.fn(async () => [{ id: "a1", graceEndsAt: new Date(0) }]),
        update: vi.fn(async () => {}),
      },
    };
    const worker = new GracePeriodWorker(prisma as any);

    await expect((worker as any).tick()).resolves.not.toThrow();
    expect(prisma.account.update).toHaveBeenCalled();
  });
});
