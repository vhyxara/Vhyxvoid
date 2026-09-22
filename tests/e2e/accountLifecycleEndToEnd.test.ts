import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { MessageRouter } from "../../apps/hub/src/router/Message.router";
import { AgentRegistry } from "../../apps/hub/src/registry/Agent.registry";
import { TunnelSessionRepository } from "../../apps/hub/src/repositories/TunnelSession.repository";
import { HubAuthService } from "../../apps/hub/src/services/HubAuth.service";
import { AccountStatusSweepService } from "../../apps/hub/src/services/AccountStatusSweep.service";
import { HandleStripeWebhookUseCase } from "../../apps/api/src/modules/billing/application/use-cases/webhook/HandleStripeWebhook.usecase";
import { PrismaAccountBillingRepository } from "../../apps/api/src/modules/billing/domain/repositories/PrismaAccountBillingRepository";
import { GracePeriodWorker } from "../../apps/api/src/modules/billing/infrastructure/workers/GracePeriod.worker";
import { DAY_MS } from "./billingHarness";

// The brief's explicit end-to-end requirement for S4 (E6): a PAST_DUE
// account CAN connect during its grace period; once GracePeriodWorker
// suspends it (deadline passed), the sweep evicts its live connection
// within one interval. Real code throughout, on both sides of the system:
// the real webhook use case and GracePeriodWorker (apps/api) mutate ONE
// fake Postgres `account`/`subscription`/`apiKey` table set, and the real
// HubAuthService/MessageRouter/AgentRegistry/AccountStatusSweepService
// (apps/hub) read that SAME table set — exactly like the real system, where
// both processes point at the same Postgres. Only Redis, Stripe and the
// WebSocket are faked.

const ACCOUNT_ID = "acct_e2e";
const KEY_ID = "key_e2e";
const PEPPER = "p".repeat(40);
const RAW_SECRET = "the-raw-secret";
const SECRET_HASH = crypto.createHmac("sha256", PEPPER).update(RAW_SECRET).digest("hex");
const NOW = new Date("2026-09-22T12:00:00.000Z");

function makeSystem() {
  const account = {
    id: ACCOUNT_ID,
    status: "ACTIVE",
    graceEndsAt: null as Date | null,
    updatedAt: new Date(),
  };
  let subscription: any = null; // no subscription row — FREE, irrelevant to this test
  const apiKeyRow = { keyId: KEY_ID, secretHash: SECRET_HASH, accountId: ACCOUNT_ID };

  // ── One fake Prisma, read/written by both the api-side and hub-side code ──
  const prisma = {
    account: {
      findUnique: async ({ where, select }: any) => {
        if (where.id !== ACCOUNT_ID) return null;
        if (select?.slug) return { slug: "e2e-org" };
        return { status: account.status, graceEndsAt: account.graceEndsAt };
      },
      findMany: async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        if (!ids.includes(ACCOUNT_ID)) return [];
        return [{ id: ACCOUNT_ID, status: account.status }];
      },
      update: async ({ where, data }: any) => {
        if (where.id !== ACCOUNT_ID) throw new Error("no such account");
        Object.assign(account, data);
        return { ...account };
      },
      updateMany: async ({ where, data }: any) => {
        if (where.id !== ACCOUNT_ID) return { count: 0 };
        if ("status" in where && where.status !== account.status) return { count: 0 };
        if ("graceEndsAt" in where && where.graceEndsAt === null && account.graceEndsAt !== null) {
          return { count: 0 };
        }
        Object.assign(account, data);
        return { count: 1 };
      },
      findFirst: async ({ where }: any) => {
        if (where.status === "PAST_DUE" && account.status === "PAST_DUE" && account.graceEndsAt && account.graceEndsAt <= NOW) {
          return { id: ACCOUNT_ID, graceEndsAt: account.graceEndsAt };
        }
        return null;
      },
    },
    subscription: {
      findFirst: async ({ where }: any) => (where.accountId === ACCOUNT_ID && subscription ? { plan: subscription.plan } : null),
    },
    apiKey: {
      findUnique: async ({ where }: any) => (where.keyId === KEY_ID ? { id: `internal_${KEY_ID}`, accountId: ACCOUNT_ID } : null),
    },
    accountMember: { findFirst: async () => null },
  };

  // Matches GracePeriodWorker's own account.findMany filter (status +
  // graceEndsAt <= now) — reuse the same fake account.findMany used above
  // isn't quite right since the worker's query shape differs slightly
  // (no `id: { in }`), so give it its own thin adapter over the same state.
  const workerPrisma = {
    account: {
      findMany: async ({ where }: any) => {
        if (where.status !== "PAST_DUE") return [];
        if (account.status !== "PAST_DUE") return [];
        if (!account.graceEndsAt || account.graceEndsAt > where.graceEndsAt.lte) return [];
        return [{ id: ACCOUNT_ID, graceEndsAt: account.graceEndsAt }];
      },
      update: prisma.account.update,
    },
  };

  // ── apps/api side: real webhook use case + real worker ──
  const cacheInvalidator = { invalidate: vi.fn(async () => {}) };
  const stripe: any = { constructWebhookEvent: (buf: Buffer) => JSON.parse(buf.toString()), resolvePlan: () => "PRO" };
  const subscriptionRepo: any = {
    findByStripeSubscriptionId: async () => subscription,
    findByAccountId: async () => subscription,
    findByStripeCustomerId: async () => subscription,
    save: async (s: any) => { subscription = s; },
  };
  const invoiceRepo: any = { save: async () => {}, findByStripeInvoiceId: async () => null };
  const accountBillingRepo = new PrismaAccountBillingRepository(prisma as any);
  const webhookUseCase = new HandleStripeWebhookUseCase(
    stripe,
    subscriptionRepo,
    invoiceRepo,
    accountBillingRepo,
    undefined,
    cacheInvalidator,
  );
  const worker = new GracePeriodWorker(workerPrisma as any, cacheInvalidator);

  async function stripeEvent(type: string, object: any) {
    await webhookUseCase.execute(Buffer.from(JSON.stringify({ type, data: { object } })), "sig");
  }
  const subObject = (status: string) => ({
    id: "sub_e2e",
    customer: "cus_e2e",
    status,
    metadata: { accountId: ACCOUNT_ID },
    items: { data: [{ price: { id: "price_1", product: "prod_1" }, current_period: { start: 1780000000, end: 1782600000 } }] },
  });
  const invoiceObject = { id: "in_e2e", subscription: "sub_e2e", customer: "cus_e2e", currency: "usd", amount_due: 1000 };

  // ── apps/hub side: real HubAuthService + MessageRouter + AgentRegistry + sweep ──
  const agentRegistry = new AgentRegistry();
  const sessionRepo = new TunnelSessionRepository(prisma as any);
  const authService = new HubAuthService(
    {} as any,
    PEPPER,
    async (keyId: string) => {
      if (keyId !== KEY_ID) return null;
      return {
        secretHash: SECRET_HASH,
        accountId: ACCOUNT_ID,
        scopes: ["tunnel:connect"],
        status: "ACTIVE",
        accountStatus: account.status,
      };
    },
  );
  const httpTunnelHandler = { closeAllForAgent: () => 0 } as any;
  const router = new MessageRouter(
    agentRegistry,
    {} as any,
    { rejectAllForAgent: () => 0 } as any,
    authService,
    {} as any,
    { increment: () => {} } as any,
    {} as any,
    sessionRepo,
    {} as any,
    "hub_e2e",
    { register: async () => {}, unregister: async () => {} } as any,
    "vhyxvoid.com",
    httpTunnelHandler,
  );
  const sweep = new AccountStatusSweepService(
    agentRegistry,
    { rejectAllForAgent: () => 0 } as any,
    sessionRepo,
    httpTunnelHandler,
    { del: async () => 1 },
  );

  async function connectAgent(label: string) {
    const sent: any[] = [];
    let closed = false;
    const ws = {
      readyState: 1,
      send: (raw: string) => sent.push(JSON.parse(raw)),
      close: () => { closed = true; },
    };
    await router.routeAgentMessage(
      ws,
      Buffer.from(JSON.stringify({ v: "1", type: "agent:register", keyId: KEY_ID, label, rawSecret: RAW_SECRET, agentVersion: "1.0.0" })),
      "127.0.0.1",
    );
    return {
      ws,
      accepted: sent.some((m) => m.type === "hub:registered"),
      isClosed: () => closed,
      /** Live — re-evaluated on each call, so it also sees a later sweep eviction's hub:error. */
      lastError: () => sent.filter((m) => m.type === "hub:error").at(-1) ?? null,
    };
  }

  return { account, stripeEvent, subObject, invoiceObject, worker, connectAgent, agentRegistry, sweep };
}

