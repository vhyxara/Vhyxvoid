// apps/api/src/presentation/routes/user/tunnelRoutes.ts
//
// REST routes for tunnel management — mounted under /accounts/organizations/:accountId/tunnels
// These routes query the DB for session/request data logged by the hub.
// Auth: userAuthGuard (same as accountRoutes.ts)

import { RoleLevel } from "@/core/constant/account.constant";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/core/errors/error.format";
import { successResponse, tableResponse } from "@/core/utils/response.util";
import {
  buildTimeSeries,
  rangeToWindow,
} from "@/modules/identity/domain/services/tunnel.utility";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { FastifyInstance } from "fastify";
import { z } from "zod";

// ── Schemas ───────────────────────────────────────────────────────────────────

const accountParamSchema = z.object({
  accountId: z.string().uuid(),
});

const sessionParamSchema = z.object({
  accountId: z.string().uuid(),
  agentId: z.string().min(1),
});

// ── 2. Tunnel history (paginated) ─────────────────────────────────────────
const tunnelHistoryQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(["CONNECTED", "DISCONNECTED", "EVICTED"]).optional(),
  search: z.string().optional(),
  sortBy: z
    .enum(["connectedAt", "disconnectedAt", "label", "status"])
    .default("connectedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const tunnelUsageQuerySchema = z.object({
  from: z
    .string()
    .datetime({ message: "from must be ISO 8601" })
    .optional()
    .default(
      () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // last 7 days
    ),

  to: z
    .string()
    .datetime({ message: "to must be ISO 8601" })
    .optional()
    .default(() => new Date().toISOString()), // now
});
const requestsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(500).default(100),
  search: z.string().optional(),
  sortBy: z
    .enum(["createdAt", "method", "path", "status", "durationMs"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const usageQuerySchema = z.object({
  // Preset ranges for the dashboard date picker
  range: z.enum(["24h", "7d", "30d", "90d"]).default("30d"),
  // Optional: scope to a specific API key
  keyId: z.string().uuid().optional(),
  metric: z
    .enum(["requests", "bandwidth_bytes", "tunnel_minutes"])
    .default("requests"),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export async function tunnelRoutes(fastify: FastifyInstance) {
  /**
   * List active tunnel sessions for an account
   * GET /accounts/organizations/:accountId/tunnels
   * Auth: MEMBER+
   *
   * Returns all currently CONNECTED agents for the account.
   * Used by dashboard "active tunnels" view.
   */
  fastify.get<{ Params: z.infer<typeof accountParamSchema> }>(
    "/organizations/:accountId/tunnels",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const user = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      // Verify membership
      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        user.id,
      );
      if (!membership) {
        // return reply
        //   .code(403)
        //   .send({ error: "You are not a member of this account" });
        throw new ForbiddenError("You are not a member of this account");
      }

      const sessions =
        await uow.tunnelSessionRepository.findConnectedByAccount(accountId);
      const tunnels = sessions.map((s: any) => ({
        agentId: s.agentId,
        label: s.label,
        status: s.status,
        connectedAt: s.connectedAt,
        hubInstanceId: s.hubInstanceId,
        metadata: s.metadata,
        apiKey: s.apiKey
          ? {
              keyId: s.apiKey.keyId,
              name: s.apiKey.name,
              environment: s.apiKey.environment,
            }
          : null,
      }));
      return successResponse(
        reply,
        "Active tunnels fetched successfully",
        200,
        {
          accountId,
          activeSessions: tunnels,
          activeCount: tunnels.length,
        },
      );
    },
  );

  /**
   * List tunnel session history for an account
   * GET /accounts/organizations/:accountId/tunnels/history
   * Auth: ADMIN+
   */
  fastify.get<{
    Params: z.infer<typeof tunnelHistoryQuerySchema>;
    Querystring: z.infer<typeof tunnelHistoryQuerySchema>;
  }>(
    "/organizations/:accountId/tunnels/history",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const query = tunnelHistoryQuerySchema.parse(request.query);
      const user = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        user.id,
      );
      if (!membership || membership.roleLevel < RoleLevel.ADMIN) {
        // return reply.code(403).send({ error: "Admin role required" });
        throw new ForbiddenError("Admin role required");
      }

      const history = await uow.tunnelSessionRepository.findByAccount(
        accountId,
        50,
      );

      // return reply.send({ accountId, history });

      const prisma = fastify.prisma as any;

      const whereStatus = query.status
        ? { status: query.status }
        : { status: { in: ["DISCONNECTED", "EVICTED"] } };

      const whereSearch = query.search
        ? { label: { contains: query.search, mode: "insensitive" } }
        : {};

      const where = { accountId, ...whereStatus, ...whereSearch };

      const orderBy: any = { [query.sortBy]: query.sortOrder };
      const offset = (query.page - 1) * query.limit;

      const [sessions, total] = await Promise.all([
        prisma.tunnelSession.findMany({
          where,
          orderBy,
          take: query.limit,
          skip: offset,
          include: {
            apiKey: { select: { keyId: true, name: true, environment: true } },
          },
        }),
        prisma.tunnelSession.count({ where }),
      ]);

      const items = sessions.map((s: any) => ({
        agentId: s.agentId,
        label: s.label,
        status: s.status,
        connectedAt: s.connectedAt,
        disconnectedAt: s.disconnectedAt,
        durationMs: s.disconnectedAt
          ? s.disconnectedAt.getTime() - s.connectedAt.getTime()
          : null,
        apiKey: s.apiKey
          ? {
              keyId: s.apiKey.keyId,
              name: s.apiKey.name,
              environment: s.apiKey.environment,
            }
          : null,
      }));

      // return tableResponse(
      return tableResponse(
        reply,
        {
          items: items, // just pass the array directly
          page: query.page,
          limit: query.limit,
          total,
          extra: { accountId },
        },
        "Tunnel history fetched",
      );

      //   reply,
      //   {
      //     items: { items: items, history: history },
      //     page: query.page,
      //     limit: query.limit,
      //     total,
      //     extra: { accountId },
      //   },
      //   "Tunnel history fetched",
      // );
    },
  );

  /**
   * Get requests for a specific tunnel session
   * GET /accounts/organizations/:accountId/tunnels/:agentId/requests
   * Auth: ADMIN+
   *
   * Returns the last 100 requests routed through this session.
   * Used for debugging — see exactly what went through the tunnel.
   */
  fastify.get<{
    Params: z.infer<typeof sessionParamSchema>;
    Querystring: z.infer<typeof requestsQuerySchema>;
  }>(
    "/organizations/:accountId/tunnels/:agentId/requests",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId, agentId } = sessionParamSchema.parse(request.params);
      const query = requestsQuerySchema.parse(request.query);
      const user = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        user.id,
      );
      if (!membership || membership.roleLevel < RoleLevel.ADMIN) {
        // return reply.code(403).send({ error: "Admin role required" });
        throw new ForbiddenError("Admin role required");
      }

      // FIX: Resolve TunnelSession internal id from the hub-assigned agentId
      // TunnelRequestRepository.findBySession() expects TunnelSession.id (UUID)
      // but the URL param is agentId (agt_xxx)
      const session = await uow.tunnelSessionRepository.findByAgentId(agentId);
      console.log("session", session);
      // if (!session || session.accountId !== accountId) {
      //   return reply.code(404).send({ error: "Tunnel session not found" });
      // }

      if (!session) {
        // return reply.code(404).send({ error: "Session not found" });
        throw new NotFoundError("Session not found");
      }

      if (session.accountId !== accountId) {
        // return reply.code(403).send({
        //   error: "Session does not belong to this account",
        // });
        throw new ForbiddenError("Session does not belong to this account");
      }

      const prisma = fastify.prisma as any;

      const whereSearch = query.search
        ? {
            OR: [
              { path: { contains: query.search, mode: "insensitive" } },
              { method: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {};

      const where = { sessionId: session.id, ...whereSearch };
      const orderBy: any = { [query.sortBy]: query.sortOrder };
      const offset = (query.page - 1) * query.limit;

      const [requests, total] = await Promise.all([
        prisma.tunnelRequest.findMany({
          where,
          orderBy,
          take: query.limit,
          skip: offset,
          select: {
            requestId: true,
            method: true,
            path: true,
            status: true,
            durationMs: true,
            errorCode: true,
            createdAt: true,
          },
        }),
        prisma.tunnelRequest.count({ where }),
      ]);

      const Comparerequests = await uow.tunnelRequestRepository.findByAgentId(
        agentId,
        query.limit,
      );
      const Secondcomparerequests =
        await uow.tunnelRequestRepository.findBySessionId(
          session.id,
          query.limit,
        );

      return tableResponse(
        reply,
        {
          items: requests, // just the requests array
          page: query.page,
          limit: query.limit,
          total,
          extra: { accountId, agentId },
        },
        "Tunnel requests fetched",
      );
      // return tableResponse(
      //   reply,
      //   {
      //     items: {
      //       requests,
      //       Comparerequests,
      //       Secondcomparerequests,
      //       accountId,
      //       agentId,
      //     },
      //     page: query.page,
      //     limit: query.limit,
      //     total,
      //     extra: { accountId, agentId },
      //   },
      //   "Tunnel requests fetched",
      // );
    },
  );

  /**
   * GET /organizations/:accountId/tunnels/history
   * Past tunnel sessions (disconnected, evicted).
   * Auth: any member.
   */
  // fastify.get<{
  //   Params: z.infer<typeof accountParamSchema>;
  //   Querystring: z.infer<typeof tunnelHistoryQuerySchema>;
  // }>(
  //   "/organizations/:accountId/tunnels/history",
  //   { onRequest: [fastify.userAuthGuard] },
  //   async (request, reply) => {
  //     const { accountId } = accountParamSchema.parse(request.params);
  //     const query = tunnelHistoryQuerySchema.parse(request.query);
  //     const { id: userId } = getUserContext(request);

  //     const membership =
  //       await fastify.uow.membershipRepository.findByAccountAndUser(
  //         accountId,
  //         userId,
  //       );
  //     if (!membership) {
  //       return reply
  //         .code(403)
  //         .send({ error: "You are not a member of this organization" });
  //     }

  //     const prisma = fastify.prisma as any;

  //     const whereStatus = query.status
  //       ? { status: query.status }
  //       : { status: { in: ["DISCONNECTED", "EVICTED"] } };

  //     const [sessions, totalCount] = await Promise.all([
  //       prisma.tunnelSession.findMany({
  //         where: { accountId, ...whereStatus },
  //         orderBy: { connectedAt: "desc" },
  //         take: query.limit,
  //         skip: query.offset,
  //         include: {
  //           apiKey: { select: { keyId: true, name: true, environment: true } },
  //         },
  //       }),
  //       prisma.tunnelSession.count({
  //         where: { accountId, ...whereStatus },
  //       }),
  //     ]);

  //     const tunnels = sessions.map((s: any) => ({
  //       agentId: s.agentId,
  //       label: s.label,
  //       status: s.status,
  //       connectedAt: s.connectedAt,
  //       disconnectedAt: s.disconnectedAt,
  //       durationMs: s.disconnectedAt
  //         ? s.disconnectedAt.getTime() - s.connectedAt.getTime()
  //         : null,
  //       apiKey: s.apiKey
  //         ? {
  //             keyId: s.apiKey.keyId,
  //             name: s.apiKey.name,
  //             environment: s.apiKey.environment,
  //           }
  //         : null,
  //     }));

  //     return reply.send({
  //       accountId,
  //       totalCount,
  //       limit: query.limit,
  //       offset: query.offset,
  //       tunnels,
  //     });
  //   },
  // );

  // ══════════════════════════════════════════════════════════════════════════
  // BILLING SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /organizations/:accountId/billing/subscription
   * Current plan and subscription info for the billing settings page.
   * Auth: ADMIN or OWNER only.
   *
   * Returns: plan, status, current period, cancelAtPeriodEnd, trial info.
   * Does NOT return Stripe-specific IDs (stripeCustomerId etc).
   */
  fastify.get<{ Params: z.infer<typeof accountParamSchema> }>(
    "/organizations/:accountId/billing/subscription",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const { id: userId } = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);
      // Gate: ADMIN+ only — billing is sensitive
      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        userId,
      );
      if (!membership || !membership.isAdmin()) {
        // return reply.code(403).send({
        //   error: "Only admins and owners can view billing information",
        // });
        throw new ForbiddenError(
          "Only admins and owners can view billing information",
        );
      }

      const prisma = fastify.prisma as any;
      const account = await fastify.uow.accountRepository.findById(accountId);
      if (!account)
        // return reply.code(404).send({ error: "Organization not found" });
        throw new NotFoundError("Organization not found");

      // Fetch subscription (may not exist for new accounts on free plan)
      const subscription = await prisma.subscription.findFirst({
        where: { accountId },
        orderBy: { createdAt: "desc" },
      });

      // Fetch recent invoices (last 5 for the billing page preview)
      const invoices = await prisma.invoice.findMany({
        where: { accountId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          amountDue: true,
          amountPaid: true,
          currency: true,
          status: true,
          invoicePdfUrl: true,
          hostedInvoiceUrl: true,
          periodStart: true,
          periodEnd: true,
          paidAt: true,
          createdAt: true,
        },
      });

      // If no subscription exists, return free plan defaults
      if (!subscription) {
        return reply.send({
          accountId,
          plan: "FREE",
          status: "ACTIVE",
          accountStatus: account.status,
          graceEndsAt: account.graceEndsAt,
          subscription: null,
          invoices: [],
        });
      }

      return reply.send({
        accountId,
        plan: subscription.plan,
        status: subscription.status,
        accountStatus: account.status,
        graceEndsAt: account.graceEndsAt,
        subscription: {
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          canceledAt: subscription.canceledAt,
          trialStartsAt: subscription.trialStartsAt,
          trialEndsAt: subscription.trialEndsAt,
          // Stripe IDs intentionally omitted from this endpoint
        },
        invoices: invoices.map((inv: any) => ({
          id: inv.id,
          amountDue: inv.amountDue,
          amountPaid: inv.amountPaid,
          currency: inv.currency,
          status: inv.status,
          invoicePdfUrl: inv.invoicePdfUrl,
          hostedInvoiceUrl: inv.hostedInvoiceUrl,
          periodStart: inv.periodStart,
          periodEnd: inv.periodEnd,
          paidAt: inv.paidAt,
          createdAt: inv.createdAt,
        })),
      });
    },
  );

  /**
   * Get tunnel usage analytics (hourly breakdown)
   * GET /accounts/organizations/:accountId/tunnels/usage?from=...&to=...
   * Auth: MEMBER+
   *
   * Returns hourly request counts and average duration.
   * Used for the usage graph in the dashboard.
   */
  fastify.get<{
    Params: z.infer<typeof accountParamSchema>;
    Querystring: z.infer<typeof tunnelUsageQuerySchema>;
  }>(
    "/organizations/:accountId/tunnels/usage",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const { from, to } = tunnelUsageQuerySchema.parse(request.query);
      const fromDate = new Date(from);
      const toDate = new Date(to);

      if (fromDate > toDate) {
        // return reply.code(400).send({
        //   error: "`from` must be before `to`",
        // });
        throw new ValidationError("`from` must be before `to`");
      }
      const user = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        user.id,
      );
      if (!membership) {
        // return reply
        //   .code(403)
        //   .send({ error: "You are not a member of this account" });
        throw new ForbiddenError("You are not a member of this account");
      }
      try {
        const stats = await uow.tunnelRequestRepository.getHourlyStats(
          accountId,
          new Date(fromDate.toISOString()),
          new Date(toDate.toISOString()),
        );

        return reply.send({
          accountId,
          period: { from: fromDate.toISOString(), to: toDate.toISOString() },
          hourly: stats,
          totals: {
            requests: stats.reduce((sum, h) => sum + h.count, 0),
            avgDurationMs:
              stats.length > 0
                ? Math.round(
                    stats.reduce((sum, h) => sum + (h.avgDurationMs ?? 0), 0) /
                      stats.length,
                  )
                : null,
          },
        });
      } catch (err: any) {
        // If table doesn't exist yet (migration not run), return empty
        if (err?.code === "P2010" && err?.message?.includes("does not exist")) {
          return reply.send({
            accountId,
            period: { from: fromDate, to: toDate },
            hourly: [],
            totals: { requests: 0, avgDurationMs: null },
            warning:
              "Run migration to enable usage analytics: npx prisma migrate dev",
          });
        }
        throw err;
      }
    },
  );

  /**
   * GET /organizations/:accountId/usage
   * Time-series usage data for the usage chart.
   * Auth: any member.
   *
   * Query params:
   *   range=24h|7d|30d|90d  (default: 30d)
   *   keyId=<uuid>           (optional: scope to one API key)
   *   metric=requests|bandwidth_bytes|tunnel_minutes (default: requests)
   */
  fastify.get<{
    Params: z.infer<typeof accountParamSchema>;
    Querystring: z.infer<typeof usageQuerySchema>;
  }>(
    "/organizations/:accountId/usage",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const query = usageQuerySchema.parse(request.query);
      const { id: userId } = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      // Gate: must be a member
      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        userId,
      );
      if (!membership) {
        // return reply
        //   .code(403)
        //   .send({ error: "You are not a member of this organization" });
        throw new ForbiddenError("You are not a member of this organization");
      }

      const { start, end } = rangeToWindow(query.range);

      // Fetch from UsageAggregate via use case
      const usageResult = await fastify.getApiKeyUsageUseCase.execute({
        accountId,
        actorUserId: userId,
        keyId: query.keyId,
        period: { start, end },
      });

      // Filter to requested metric
      const filtered = usageResult.aggregates.filter(
        (a: any) => a.metric === query.metric,
      );

      // Convert quantity to number for buildTimeSeries
      const filteredForSeries = filtered.map((agg: any) => ({
        ...agg,
        quantity: Number(agg.quantity),
      }));

      const series = buildTimeSeries(
        filteredForSeries,
        start,
        end,
        query.range,
      );

      // Compute totals
      const total = series.reduce((sum, pt) => sum + pt.value, 0);
      const peak = series.reduce((max, pt) => Math.max(max, pt.value), 0);

      return successResponse(reply, "Usage data fetched", 200, {
        accountId,
        scope: usageResult.scope,
        keyId: query.keyId ?? null,
        metric: query.metric,
        range: query.range,
        period: { start: start.toISOString(), end: end.toISOString() },
        summary: {
          total,
          peak,
          average: series.length > 0 ? Math.round(total / series.length) : 0,
        },
        series, // [{timestamp: ISO, value: number}, ...]
      });
    },
  );

  // ── 5. Usage summary (dashboard header cards) ─────────────────────────────
  fastify.get<{ Params: z.infer<typeof accountParamSchema> }>(
    "/organizations/:accountId/usage/summary",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const { id: userId } = getUserContext(request);

      const membership =
        await fastify.uow.membershipRepository.findByAccountAndUser(
          accountId,
          userId,
        );
      if (!membership)
        throw new ForbiddenError("You are not a member of this organization");

      const prisma = fastify.prisma as any;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [monthlyAgg, activeKeyCount, activeTunnelCount, totalMemberCount] =
        await Promise.all([
          prisma.usageAggregate.aggregate({
            where: {
              accountId,
              metric: "requests",
              periodStart: { gte: monthStart },
            },
            _sum: { quantity: true },
          }),
          prisma.apiKey.count({ where: { accountId, status: "ACTIVE" } }),
          prisma.tunnelSession.count({
            where: { accountId, status: "CONNECTED" },
          }),
          prisma.accountMember.count({ where: { accountId } }),
        ]);

      return successResponse(reply, "Usage summary fetched", 200, {
        accountId,
        period: {
          start: monthStart.toISOString(),
          end: now.toISOString(),
          label: "This month",
        },
        stats: {
          totalRequests: Number(monthlyAgg._sum?.quantity ?? 0),
          activeApiKeys: activeKeyCount,
          activeTunnels: activeTunnelCount,
          totalMembers: totalMemberCount,
        },
      });
    },
  );
}
