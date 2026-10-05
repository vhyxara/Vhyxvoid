import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { registerRateLimitFirst } from "../../apps/api/src/core/utils/rateLimitFirst";
import { adminRoutes } from "../../apps/api/src/modules/identity/presentation/http/admin/admin.routes";
import { AdminAuditLog } from "../../apps/api/src/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { PrismaAdminAuditLogRepository } from "../../apps/api/src/modules/identity/infrastructure/prisma/admin/PrismaAdminAuditLogRepository";
import { RedisApiKeyCacheService } from "../../apps/api/src/modules/key-management/domain/services/RedisApiKeyCache.service";
import { FlushUsageWorker } from "../../apps/api/src/modules/key-management/application/use-cases/FlushUsageWorker.usecase";
import { apiKeyRoutes } from "../../apps/api/src/modules/key-management/presentation/http/apiKey.routes";
import { generateAccountSlug, isValidSlug } from "../../apps/api/src/core/utils/slug.util";
import {
  SendPaymentFailedEmailUseCase,
  SendSubscriptionCanceledEmailUseCase,
  SendTrialEndingEmailUseCase,
} from "../../apps/api/src/modules/notification/application/use-cases";
import { HandleStripeWebhookUseCase } from "../../apps/api/src/modules/billing/application/use-cases/webhook/HandleStripeWebhook.usecase";
import { PrismaUsageAggregateRepository } from "../../apps/api/src/modules/key-management/domain/repositories/UsageAggregate.repositories";

// api backlog items resolved 2026-10-05 (see code-archive/api/).

/** Registers adminRoutes against a stand-in Fastify and returns its handlers. */
async function captureAdminRoutes(uow: any) {
  const routes = new Map<string, any>();
  const capture = (m: string) => (p: string, a: any, b?: any) => routes.set(`${m} ${p}`, b ?? a);
  const fastify = new Proxy(
    { get: capture("GET"), post: capture("POST"), put: capture("PUT"), patch: capture("PATCH"), delete: capture("DELETE"), uow },
    { get: (t: any, k) => (k in t ? t[k] : () => async () => {}) },
  );
  await adminRoutes(fastify as any);
  return routes;
}

function fakeReply() {
  const reply: any = { statusCode: 0, body: undefined };
  reply.status = (c: number) => ((reply.statusCode = c), reply);
  reply.send = (b: unknown) => ((reply.body = b), reply);
  return reply;
}

const log = () => AdminAuditLog.create({ adminId: "a1", action: "role.created", targetType: "Role" });

