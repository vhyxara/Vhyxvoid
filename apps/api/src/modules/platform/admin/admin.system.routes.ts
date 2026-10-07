// GET /api/v1/admin/overview        headline numbers and 30-day trends
// GET /api/v1/admin/system/health   per-dependency health (fail-soft)
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { PLAN_LIMITS, SETTING_DEFINITIONS } from "@vhyxvoid/shared";
import { successResponse } from "@/core/utils/response.util";
import { prismaOf, rangeQuerySchema, since } from "../shared/http";
import type { HubClient } from "../shared/hubClient";

type Probe = { status: "ok" | "degraded" | "down" | "unknown"; latencyMs?: number; message?: string; details?: Record<string, unknown> };

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const t = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - t), value };
}

function migrationsOnDisk(): string[] | null {
  const candidates = [
    path.resolve(process.cwd(), "prisma/migrations"),
    path.resolve(process.cwd(), "apps/api/prisma/migrations"),
    path.resolve(__dirname, "../../../../prisma/migrations"),
    path.resolve(__dirname, "../../../../../prisma/migrations"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    }
  }
  return null;
}

export async function adminSystemRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);

  fastify.get("/overview", { onRequest: [fastify.requireAbility("system.read")] }, async (request, reply) => {
    const { days } = rangeQuerySchema.parse(request.query);
    const from = since(days);

    const [users, newUsers, accounts, accountsByStatus, activeSubs, subsByPlan, activeKeys, connectedSessions, revenue, openFeedback, signupsByDay, requestsByDay] =
      await Promise.all([
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.user.count({ where: { deletedAt: null, createdAt: { gte: from } } }),
        prisma.account.count({ where: { deletedAt: null } }),
        prisma.account.groupBy({ by: ["status"], _count: { _all: true }, where: { deletedAt: null } }),
        prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } } }),
        prisma.subscription.groupBy({ by: ["plan", "status"], _count: { _all: true } }),
        prisma.apiKey.count({ where: { status: "ACTIVE" } }),
        prisma.tunnelSession.count({ where: { status: "CONNECTED" } }),
        prisma.invoice.aggregate({ _sum: { amountPaid: true }, where: { status: "PAID", paidAt: { gte: from } } }),
        prisma.feedback.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW", "IN_PROGRESS"] } } }),
        prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
          SELECT date_trunc('day', "createdAt") AS day, count(*)::bigint AS count
          FROM "User" WHERE "createdAt" >= ${from} AND "deletedAt" IS NULL
          GROUP BY 1 ORDER BY 1`,
        prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
          SELECT date_trunc('day', "periodStart") AS day, sum(quantity)::bigint AS count
          FROM "UsageAggregate" WHERE metric = 'requests' AND "periodStart" >= ${from}
          GROUP BY 1 ORDER BY 1`,
      ]);

    let live: { agents: number | null; hubOk: boolean } = { agents: null, hubOk: false };
    if (opts.hub.configured) {
      try {
        live = { agents: (await opts.hub.stats()).agents, hubOk: true };
      } catch {
        live = { agents: null, hubOk: false };
      }
    }

    return successResponse(reply, "Success", 200, {
      rangeDays: days,
      users: { total: users, new: newUsers },
      accounts: { total: accounts, byStatus: Object.fromEntries(accountsByStatus.map((r) => [r.status, r._count._all])) },
      subscriptions: {
        active: activeSubs,
        byPlan: subsByPlan.map((r) => ({ plan: r.plan, status: r.status, count: r._count._all })),
      },
      apiKeys: { active: activeKeys },
      tunnels: { connectedSessions, liveAgents: live.agents, hubReachable: live.hubOk },
      revenue: { paidCents: revenue._sum.amountPaid ?? 0 },
      feedback: { open: openFeedback },
      series: {
        signups: signupsByDay.map((r) => ({ day: r.day.toISOString().slice(0, 10), count: Number(r.count) })),
        requests: requestsByDay.map((r) => ({ day: r.day.toISOString().slice(0, 10), count: Number(r.count) })),
      },
    });
  });

  fastify.get("/system/health", { onRequest: [fastify.requireAbility("system.read")] }, async (_request, reply) => {
    const probes: Record<string, Probe> = {};

    // Postgres + migrations
    try {
      const { ms, value } = await timed(() =>
        prisma.$queryRaw<Array<{ version: string; size: bigint; connections: bigint }>>`
          SELECT version() AS version, pg_database_size(current_database())::bigint AS size,
                 (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::bigint AS connections`,
      );
      const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
        SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
      const tables = await prisma.$queryRaw<Array<{ table: string; rows: bigint }>>`
        SELECT relname AS table, n_live_tup::bigint AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 12`;
      const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
      const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
      const disk = migrationsOnDisk();
      const pending = disk ? disk.filter((m) => !applied.includes(m)) : [];
      const orphaned = disk ? applied.filter((m) => !disk.includes(m)) : [];
      const v = value[0];
      probes.database = {
        status: failed.length || pending.length ? "degraded" : "ok",
        latencyMs: ms,
        message: failed.length ? `${failed.length} failed migration(s)` : pending.length ? `${pending.length} migration(s) not applied` : undefined,
        details: {
          version: v?.version?.split(" ").slice(0, 2).join(" "),
          sizeMb: v ? Math.round(Number(v.size) / 1048576) : null,
          connections: v ? Number(v.connections) : null,
          migrations: { applied: applied.length, failed, pending, orphaned, onDisk: disk?.length ?? null },
          largestTables: tables.map((t) => ({ table: t.table, rows: Number(t.rows) })),
        },
      };
    } catch (err) {
      probes.database = { status: "down", message: (err as Error).message.slice(0, 300) };
    }

    // Redis: ping + write/read/delete round trip on a short-lived key.
    try {
      const redis = (fastify as unknown as { redis?: { ping(): Promise<string>; set(k: string, v: string, o: { ex: number }): Promise<unknown>; get(k: string): Promise<unknown>; del(k: string): Promise<unknown> } }).redis;
      if (!redis) throw new Error("Redis is not configured");
      const key = `health:probe:${process.pid}`;
      const { ms } = await timed(async () => {
        await redis.ping();
        await redis.set(key, "1", { ex: 30 });
        const got = await redis.get(key);
        await redis.del(key);
        if (String(got) !== "1") throw new Error("read back a different value");
      });
      probes.redis = { status: ms > 500 ? "degraded" : "ok", latencyMs: ms, message: ms > 500 ? "slow round trip" : undefined };
    } catch (err) {
      probes.redis = { status: "down", message: (err as Error).message.slice(0, 300) };
    }

    // Hub
    if (!opts.hub.configured) {
      probes.hub = { status: "unknown", message: "Set HUB_INTERNAL_URL and HUB_INTERNAL_SECRET on the api to see live hub data" };
    } else {
      try {
        const { ms, value } = await timed(() => opts.hub.stats());
        probes.hub = { status: "ok", latencyMs: ms, details: value as unknown as Record<string, unknown> };
      } catch (err) {
        probes.hub = { status: "down", message: (err as Error).message.slice(0, 300) };
      }
    }

    // Email + billing configuration (booleans only, never values).
    probes.email = process.env.RESEND_API_KEY ? { status: "ok" } : { status: "degraded", message: "RESEND_API_KEY is not set: emails go to the log" };
    probes.billing = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET ? { status: "ok" } : { status: "degraded", message: "Stripe is not configured" };

    const mem = process.memoryUsage();
    const api = {
      status: "ok" as const,
      details: {
        version: process.env.GIT_SHA ?? "dev",
        builtAt: process.env.BUILD_TIME ?? null,
        node: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        rssMb: Math.round(mem.rss / 1048576),
        env: process.env.NODE_ENV ?? "development",
        configured: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          UPSTASH_REDIS: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
          SERVER_HMAC_PEPPER: Boolean(process.env.SERVER_HMAC_PEPPER),
          STRIPE: Boolean(process.env.STRIPE_SECRET_KEY),
          RESEND: Boolean(process.env.RESEND_API_KEY),
          HUB_INTERNAL: opts.hub.configured,
          APP_URL: process.env.APP_URL ?? null,
        },
      },
    };

    const worst = Object.values(probes).some((p) => p.status === "down") ? "down" : Object.values(probes).some((p) => p.status === "degraded") ? "degraded" : "ok";
    return successResponse(reply, "Success", 200, { status: worst, checkedAt: new Date().toISOString(), api, probes });
  });

  /** Built-in plan limits and how each is enforced (read-only reference). */
  fastify.get("/system/plan-limits", { onRequest: [fastify.requireAbility("system.read")] }, async (_request, reply) => {
    const overrides = await fastify.platformSettings.get("plans.overrides");
    const serialize = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o, (_k, v) => (v === Infinity ? null : v)));
    return successResponse(reply, "Success", 200, {
      builtIn: serialize(PLAN_LIMITS as unknown as Record<string, unknown>),
      overrides,
      enforcement: {
        maxAgents: "enforced (hub, at agent connect)",
        accessRules: "enforced (creating or changing tunnel access rules; existing rules keep protecting after a downgrade)",
        maxCustomDomains: "enforced (adding a custom domain; also needs customDomains)",
        maxAlertRules: "enforced (creating alert rules)",
        maxTrafficRules: "enforced (saving a tunnel's traffic rules; existing rules keep working after a downgrade)",
        maxMockApis: "enforced (creating a mock API; existing mocks keep answering after a downgrade)",
        maxMockEndpoints: "enforced (saving a mock API's endpoints)",
        maxApiCollections: "enforced (creating or importing a collection; 0 also refuses sending)",
        maxApiCollectionRequests: "enforced (saving a collection)",
        apiClientSendsPerMinute: "enforced (each request the API client sends, collection runs included)",
        maxLoadTestVus: "enforced (starting a load test; 0 refuses load tests)",
        maxLoadTestSeconds: "enforced (starting a load test)",
        maxLoadTestRps: "enforced (the runner paces requests to it)",
        loadTestsPerDay: "enforced (starting a load test, per UTC day)",
        maxMonitors: "enforced (creating a monitor)",
        minMonitorIntervalMinutes: "enforced (creating or changing a monitor)",
        maxApiSpecs: "enforced (creating an API spec)",
        maxTeamChannels: "enforced (creating a channel; 0 turns the team space off)",
        maxTeamDocs: "enforced (creating a document)",
        maxTeamIssues: "enforced (creating an issue)",
        teamHistoryDays: "enforced (older messages are hidden from history, threads and search; nothing is deleted)",
        protectedDocs: "enforced (setting a docs password; protected docs of a downgraded plan stay protected)",
        docsCustomDomains: "enforced (adding a docs domain; public docs on a verified domain keep answering after a downgrade)",
        customDomains: "enforced (adding a custom domain)",
        inboxRequests: "enforced (hub stops holding requests for a tunnel once this many are waiting; 0 = no inbox)",
        inspectorRequests: "enforced (hub keeps this many recent requests per tunnel for 24 h; 0 turns capture off)",
        maxMembers: "enforced (invite and accept)",
        maxApiKeys: "enforced (key creation)",
        maxScopesPerKey: "enforced (key creation)",
        rateLimitPerMinute: "enforced (SDK requests, per key)",
        publicPathRateLimitPerMinute: "enforced (public tunnel URLs, per account)",
        maxRequestsPerMonth: "counted and shown, not blocked",
        prodKeysAllowed: "enforced (key creation)",
        rotationAllowed: "enforced (key rotation)",
        expiryAllowed: "enforced (key creation)",
        analyticsRetentionDays: "not enforced (data kept)",
        prioritySupport: "informational",
      },
      settingsKeys: Object.keys(SETTING_DEFINITIONS).length,
    });
  });
}