describe("account status lifecycle, end to end (S4, E6)", () => {
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

  it("PAST_DUE can connect; once the worker suspends the account, the sweep evicts the live connection within one interval", async () => {
    const sys = makeSystem();
    await sys.stripeEvent("customer.subscription.created", sys.subObject("active"));

    // 1. Healthy: connects normally.
    const first = await sys.connectAgent("web");
    expect(first.accepted).toBe(true);

    // 2. Payment fails: account becomes PAST_DUE. The already-connected
    // agent is untouched — PAST_DUE is connectable, the sweep does nothing.
    await sys.stripeEvent("invoice.payment_failed", sys.invoiceObject);
    expect(sys.account.status).toBe("PAST_DUE");
    await sys.sweep.tick();
    expect(first.isClosed()).toBe(false);
    expect(sys.agentRegistry.findByAgentId).toBeDefined();

    // 3. A brand new connection attempt, opened WHILE PAST_DUE, also
    // succeeds — this is the handshake half of Part 4, exercised for real.
    const second = await sys.connectAgent("api");
    expect(second.accepted).toBe(true);

    // 4. The grace period expires; GracePeriodWorker suspends the account.
    vi.setSystemTime(new Date(NOW.getTime() + 8 * DAY_MS));
    await sys.worker.tick();
    expect(sys.account.status).toBe("SUSPENDED");

    // 5. One sweep interval later, BOTH live connections are evicted with a
    // real reason, not a bare disconnect.
    await sys.sweep.tick();

    expect(first.isClosed()).toBe(true);
    expect(first.lastError()).toMatchObject({ code: "AUTH_FAILED", message: "Account is not active", fatal: true });
    expect(second.isClosed()).toBe(true);
    expect(second.lastError()).toMatchObject({ code: "AUTH_FAILED", fatal: true });

    // 6. And a further connection attempt is refused at the handshake too.
    const third = await sys.connectAgent("web2");
    expect(third.accepted).toBe(false);
    expect(third.lastError()).toMatchObject({ code: "AUTH_FAILED", message: "Account is not active" });
  });

  it("an ACTIVE account's live connection survives a sweep untouched", async () => {
    const sys = makeSystem();
    const agent = await sys.connectAgent("web");
    expect(agent.accepted).toBe(true);

    await sys.sweep.tick();

    expect(agent.isClosed()).toBe(false);
  });
});
