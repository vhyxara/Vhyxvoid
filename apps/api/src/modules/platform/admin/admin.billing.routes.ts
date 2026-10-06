// /api/v1/admin/billing — subscriptions, invoices, revenue. Stripe stays the
// source of truth for payments; changes to a subscription happen in Stripe
// (links are returned for that).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { successResponse } from "@/core/utils/response.util";
import { currentDefaultPlan, currentStripePrices, effectivePlanLimits, Plan } from "@vhyxvoid/shared";
import { orderBy, page, pageQuerySchema, prismaOf, rangeQuerySchema, since, skipTake } from "../shared/http";

const stripeDashboard = (path: string) => {
  const test = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test");
  return `https://dashboard.stripe.com/${test ? "test/" : ""}${path}`;
};

export async function adminBillingRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  /**
   * Everything the "Plans & pricing" screen needs to tell an operator whether
   * paid plans would work right now: mode, default plan, Stripe keys, and
   * each configured price looked up live in Stripe.
   */
  fastify.get("/setup", { onRequest: [fastify.requireAbility("billing.read")] }, async (_request, reply) => {
    const settings = fastify.platformSettings;
    const [mode, defaultPlan, checkoutEnabled, trialDays, stored, prices, overrides] = await Promise.all([
      settings.get("billing.mode"),
      currentDefaultPlan(),
      settings.get("billing.checkoutEnabled"),
      settings.get("billing.trialDays"),
      settings.get("billing.stripePrices"),
      currentStripePrices(),
      settings.get("plans.overrides"),
    ]);
    const stripe = fastify.stripeService;
    const lookups = await Promise.all(
      (["PRO", "ENTERPRISE"] as const).map(async (plan) => {
        const id = prices[plan] ?? null;
        const source = !id ? null : stored?.[plan] ? "admin" : "environment";
        if (!id || !stripe.configured) return { plan, id, source, price: null, error: id ? "Stripe keys are not set" : null };
        try {
          return { plan, id, source, price: await stripe.retrievePrice(id), error: null };
        } catch (err) {
          return { plan, id, source, price: null, error: (err as Error).message };
        }
      }),
    );
    const problems: string[] = [];
    if (mode === "paid") {
      if (!stripe.configured) problems.push("Billing mode is paid but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are not set.");
      for (const l of lookups) {
        if (!l.id) problems.push(`No Stripe price for ${l.plan}: it cannot be bought.`);
        else if (l.error) problems.push(`${l.plan}: ${l.error}`);
        else if (l.price && !l.price.active) problems.push(`${l.plan}: the Stripe price is archived.`);
      }
    }
    return successResponse(reply, "Success", 200, {
      mode,
      defaultPlan,
      checkoutEnabled,
      trialDays,
      stripe: { configured: stripe.configured, testMode: (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test") },
      prices: lookups,
      plans: [Plan.FREE, Plan.PRO, Plan.ENTERPRISE].map((plan) => ({ plan, limits: effectivePlanLimits(plan, overrides) })),
      problems,
    });
  });

  fastify.get("/summary", { onRequest: [fastify.requireAbility("billing.read")] }, async (request, reply) => {
    const { days } = rangeQuerySchema.parse(request.query);
    const from = since(days);
    const [byPlanStatus, paid, open, failedRecently, revenueByDay, trialsEndingSoon] = await Promise.all([
      prisma.subscription.groupBy({ by: ["plan", "status"], _count: { _all: true } }),
      prisma.invoice.aggregate({ _sum: { amountPaid: true }, _count: { _all: true }, where: { status: "PAID", paidAt: { gte: from } } }),
      prisma.invoice.aggregate({ _sum: { amountDue: true }, _count: { _all: true }, where: { status: "OPEN" } }),
      prisma.account.count({ where: { status: "PAST_DUE" } }),
      prisma.$queryRaw<Array<{ day: Date; cents: bigint }>>`
        SELECT date_trunc('day', "paidAt") AS day, sum("amountPaid")::bigint AS cents
        FROM "Invoice" WHERE status = 'PAID' AND "paidAt" >= ${from} GROUP BY 1 ORDER BY 1`,
      prisma.subscription.count({ where: { status: "TRIALING", trialEndsAt: { lte: new Date(Date.now() + 7 * 86_400_000) } } }),
    ]);
    return successResponse(reply, "Success", 200, {
      rangeDays: days,
      subscriptions: byPlanStatus.map((r) => ({ plan: r.plan, status: r.status, count: r._count._all })),
      revenue: { paidCents: paid._sum.amountPaid ?? 0, paidInvoices: paid._count._all, byDay: revenueByDay.map((r) => ({ day: r.day.toISOString().slice(0, 10), cents: Number(r.cents) })) },
      outstanding: { cents: open._sum.amountDue ?? 0, invoices: open._count._all },
      pastDueAccounts: failedRecently,
      trialsEndingIn7Days: trialsEndingSoon,
      stripeConfigured: fastify.stripeService.configured,
    });
  });

  fastify.get("/subscriptions", { onRequest: [fastify.requireAbility("billing.read")] }, async (request) => {
    const q = pageQuerySchema.extend({ status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "UNPAID", "INCOMPLETE", "PAUSED"]).optional(), plan: z.enum(["FREE", "PRO", "ENTERPRISE"]).optional() }).parse(request.query);
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.plan ? { plan: q.plan } : {}),
      ...(q.search ? { OR: [{ stripeSubscriptionId: q.search }, { stripeCustomerId: q.search }, { account: { name: { contains: q.search, mode: "insensitive" as const } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.subscription.findMany({ where, orderBy: orderBy(q, ["createdAt", "currentPeriodEnd", "status"] as const, "createdAt"), ...skipTake(q), include: { account: { select: { id: true, name: true, slug: true, status: true } } } }),
      prisma.subscription.count({ where }),
    ]);
    return page(rows.map((s) => ({ ...s, stripeUrl: stripeDashboard(`subscriptions/${s.stripeSubscriptionId}`) })), total, q);
  });

  fastify.get("/invoices", { onRequest: [fastify.requireAbility("billing.read")] }, async (request) => {
    const q = pageQuerySchema.extend({ status: z.enum(["DRAFT", "OPEN", "PAID", "UNCOLLECTIBLE", "VOID"]).optional(), accountId: z.string().uuid().optional() }).parse(request.query);
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.search ? { OR: [{ stripeInvoiceId: q.search }, { account: { name: { contains: q.search, mode: "insensitive" as const } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({ where, orderBy: orderBy(q, ["createdAt", "paidAt", "amountDue"] as const, "createdAt"), ...skipTake(q), include: { account: { select: { id: true, name: true } } } }),
      prisma.invoice.count({ where }),
    ]);
    return page(rows.map((i) => ({ ...i, stripeUrl: stripeDashboard(`invoices/${i.stripeInvoiceId}`) })), total, q);
  });
}
