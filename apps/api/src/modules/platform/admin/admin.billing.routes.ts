// /api/v1/admin/billing — subscriptions, invoices, revenue. Stripe stays the
// source of truth for payments; changes to a subscription happen in Stripe
// (links are returned for that).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { successResponse } from "@/core/utils/response.util";
import { orderBy, page, pageQuerySchema, prismaOf, rangeQuerySchema, since, skipTake } from "../shared/http";

const stripeDashboard = (path: string) => {
  const test = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test");
  return `https://dashboard.stripe.com/${test ? "test/" : ""}${path}`;
};

export async function adminBillingRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

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
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
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
