import { vi } from "vitest";
import { HandleStripeWebhookUseCase } from "../../apps/api/src/modules/billing/application/use-cases/webhook/HandleStripeWebhook.usecase";
import { PrismaAccountBillingRepository } from "../../apps/api/src/modules/billing/domain/repositories/PrismaAccountBillingRepository";
import { GracePeriodWorker } from "../../apps/api/src/modules/billing/infrastructure/workers/GracePeriod.worker";

// Shared by stripeWebhookGracePeriod.test.ts and gracePeriodWorker.test.ts.
//
// Why this exists: the 2026-09-14 worker test mocked `findMany` with rows that
// already carried a `graceEndsAt`, so it could not see that the Stripe webhook
// never left one set (context.md Known Risk #57, E7). Here the webhook use
// case, the real PrismaAccountBillingRepository and the real GracePeriodWorker
// all run against ONE in-memory `account` table, so a deadline the webhook
// writes is the deadline the worker reads.
//
// The fake Prisma understands only the `where` shapes those three classes use:
// `id`, `status` (string), `graceEndsAt` (null or `{ lte: Date }`).

export interface FakeAccount {
  id: string;
  status: string;
  graceEndsAt: Date | null;
  updatedAt: Date;
}

function matches(row: FakeAccount, where: any): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    const value = (row as any)[key];
    if (cond === null) {
      if (value !== null) return false;
    } else if (cond instanceof Date || typeof cond !== "object") {
      if (value !== cond) return false;
    } else if ("lte" in (cond as any)) {
      if (value === null || !(value <= (cond as any).lte)) return false;
    } else {
      throw new Error(`fake prisma: unsupported where condition on ${key}`);
    }
  }
  return true;
}

export function makeFakePrisma(initial: FakeAccount[]) {
  const rows = initial.map((r) => ({ ...r }));
  const find = (id: string) => rows.find((r) => r.id === id);
  const prisma = {
    account: {
      findMany: async ({ where }: any) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
      findUnique: async ({ where }: any) => {
        const r = find(where.id);
        return r ? { ...r } : null;
      },
      update: async ({ where, data }: any) => {
        const r = find(where.id);
        if (!r) throw new Error("fake prisma: no such account");
        Object.assign(r, data);
        return { ...r };
      },
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    accountMember: {
      findFirst: async () => ({ user: { email: "owner@example.com" } }),
    },
  };
  return { prisma, rows, get: (id: string) => ({ ...find(id)! }) };
}

export const ACCOUNT_ID = "acct1";
export const SUB_ID = "sub_1";

export function makeBillingHarness(
  initialAccount: Partial<FakeAccount> = {},
  planForPrice: string = "PRO",
) {
  const db = makeFakePrisma([
    {
      id: ACCOUNT_ID,
      status: "ACTIVE",
      graceEndsAt: null,
      updatedAt: new Date(),
      ...initialAccount,
    },
  ]);

  let subscription: any = null;
  const queue: any[] = [];

  const stripe: any = {
    constructWebhookEvent: () => queue.shift(),
    resolvePlan: () => planForPrice,
  };
  const subscriptionRepo: any = {
    findByStripeSubscriptionId: async () => subscription,
    findByAccountId: async () => subscription,
    findByStripeCustomerId: async () => subscription,
    save: async (s: any) => {
      subscription = s;
    },
  };
  const invoiceRepo: any = {
    save: async () => {},
    findByStripeInvoiceId: async () => null,
    findByAccountId: async () => [],
  };
  const notifications = {
    sendPaymentFailed: { execute: vi.fn().mockResolvedValue(undefined) },
    sendPaymentSucceeded: { execute: vi.fn().mockResolvedValue(undefined) },
    sendSubscriptionCanceled: { execute: vi.fn().mockResolvedValue(undefined) },
  };

  const accountBillingRepo = new PrismaAccountBillingRepository(db.prisma as any);
  // Trackable fake — S4 (E6) tests assert on this to confirm every status
  // change actually invalidates the account's cached gateway/hub entries,
  // not just that Account.status changed in Postgres.
  const cacheInvalidator = { invalidate: vi.fn(async (_accountId: string) => {}) };
  const useCase = new HandleStripeWebhookUseCase(
    stripe,
    subscriptionRepo,
    invoiceRepo,
    accountBillingRepo,
    notifications as any,
    cacheInvalidator,
  );
  const worker = new GracePeriodWorker(db.prisma as any, cacheInvalidator);

  const stripeSub = (status: string) => ({
    id: SUB_ID,
    customer: "cus_1",
    status,
    metadata: { accountId: ACCOUNT_ID },
    items: {
      data: [
        {
          price: { id: "price_1", product: "prod_1" },
          current_period: { start: 1780000000, end: 1782600000 },
        },
      ],
    },
  });

  const invoice = {
    id: "in_1",
    subscription: SUB_ID,
    customer: "cus_1",
    currency: "usd",
    amount_due: 1000,
    amount_paid: 1000,
    status: "open",
  };

  async function send(type: string, object: any) {
    queue.push({ type, data: { object } });
    await useCase.execute(Buffer.from(""), "sig");
  }

  return {
    ...db,
    account: () => db.get(ACCOUNT_ID),
    notifications,
    worker,
    cacheInvalidator,
    /** Events, as Stripe sends them. */
    events: {
      subscriptionCreated: (status = "active") => send("customer.subscription.created", stripeSub(status)),
      subscriptionUpdated: (status: string) => send("customer.subscription.updated", stripeSub(status)),
      subscriptionDeleted: () => send("customer.subscription.deleted", stripeSub("canceled")),
      paymentFailed: () => send("invoice.payment_failed", invoice),
      paymentSucceeded: () => send("invoice.payment_succeeded", { ...invoice, status: "paid" }),
    },
    /** Run one sweep of the real worker (its private tick()). */
    sweep: () => (worker as any).tick() as Promise<void>,
  };
}

export const DAY_MS = 24 * 60 * 60 * 1000;
