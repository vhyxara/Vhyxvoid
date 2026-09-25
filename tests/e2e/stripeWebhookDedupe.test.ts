import { describe, it, expect, vi } from "vitest";
import { HandleStripeWebhookUseCase } from "../../apps/api/src/modules/billing/application/use-cases/webhook/HandleStripeWebhook.usecase";
import { AppError } from "../../apps/api/src/core/errors/app-error";

// Found by the 2026-09-25 end-to-end run: a badly signed webhook answered 500
// (looks like an outage, invites retries), and a re-delivered event (Stripe
// is at-least-once) was processed again, e.g. resending payment-failed email.

function useCase(event: any, eventLog?: any) {
  const notifications = { sendPaymentFailed: { execute: vi.fn(async () => {}) } };
  const uc = new HandleStripeWebhookUseCase(
    {
      constructWebhookEvent: () => {
        if (event instanceof Error) throw event;
        return event;
      },
      resolvePlan: () => "PRO",
    } as any,
    {
      findByStripeSubscriptionId: async () => {
        throw new Error("database down");
      },
      findByAccountId: async () => null,
      save: async () => {},
    } as any,
    { save: async () => {}, findByStripeInvoiceId: async () => null } as any,
    {} as any,
    notifications as any,
    undefined,
    eventLog,
  );
  return { uc, notifications };
}

function memoryLog() {
  const seen = new Set<string>();
  return {
    seen,
    claim: vi.fn(async (id: string) => (seen.has(id) ? false : (seen.add(id), true))),
    release: vi.fn(async (id: string) => void seen.delete(id)),
  };
}

describe("Stripe webhook", () => {
  it("a bad signature is a 400 ValidationError, not a 500", async () => {
    const { uc } = useCase(new Error("No signatures found matching the expected signature"));
    const err = await uc.execute(Buffer.from("{}"), "t=1,v1=00").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
  });

  it("the same event id is processed once", async () => {
    const log = memoryLog();
    const { uc } = useCase({ id: "evt_1", type: "customer.created", data: { object: {} } }, log);
    expect(await uc.execute(Buffer.from(""), "sig")).toEqual({ received: true });
    expect(await uc.execute(Buffer.from(""), "sig")).toEqual({ received: true, duplicate: true });
  });

  it("an event whose handler failed is released, so Stripe's retry is processed", async () => {
    const log = memoryLog();
    const sub = { id: "sub_1", customer: "cus_1", status: "active", metadata: { accountId: "acct_1" }, items: { data: [{ price: { id: "price_1", product: "prod_1" } }] } };
    const { uc } = useCase({ id: "evt_2", type: "customer.subscription.updated", data: { object: sub } }, log);
    const err = await uc.execute(Buffer.from(""), "sig").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(log.release).toHaveBeenCalledWith("evt_2");
    expect(log.seen.has("evt_2")).toBe(false);
  });
});
