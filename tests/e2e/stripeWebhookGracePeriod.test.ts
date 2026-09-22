import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, makeBillingHarness } from "./billingHarness";

// Covers context.md Known Risk #57 (E7) and shared/decision.md, 2026-09-22,
// session S1: GracePeriodWorker was registered but could never fire, because
// the Stripe webhook left Account.graceEndsAt null. Stripe sends BOTH
// invoice.payment_failed and customer.subscription.updated(past_due) for a
// failed renewal, in no guaranteed order:
//   - subscription.updated used to write `graceEndsAt: null` unconditionally
//     (wiping a deadline payment_failed had just set), and
//   - payment_failed used to do nothing at all when the subscription was
//     already PAST_DUE (so no deadline was set if the subscription event came
//     first).
// These tests drive the REAL use case, the REAL Prisma billing repository and
// the REAL worker against one in-memory account table (see billingHarness.ts).

const NOW = new Date("2026-09-22T12:00:00.000Z");
const GRACE_MS = 7 * DAY_MS;

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Only Date is faked so promises/microtasks keep running normally.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("grace deadline is set whichever order Stripe's events arrive in", () => {
  it("payment_failed, then subscription.updated(past_due)", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");

    await h.events.paymentFailed();
    await h.events.subscriptionUpdated("past_due");

    expect(h.account().status).toBe("PAST_DUE");
    expect(h.account().graceEndsAt).toEqual(new Date(NOW.getTime() + GRACE_MS));
  });

  it("subscription.updated(past_due), then payment_failed", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");

    await h.events.subscriptionUpdated("past_due");
    // The subscription event alone starts the clock...
    expect(h.account().graceEndsAt).toEqual(new Date(NOW.getTime() + GRACE_MS));
    await h.events.paymentFailed();

    expect(h.account().status).toBe("PAST_DUE");
    expect(h.account().graceEndsAt).toEqual(new Date(NOW.getTime() + GRACE_MS));
  });

  it("payment_failed on its own (no subscription event)", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");

    await h.events.paymentFailed();

    expect(h.account().status).toBe("PAST_DUE");
    expect(h.account().graceEndsAt).toEqual(new Date(NOW.getTime() + GRACE_MS));
  });

  it("UNPAID (Stripe's retries exhausted) is also PAST_DUE with a deadline", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");

    await h.events.subscriptionUpdated("unpaid");

    expect(h.account().status).toBe("PAST_DUE");
    expect(h.account().graceEndsAt).toEqual(new Date(NOW.getTime() + GRACE_MS));
  });
});

describe("the deadline is set once (set-if-absent)", () => {
  it("a Stripe retry days later does not slide the deadline", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    const first = h.account().graceEndsAt;

    vi.setSystemTime(new Date(NOW.getTime() + 3 * DAY_MS));
    await h.events.paymentFailed(); // Smart Retries: another failed attempt
    await h.events.subscriptionUpdated("past_due");

    expect(h.account().graceEndsAt).toEqual(first);
    expect(first).toEqual(new Date(NOW.getTime() + GRACE_MS));
  });

  it("sends the payment-failed email at most once, with the real deadline", async () => {
    // invoice.payment_failed first (or alone): the invoice handler starts the
    // clock, so it sends the one email, however many retries follow.
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    await h.events.subscriptionUpdated("past_due");
    await h.events.paymentFailed(); // a Stripe retry

    const send = h.notifications.sendPaymentFailed.execute;
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].graceEndsAt).toEqual(new Date(NOW.getTime() + GRACE_MS));
  });

  it("never emails twice when the subscription event arrives first", async () => {
    // Known, pre-existing gap (shared/backlog.md, 2026-09-22): in this order
    // the subscription event starts the clock and the invoice handler then
    // finds it already running, so no payment-failed email goes out at all
    // (the old code skipped this branch entirely). Only "not twice" is
    // guaranteed here; the deadline itself is asserted above.
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.subscriptionUpdated("past_due");
    await h.events.paymentFailed();
    await h.events.paymentFailed();

    expect(h.notifications.sendPaymentFailed.execute.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("the deadline is cleared only by ACTIVE or CANCELED", () => {
  it("payment_succeeded reactivates the account and clears the deadline", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    expect(h.account().graceEndsAt).not.toBeNull();

    await h.events.paymentSucceeded();

    expect(h.account().status).toBe("ACTIVE");
    expect(h.account().graceEndsAt).toBeNull();
  });

  it("subscription.updated(active) clears it", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();

    await h.events.subscriptionUpdated("active");

    expect(h.account().status).toBe("ACTIVE");
    expect(h.account().graceEndsAt).toBeNull();
  });

  it("cancellation clears it", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();

    await h.events.subscriptionDeleted();

    expect(h.account().status).toBe("CANCELED");
    expect(h.account().graceEndsAt).toBeNull();
  });
});

describe("statuses that must not earn a grace period (decision: incomplete/paused/unknown)", () => {
  it.each(["incomplete", "incomplete_expired", "paused", "some_future_stripe_status"])(
    "a subscription in '%s' leaves an ACTIVE account ACTIVE with no deadline",
    async (status) => {
      const h = makeBillingHarness();
      await h.events.subscriptionUpdated(status);

      expect(h.account().status).toBe("ACTIVE");
      expect(h.account().graceEndsAt).toBeNull();
    },
  );

  it.each(["incomplete", "paused"])(
    "'%s' does not reactivate or otherwise touch an account that is already PAST_DUE",
    async (status) => {
      const h = makeBillingHarness();
      await h.events.subscriptionCreated("active");
      await h.events.paymentFailed();
      const before = h.account();

      await h.events.subscriptionUpdated(status);

      expect(h.account().status).toBe("PAST_DUE");
      expect(h.account().graceEndsAt).toEqual(before.graceEndsAt);
    },
  );
});

describe("an account the worker already suspended is not resurrected by a later retry", () => {
  it("stays SUSPENDED with no new grace period after another payment_failed / past_due event", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();

    vi.setSystemTime(new Date(NOW.getTime() + GRACE_MS + 60_000));
    await h.sweep();
    expect(h.account().status).toBe("SUSPENDED");

    // Stripe keeps retrying for weeks after the grace period.
    vi.setSystemTime(new Date(NOW.getTime() + GRACE_MS + 2 * DAY_MS));
    await h.events.paymentFailed();
    await h.events.subscriptionUpdated("past_due");

    expect(h.account().status).toBe("SUSPENDED");
    expect(h.account().graceEndsAt).toBeNull();
    expect(h.notifications.sendPaymentFailed.execute).toHaveBeenCalledTimes(1);
  });

  it("paying afterwards does NOT reactivate it on its own — un-suspending is a deliberate action, not automatic", async () => {
    // Changed by the SUSPENDED-reactivation-gap fix (shared/decision.md,
    // 2026-09-22, "Answers to the E1-E7 open questions" and its follow-up
    // fix entry): this test used to assert the opposite ("paying afterwards
    // still reactivates it"), which was the bug itself — Account.status has
    // no field saying *why* an account is SUSPENDED (billing lapse vs.
    // admin action), so the only safe rule until one exists is that nothing
    // auto-reactivates a SUSPENDED account. See
    // tests/e2e/suspendedReactivationGuard.test.ts for the dedicated
    // coverage of this guard, including the case this test used to encode.
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.paymentFailed();
    vi.setSystemTime(new Date(NOW.getTime() + GRACE_MS + 60_000));
    await h.sweep();
    expect(h.account().status).toBe("SUSPENDED");

    await h.events.paymentSucceeded();

    expect(h.account().status).toBe("SUSPENDED");
  });
});
