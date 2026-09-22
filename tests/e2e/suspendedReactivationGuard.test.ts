import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBillingHarness } from "./billingHarness";

// Covers the SUSPENDED-reactivation gap found during S1 and recorded as a
// hard prerequisite for S4/admin-suspend (shared/decision.md, 2026-09-22,
// "Answers to the E1-E7 open questions"): handleSubscriptionUpsert set an
// account to ACTIVE on any active/trialing Stripe event, unconditionally,
// regardless of its current status — including SUSPENDED, RESTRICTED,
// CANCELED and DELETED. The same unconditional update also existed in
// handleInvoicePaymentSucceeded, gated only by the Subscription row's own
// (Stripe-mirrored) status, not the Account's — GracePeriodWorker suspends
// the Account without touching the Subscription row, so a worker-suspended
// account's subscription still reads PAST_DUE, and the old gate did nothing
// to protect it.
//
// Fix: both paths now go through AccountBillingRepository.markActiveFromPastDue,
// a single conditional UPDATE guarded to accounts currently PAST_DUE — the
// same discipline as markPastDue. These tests drive the real webhook use case
// and the real Prisma repository (billingHarness.ts), not a hand-rolled mock
// of the guard.

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

describe("the case that must keep working: PAST_DUE recovers to ACTIVE", () => {
  it("customer.subscription.updated(active) reactivates a PAST_DUE account", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    expect(h.account().status).toBe("PAST_DUE");

    await h.events.subscriptionUpdated("active");

    expect(h.account().status).toBe("ACTIVE");
    expect(h.account().graceEndsAt).toBeNull();
  });

  it("invoice.payment_succeeded reactivates a PAST_DUE account", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    await h.events.subscriptionUpdated("past_due");
    expect(h.account().status).toBe("PAST_DUE");

    await h.events.paymentSucceeded();

    expect(h.account().status).toBe("ACTIVE");
    expect(h.account().graceEndsAt).toBeNull();
  });

  it("reactivation works however Stripe orders the two payment-succeeded-adjacent events", async () => {
    for (const order of ["invoice-then-subscription", "subscription-then-invoice"] as const) {
      const h = makeBillingHarness();
      await h.events.subscriptionCreated("active");
      await h.events.paymentFailed();

      if (order === "invoice-then-subscription") {
        await h.events.paymentSucceeded();
        await h.events.subscriptionUpdated("active");
      } else {
        await h.events.subscriptionUpdated("active");
        await h.events.paymentSucceeded();
      }

      expect(h.account().status, order).toBe("ACTIVE");
      expect(h.account().graceEndsAt, order).toBeNull();
    }
  });
});

describe("the bug being fixed: SUSPENDED is not reactivated by an unrelated Stripe event", () => {
  it("customer.subscription.updated(active) does not reactivate a SUSPENDED account", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    vi.setSystemTime(new Date(NOW.getTime() + 8 * 86400000));
    await h.sweep(); // GracePeriodWorker suspends it
    expect(h.account().status).toBe("SUSPENDED");

    await h.events.subscriptionUpdated("active");

    expect(h.account().status).toBe("SUSPENDED");
  });

  it("invoice.payment_succeeded does not reactivate a SUSPENDED account, even though the Subscription row still reads PAST_DUE", async () => {
    // This is the exact scenario the old sub.isPastDue() gate could not
    // catch: GracePeriodWorker never touches the Subscription row, so it is
    // still PAST_DUE at the moment of this event.
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    vi.setSystemTime(new Date(NOW.getTime() + 8 * 86400000));
    await h.sweep();
    expect(h.account().status).toBe("SUSPENDED");

    await h.events.paymentSucceeded();

    expect(h.account().status).toBe("SUSPENDED");
  });

  it("an account suspended for a reason unrelated to billing (never PAST_DUE at all) is not touched by a routine subscription update", async () => {
    const h = makeBillingHarness({ status: "SUSPENDED" });
    await h.events.subscriptionCreated("active");

    expect(h.account().status).toBe("SUSPENDED");
  });

  it.each(["RESTRICTED", "CANCELED", "DELETED"])(
    "a %s account is not reactivated by an active/trialing Stripe event either",
    async (status) => {
      const h = makeBillingHarness({ status });
      await h.events.subscriptionCreated("trialing");

      expect(h.account().status, status).toBe(status);
    },
  );

  it("an already-ACTIVE account is left alone (no needless write) by a routine update", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    const before = h.account();

    await h.events.subscriptionUpdated("active");

    expect(h.account()).toEqual(before);
  });
});
