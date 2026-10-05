import { describe, expect, it, vi } from "vitest";
import { CreateCheckoutSessionUseCase } from "../../apps/api/src/modules/billing/application/use-cases/billing/CreateCheckoutSession.usecase";
import { isOwnOrigin } from "../../apps/api/src/core/constant/hub.constant";

// Audit 2026-09-24 M16: client-chosen trials, any price, open redirects,
// double checkout.

function setup(existing: any) {
  const stripe = {
    createCustomer: vi.fn(async () => "cus_1"),
    createCheckoutSession: vi.fn(async () => "https://checkout.stripe.com/x"),
  };
  const useCase = new CreateCheckoutSessionUseCase(
    stripe as any,
    { findByAccountId: async () => existing } as any,
    { getStripeCustomerId: async () => null, setStripeCustomerId: async () => {} } as any,
  );
  const run = () =>
    useCase.execute({ accountId: "acc", accountName: "Acme", userEmail: "a@b.c", priceId: "price_pro", successUrl: "https://x/s", cancelUrl: "https://x/c", trialDays: 14 });
  return { stripe, run };
}

const sub = (status: string) => ({
  status,
  isActive: () => status === "ACTIVE",
  isTrialing: () => status === "TRIALING",
  isPastDue: () => status === "PAST_DUE",
});

describe("checkout policy", () => {
  it("gives the configured trial only on the first subscription, with idempotency keys", async () => {
    const first = setup(null);
    await first.run();
    expect(first.stripe.createCheckoutSession.mock.calls[0][0].trialDays).toBe(14);
    expect(first.stripe.createCheckoutSession.mock.calls[0][0].idempotencyKey).toMatch(/^checkout:acc:price_pro:/);
    expect(first.stripe.createCustomer.mock.calls[0][0].idempotencyKey).toBe("customer:acc");

    const again = setup(sub("CANCELED"));
    await again.run();
    expect(again.stripe.createCheckoutSession.mock.calls[0][0].trialDays).toBe(0);
  });

  it("refuses a second subscription while one is active, trialing, past due or unpaid", async () => {
    for (const status of ["ACTIVE", "TRIALING", "PAST_DUE", "UNPAID"]) {
      await expect(setup(sub(status)).run(), status).rejects.toThrow();
    }
  });

  it("return URLs must be our own origins", () => {
    expect(isOwnOrigin("http://localhost:4000/organizations/x/billing")).toBe(true);
    expect(isOwnOrigin("https://evil.example/phish")).toBe(false);
    expect(isOwnOrigin("not a url")).toBe(false);
  });
});