describe("GET /admin/identity/audit-logs carries a total", () => {
  it("returns data as the same bare array plus meta.total for the unfiltered list", async () => {
    const repo = {
      findAll: vi.fn(async () => [log(), log()]),
      countAll: vi.fn(async () => 57),
    };
    const routes = await captureAdminRoutes({ adminAuditLogRepository: repo });
    const reply = fakeReply();
    await routes.get("GET /audit-logs")({ query: { limit: "2", offset: "4" } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(Array.isArray(reply.body.data)).toBe(true);
    expect(reply.body.data).toHaveLength(2);
    expect(reply.body.meta).toEqual({ total: 57, limit: 2, offset: 4 });
    expect(repo.findAll).toHaveBeenCalledWith(2, 4);
  });

  it("counts with the same filter as the page (action)", async () => {
    const repo = {
      findByAction: vi.fn(async () => [log()]),
      countByAction: vi.fn(async () => 9),
    };
    const routes = await captureAdminRoutes({ adminAuditLogRepository: repo });
    const reply = fakeReply();
    await routes.get("GET /audit-logs")({ query: { action: "role.created" } }, reply);

    expect(repo.countByAction).toHaveBeenCalledWith("role.created");
    expect(reply.body.meta.total).toBe(9);
  });
});

describe("PrismaAdminAuditLogRepository excludes orphaned rows in the query", () => {
  it("pages and counts with adminId not null, so a page is never short and the total matches", async () => {
    const prisma = {
      adminAuditLog: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
    };
    const repo = new PrismaAdminAuditLogRepository(prisma as any);
    await repo.findAll(10, 0);
    await repo.findByAction("x");
    await repo.findByTargetId("t");
    await repo.countAll();
    await repo.countByAction("x");
    await repo.countByTargetId("t");

    for (const [args] of prisma.adminAuditLog.findMany.mock.calls as any[]) {
      expect(args.where.adminId).toEqual({ not: null });
    }
    for (const [args] of prisma.adminAuditLog.count.mock.calls as any[]) {
      expect(args.where.adminId).toEqual({ not: null });
    }
  });
});

// ── Usage pipeline (api backlog: drain delete-before-write, H4 remainder) ────

/** In-memory Upstash stand-in: SCAN, pipelined GETDEL, INCRBY, EXPIRE. */
function fakeUpstash(store: Map<string, number>) {
  const ttl = new Map<string, number>();
  return {
    ttl,
    scan: vi.fn(async (_c: number, opts: { match: string }) => {
      const prefix = opts.match.replace(/\*$/, "");
      return ["0", [...store.keys()].filter((k) => k.startsWith(prefix))];
    }),
    pipeline: () => {
      const q: string[] = [];
      return {
        getdel: (k: string) => void q.push(k),
        exec: async () =>
          q.map((k) => {
            const v = store.get(k) ?? null;
            store.delete(k);
            return v;
          }),
      };
    },
    incrby: vi.fn(async (k: string, n: number) => {
      store.set(k, (store.get(k) ?? 0) + n);
      return store.get(k);
    }),
    expire: vi.fn(async (k: string, sec: number) => void ttl.set(k, sec)),
  };
}

/** A usage bucket key for `minutesAgo` minutes before now (5-minute aligned). */
function bucketKey(account: string, key: string, minutesAgo: number) {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const bucket = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(Math.floor(d.getUTCMinutes() / 5) * 5)}`;
  return `usage:${account}:${key}:requests:${bucket}`;
}

describe("FlushUsageWorker puts a count back when its Postgres write fails", () => {
  it("restores the drained count into Redis and the next tick writes it", async () => {
    const key = bucketKey("acct_a", "_public", 10);
    const store = new Map([[key, 7]]);
    const redis = fakeUpstash(store);
    const writes: bigint[] = [];
    let fail = true;
    const repo = {
      upsertQuantity: vi.fn(async (p: any) => {
        if (fail) throw new Error("db blip");
        writes.push(p.quantity);
      }),
    };
    const worker = new FlushUsageWorker(new RedisApiKeyCacheService(redis as any), repo as any, {} as any);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await worker.runForPendingAccounts(async (ids) => ids);
    expect(store.get(key)).toBe(7);
    // Keeps its original lifetime (25 h from the bucket), not a fresh 25 h.
    expect(redis.ttl.get(key)!).toBeLessThan(25 * 3600 - 9 * 60);
    expect(redis.ttl.get(key)!).toBeGreaterThan(25 * 3600 - 20 * 60);
    expect(err.mock.calls[0][1]).toMatch(/put back in Redis/);

    fail = false;
    await worker.runForPendingAccounts(async (ids) => ids);
    err.mockRestore();
    expect(writes).toEqual([7n]);
    expect(store.size).toBe(0);
  });

  it("drops (and says so) a counter already past its 25 h lifetime", async () => {
    const key = bucketKey("acct_a", "_public", 26 * 60);
    const store = new Map([[key, 3]]);
    const redis = fakeUpstash(store);
    const repo = { upsertQuantity: vi.fn(async () => { throw new Error("fk"); }) };
    const worker = new FlushUsageWorker(new RedisApiKeyCacheService(redis as any), repo as any, {} as any);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await worker.run(["acct_a"]);
    const message = err.mock.calls[0][1];
    err.mockRestore();

    expect(store.size).toBe(0);
    expect(redis.incrby).not.toHaveBeenCalled();
    expect(message).toMatch(/it is lost/);
  });
});

describe("FlushUsageWorker scans Redis once per tick (H4 c)", () => {
  it("drains several accounts with a single SCAN", async () => {
    const store = new Map([
      [bucketKey("acct_a", "_public", 10), 1],
      [bucketKey("acct_b", "_public", 10), 2],
      [bucketKey("acct_c", "_public", 10), 3],
    ]);
    const redis = fakeUpstash(store);
    const repo = { upsertQuantity: vi.fn(async () => {}) };
    const worker = new FlushUsageWorker(new RedisApiKeyCacheService(redis as any), repo as any, {} as any);

    await worker.runForPendingAccounts(async (ids) => ids);

    expect(redis.scan).toHaveBeenCalledTimes(1);
    expect(repo.upsertQuantity).toHaveBeenCalledTimes(3);
    expect(store.size).toBe(0);
  });
});

describe("Usage buckets are stored and read by their own time span (H4 a, b)", () => {
  it("writes periodEnd as the bucket's end, not the flush time", async () => {
    const store = new Map([[bucketKey("acct_a", "_public", 60), 4]]);
    const repo = { upsertQuantity: vi.fn(async () => {}) };
    const worker = new FlushUsageWorker(new RedisApiKeyCacheService(fakeUpstash(store) as any), repo as any, {} as any);

    await worker.run(["acct_a"]);

    const { periodStart, periodEnd } = (repo.upsertQuantity.mock.calls[0] as any)[0];
    expect(periodEnd.getTime() - periodStart.getTime()).toBe(5 * 60_000);
    expect(periodEnd.getTime()).toBeLessThan(Date.now() - 50 * 60_000);
  });

  it("account-level reads include keyed rows and window on the bucket start", async () => {
    const prisma = { usageAggregate: { findMany: vi.fn(async () => []) } };
    const repo = new PrismaUsageAggregateRepository(prisma as any);
    const period = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-02T00:00:00Z") };

    await repo.findByAccountAndPeriod("acct_a", period);
    await repo.findByApiKeyAndPeriod("key_row", period);

    const [acct, key] = prisma.usageAggregate.findMany.mock.calls.map((c: any) => c[0].where);
    expect("apiKeyId" in acct).toBe(false);
    for (const where of [acct, key]) {
      expect(where.periodStart).toEqual({ gte: period.start, lt: period.end });
      expect(where.periodEnd).toBeUndefined();
    }
  });
});

// ── customer.subscription.trial_will_end (api backlog, audit part2 G11) ─────

function trialWebhook(object: any, opts: { ownerEmail?: string | null; subAccountId?: string | null } = {}) {
  const sendTrialEnding = { execute: vi.fn(async () => {}) };
  const uc = new HandleStripeWebhookUseCase(
    { constructWebhookEvent: () => ({ id: "evt_t", type: "customer.subscription.trial_will_end", data: { object } }) } as any,
    {
      findByStripeSubscriptionId: async () => (opts.subAccountId ? { accountId: opts.subAccountId } : null),
      findByStripeCustomerId: async () => null,
    } as any,
    {} as any,
    {
      getAccountOwnerEmail: vi.fn(async () => (opts.ownerEmail === undefined ? "owner@example.com" : opts.ownerEmail)),
      findAccountIdByStripeCustomerId: async () => "acct_from_customer",
    } as any,
    { sendTrialEnding } as any,
  );
  return { uc, sendTrialEnding };
}

describe("Stripe trial_will_end emails the account owner", () => {
  it("sends the trial-ending email with the trial end and days left", async () => {
    const trialEnd = Math.floor((Date.now() + 3 * 24 * 3600_000 - 60_000) / 1000);
    const { uc, sendTrialEnding } = trialWebhook(
      { id: "sub_1", customer: "cus_1", trial_end: trialEnd },
      { subAccountId: "acct_1" },
    );

    expect(await uc.execute(Buffer.from(""), "sig")).toEqual({ received: true });

    expect(sendTrialEnding.execute).toHaveBeenCalledOnce();
    const args = (sendTrialEnding.execute.mock.calls[0] as any)[0];
    expect(args.to).toBe("owner@example.com");
    expect(args.trialEndsAt.getTime()).toBe(trialEnd * 1000);
    expect(args.daysLeft).toBe(3);
    expect(args.accountId).toBe("acct_1");
  });

  it("finds the account from the Stripe customer when no subscription row exists yet", async () => {
    const { uc, sendTrialEnding } = trialWebhook({ id: "sub_new", customer: "cus_1", trial_end: Math.floor(Date.now() / 1000) + 86400 });
    await uc.execute(Buffer.from(""), "sig");
    expect(sendTrialEnding.execute).toHaveBeenCalledOnce();
  });

  it("sends nothing without a trial end or an owner email", async () => {
    for (const [object, ownerEmail] of [
      [{ id: "sub_1", customer: "cus_1", trial_end: null }, "owner@example.com"],
      [{ id: "sub_1", customer: "cus_1", trial_end: 2_000_000_000 }, null],
    ] as const) {
      const { uc, sendTrialEnding } = trialWebhook(object, { ownerEmail });
      expect(await uc.execute(Buffer.from(""), "sig")).toEqual({ received: true });
      expect(sendTrialEnding.execute).not.toHaveBeenCalled();
    }
  });
});

// ── Rate limiting counts requests a route guard rejects (api backlog, H1) ───

const requireFromApi = createRequire(require.resolve("../../apps/api/package.json"));

/** The api's registration order: limiter, CORS, then routes in a child plugin. */
async function guardedApp(max: number) {
  const Fastify = requireFromApi("fastify");
  const app = Fastify();
  const guard = vi.fn(async (_req: any, reply: any) => reply.code(401).send({ success: false }));
  await registerRateLimitFirst(app, { max, timeWindow: "1 minute" });
  await app.register(requireFromApi("@fastify/cors"), { origin: ["https://app.example"], credentials: true });
  await app.register(async (child: any) => {
    child.get("/me", { onRequest: [guard] }, async () => ({ ok: true }));
    child.get("/open", async () => ({ ok: true }));
    child.post("/login", { config: { rateLimit: { max: 1, timeWindow: "1 minute" } }, onRequest: guard }, async () => ({}));
  });
  await app.ready();
  return { app, guard };
}

describe("registerRateLimitFirst", () => {
  it("answers 429 once an unauthenticated client passes the limit, before the guard runs", async () => {
    const { app, guard } = await guardedApp(3);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await app.inject({ method: "GET", url: "/me" })).statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    expect(guard).toHaveBeenCalledTimes(3);
    await app.close();
  });

  it("the 429 carries the CORS headers, so a browser sees the 429", async () => {
    const { app } = await guardedApp(1);
    const headers = { origin: "https://app.example" };
    await app.inject({ method: "GET", url: "/me", headers });
    const res = await app.inject({ method: "GET", url: "/me", headers });
    expect(res.statusCode).toBe(429);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example");
    await app.close();
  });

  it("applies to routes without guards and to per-route limits given as a single hook", async () => {
    const { app, guard } = await guardedApp(2);
    const open = [];
    for (let i = 0; i < 3; i++) open.push((await app.inject({ method: "GET", url: "/open" })).statusCode);
    expect(open).toEqual([200, 200, 429]);
    const login = [];
    for (let i = 0; i < 2; i++) login.push((await app.inject({ method: "POST", url: "/login" })).statusCode);
    expect(login).toEqual([401, 429]);
    expect(guard).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

// ── maxApiKeys enforced once, after membership (shared backlog, S2) ─────────

describe("POST /organizations/:accountId/api-keys", () => {
  it("has no plan-limit guard ahead of the use case: only the auth guard runs before it", async () => {
    const routes = new Map<string, any>();
    const userAuthGuard = async () => {};
    const capture = (m: string) => (p: string, a: any) => routes.set(`${m} ${p}`, a);
    const fastify = new Proxy(
      { get: capture("GET"), post: capture("POST"), put: capture("PUT"), patch: capture("PATCH"), delete: capture("DELETE"),
        userAuthGuard, container: { resolve: () => ({}) } },
      { get: (t: any, k) => (k in t ? t[k] : () => async () => {}) },
    );
    await apiKeyRoutes(fastify as any);

    expect(routes.get("POST /organizations/:accountId/api-keys").onRequest).toEqual([userAuthGuard]);
  });
});

// ── Reserved hostnames (docs backlog, 2026-09-19) ────────────────────────────
// docs., api., hub., admin., app., www. can't collide with a tunnel: a tunnel
// host is always <slug>--<label> (the hub rejects a host without "--"), and
// every generated slug carries a random suffix (audit H11).

describe("account slugs never take a bare service hostname", () => {
  it("a workspace named after a service host still gets a suffixed slug", () => {
    for (const name of ["docs", "api", "hub", "admin", "app", "www"]) {
      const slug = generateAccountSlug(name);
      expect(slug).not.toBe(name);
      expect(slug).toMatch(new RegExp(`^${name}-[a-z0-9]{8}$`));
      expect(isValidSlug(slug)).toBe(true);
    }
  });
});

// ── Billing emails link to the real Billing page (new finding 2026-10-05) ───

describe("billing emails link to /organizations/<accountId>/billing", () => {
  it("payment failed, subscription canceled and trial ending all point at the account's Billing page", async () => {
    const sent: Array<{ html: string; text: string }> = [];
    const email = { send: vi.fn(async (m: any) => void sent.push(m)) };
    const when = new Date("2026-10-10T00:00:00Z");
    const common = { to: "o@example.com", firstName: "", accountName: "Acme", accountId: "acct_1" };

    await new SendPaymentFailedEmailUseCase(email as any).execute({ ...common, amountFormatted: "$29.00", graceEndsAt: when });
    await new SendSubscriptionCanceledEmailUseCase(email as any).execute({ ...common, accessEndsAt: when });
    await new SendTrialEndingEmailUseCase(email as any).execute({ ...common, trialEndsAt: when, daysLeft: 3 });

    expect(sent).toHaveLength(3);
    for (const m of sent) {
      expect(m.text).toContain("/organizations/acct_1/billing");
      expect(m.html).toContain("/organizations/acct_1/billing");
      expect(m.text).not.toContain("/settings/billing");
    }
  });
});
