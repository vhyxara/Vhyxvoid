// Ending a paid subscription used to set Account.status = CANCELED, which
// Account.ensureActive() and the hub both treat as "locked": a customer who
// only stopped paying for Pro lost every tunnel and key. Now the account
// stays usable and the plan resolver drops it to FREE because a canceled
// subscription no longer entitles.
import { describe, expect, it } from "vitest";

import { makeBillingHarness } from "./billingHarness";
import { resolvePlanForAccount } from "../../packages/shared/src/planResolver";

describe("subscription ends -> FREE plan, account still usable", () => {
  it("customer.subscription.deleted leaves an ACTIVE account ACTIVE", async () => {
    const h = makeBillingHarness();
    await h.events.subscriptionCreated("active");
    await h.events.subscriptionDeleted();

    expect(h.account().status).toBe("ACTIVE");
    expect(h.cacheInvalidator.invalidate).toHaveBeenCalled();
  });

  it("subscription.updated(canceled) clears a PAST_DUE grace period", async () => {
    const h = makeBillingHarness({ status: "PAST_DUE", graceEndsAt: new Date(Date.now() + 1000) });
    await h.events.subscriptionUpdated("canceled");

    expect(h.account()).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
  });

  it("keeps PAST_DUE while another subscription is still unpaid", async () => {
    const h = makeBillingHarness({ status: "PAST_DUE", graceEndsAt: new Date(Date.now() + 1000) });
    h.otherSubscriptions.push("UNPAID");
    await h.events.subscriptionDeleted();

    expect(h.account().status).toBe("PAST_DUE");
  });

  it("migrates a legacy CANCELED account back to ACTIVE", async () => {
    const h = makeBillingHarness({ status: "CANCELED" });
    await h.events.subscriptionCreated("active"); // does not lift CANCELED by itself
    expect(h.account().status).toBe("CANCELED");
    await h.events.subscriptionDeleted();

    expect(h.account().status).toBe("ACTIVE");
  });

  it.each(["SUSPENDED", "RESTRICTED", "DELETED"])("never lifts an admin-set %s", async (status) => {
    const h = makeBillingHarness({ status });
    await h.events.subscriptionDeleted();

    expect(h.account().status).toBe(status);
  });
});

describe("plan resolver only counts subscriptions that still pay", () => {
  function prisma(subs: Array<{ plan: string; status: string }>) {
    return {
      account: { findUnique: async () => ({ status: "ACTIVE" }) },
      subscription: {
        // Newest first, filtered like Postgres would.
        findFirst: async ({ where }: any) => subs.find((s) => where.status.in.includes(s.status)) ?? null,
      },
    };
  }

  it("a canceled Pro subscription means FREE", async () => {
    expect(await resolvePlanForAccount(prisma([{ plan: "PRO", status: "CANCELED" }]), "a")).toBe("FREE");
  });

  it("an unpaid first checkout (INCOMPLETE) does not grant the plan", async () => {
    expect(await resolvePlanForAccount(prisma([{ plan: "ENTERPRISE", status: "INCOMPLETE" }]), "a")).toBe("FREE");
  });

  it("a newer incomplete upgrade does not hide the active plan underneath", async () => {
    const subs = [
      { plan: "ENTERPRISE", status: "INCOMPLETE" },
      { plan: "PRO", status: "ACTIVE" },
    ];
    expect(await resolvePlanForAccount(prisma(subs), "a")).toBe("PRO");
  });

  it.each(["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"])("%s keeps the plan", async (status) => {
    expect(await resolvePlanForAccount(prisma([{ plan: "PRO", status }]), "a")).toBe("PRO");
  });
});
