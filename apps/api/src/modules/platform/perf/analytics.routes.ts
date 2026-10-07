// /api/v1/analytics — per-endpoint traffic of a workspace (phase 4), from the
// hub's tunnel_endpoint_stats (5-minute buckets, kept 7 days).
//
//   GET  /:accountId?window=1h|6h|24h|7d&label=      endpoints with volume, error rate, percentiles, trend; new endpoints; slowest
//   GET  /:accountId/endpoint?window&label&method&route  one endpoint over time (requests, errors, p50/p95/p99 per bucket)
//   POST /:accountId/drift                            { window, label?, mockId? | specId? | document? } traffic vs a spec (specId: its latest published version, else its draft)
//
// Aggregation happens in SQL (histograms summed per index), so a busy week
// never loads every 5-minute row into the API.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { ForbiddenError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  ENDPOINT_HIST_BOUNDS,
  ENDPOINT_HIST_SIZE,
  percentileFromBuckets,
  specDrift,
  specFromMock,
  specFromOpenApi,
  summarizeEndpoints,
  type EndpointStatRow,
  type MockApiDefinition,
} from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import { parseSpecText } from "../specs/specDocs";

const WINDOWS = { "1h": 60, "6h": 360, "24h": 1440, "7d": 10_080 } as const;
type WindowKey = keyof typeof WINDOWS;
/** Points per chart: 1h -> 5 min, 6h -> 15 min, 24h -> 1 h, 7d -> 6 h. */
const STEP_MINUTES: Record<WindowKey, number> = { "1h": 5, "6h": 15, "24h": 60, "7d": 360 };
const TREND_POINTS = 24;

const params = z.object({ accountId: z.string().uuid() });
const label = z.string().trim().max(63).regex(/^[a-z0-9-]*$/i, "Invalid label").optional();
const listQuery = z.object({ window: z.enum(Object.keys(WINDOWS) as [WindowKey, ...WindowKey[]]).default("24h"), label });
const endpointQuery = listQuery.extend({ label: z.string().trim().min(1).max(63), method: z.string().trim().min(1).max(10), route: z.string().min(1).max(400) });
const driftBody = z
  .object({
    window: z.enum(Object.keys(WINDOWS) as [WindowKey, ...WindowKey[]]).default("7d"),
    label,
    mockId: z.string().uuid().optional(),
    specId: z.string().uuid().optional(),
    document: z.union([z.string().min(2).max(5_000_000), z.record(z.string(), z.unknown())]).optional(),
  })
  .refine((b) => [b.mockId, b.specId, b.document].filter((x) => x !== undefined).length === 1, { message: "Give one of a mock API, an API spec or a document" });

const histSums = Array.from({ length: ENDPOINT_HIST_SIZE }, (_, i) => `COALESCE(SUM("hist"[${i + 1}]), 0)::int AS h${i}`).join(", ");

type AggRow = {
  label: string;
  method: string;
  route: string;
  t: Date;
  requests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  totalMs: bigint | number;
  maxMs: number;
  sample: string;
} & Record<`h${number}`, number>;

const toStatRow = (r: AggRow): EndpointStatRow => ({
  label: r.label,
  method: r.method,
  route: r.route,
  bucket: new Date(r.t),
  requests: Number(r.requests),
  s2xx: Number(r.s2xx),
  s3xx: Number(r.s3xx),
  s4xx: Number(r.s4xx),
  s5xx: Number(r.s5xx),
  totalMs: Number(r.totalMs),
  maxMs: Number(r.maxMs),
  hist: Array.from({ length: ENDPOINT_HIST_SIZE }, (_, i) => Number(r[`h${i}`] ?? 0)),
  sample: r.sample ?? "",
});

export async function analyticsRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const db = prisma as unknown as { $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T>; accountMember: any; mockApi: any; apiSpec: any; apiSpecVersion: any };

  async function member(request: FastifyRequest, accountId: string) {
    const user = getUserContext(request);
    const m = await db.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
  }

  const range = (w: WindowKey, now = Date.now()) => {
    const step = STEP_MINUTES[w] * 60_000;
    // Align to the step so consecutive loads show the same buckets.
    const to = new Date(Math.ceil(now / step) * step);
    return { from: new Date(to.getTime() - WINDOWS[w] * 60_000), to, step };
  };

  /** Rows summed per endpoint per `stepMs` (trend buckets). */
  async function aggregate(accountId: string, from: Date, to: Date, stepMs: number, extra: { label?: string; method?: string; route?: string } = {}): Promise<EndpointStatRow[]> {
    const where = ['"accountId" = $1', '"bucket" >= $2', '"bucket" < $3'];
    const values: unknown[] = [accountId, from, to];
    for (const [col, v] of Object.entries(extra)) {
      if (v === undefined) continue;
      values.push(v);
      where.push(`"${col}" = $${values.length}`);
    }
    values.push(stepMs / 1000);
    const step = `$${values.length}::float8`;
    const rows = await db.$queryRawUnsafe<AggRow[]>(
      `SELECT "label", "method", "route",
              to_timestamp(floor(extract(epoch FROM "bucket") / ${step}) * ${step}) AS t,
              SUM("requests")::int AS requests, SUM("s2xx")::int AS s2xx, SUM("s3xx")::int AS s3xx, SUM("s4xx")::int AS s4xx, SUM("s5xx")::int AS s5xx,
              SUM("totalMs")::bigint AS "totalMs", MAX("maxMs")::int AS "maxMs", MIN("sample") AS sample, ${histSums}
         FROM "tunnel_endpoint_stats"
        WHERE ${where.join(" AND ")}
        GROUP BY 1, 2, 3, 4
        ORDER BY 4
        LIMIT 50000`,
      ...values,
    );
    return rows.map(toStatRow);
  }

  async function firstSeen(accountId: string, label?: string): Promise<Map<string, Date>> {
    const rows = await db.$queryRawUnsafe<Array<{ label: string; method: string; route: string; first: Date }>>(
      `SELECT "label", "method", "route", MIN("bucket") AS first FROM "tunnel_endpoint_stats" WHERE "accountId" = $1 ${label ? 'AND "label" = $2' : ""} GROUP BY 1, 2, 3`,
      ...(label ? [accountId, label] : [accountId]),
    );
    return new Map(rows.map((r) => [`${r.label}\u0000${r.method}\u0000${r.route}`, new Date(r.first)]));
  }

  async function summaries(accountId: string, w: WindowKey, lbl?: string) {
    const { from, to } = range(w);
    const trendStep = (to.getTime() - from.getTime()) / TREND_POINTS;
    const [rows, seen] = await Promise.all([aggregate(accountId, from, to, trendStep, { label: lbl }), firstSeen(accountId, lbl)]);
    return { from, to, endpoints: summarizeEndpoints(rows, { from, to, firstSeen: seen, buckets: TREND_POINTS }), rows };
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const q = listQuery.parse(request.query ?? {});
    await member(request, accountId);
    const { from, to, endpoints, rows } = await summaries(accountId, q.window, q.label || undefined);
    const labels = (await db.$queryRawUnsafe<Array<{ label: string }>>(`SELECT DISTINCT "label" FROM "tunnel_endpoint_stats" WHERE "accountId" = $1 AND "bucket" >= $2 ORDER BY 1 LIMIT 200`, accountId, new Date(Date.now() - 7 * 86_400_000))).map((r) => r.label);
    // Whole-window totals, percentiles from every endpoint's histogram.
    const hist = new Array(ENDPOINT_HIST_SIZE).fill(0);
    let maxMs = 0;
    let totalMs = 0;
    for (const r of rows) {
      r.hist.forEach((c, i) => (hist[i] += c));
      maxMs = Math.max(maxMs, r.maxMs);
      totalMs += r.totalMs;
    }
    const requests = endpoints.reduce((n, e) => n + e.requests, 0);
    const s5xx = endpoints.reduce((n, e) => n + e.s5xx, 0);
    const s4xx = endpoints.reduce((n, e) => n + e.s4xx, 0);
    return successResponse(reply, "Success", 200, {
      window: q.window,
      from,
      to,
      labels,
      totals: {
        requests,
        endpoints: endpoints.length,
        errorRate: requests ? Math.round((s5xx / requests) * 1000) / 10 : 0,
        clientErrorRate: requests ? Math.round((s4xx / requests) * 1000) / 10 : 0,
        avgMs: requests ? Math.round(totalMs / requests) : 0,
        p50: percentileFromBuckets(hist, ENDPOINT_HIST_BOUNDS, 50, maxMs),
        p95: percentileFromBuckets(hist, ENDPOINT_HIST_BOUNDS, 95, maxMs),
        p99: percentileFromBuckets(hist, ENDPOINT_HIST_BOUNDS, 99, maxMs),
      },
      endpoints: endpoints.slice(0, 500),
      newEndpoints: endpoints.filter((e) => e.isNew).slice(0, 50),
      slowest: [...endpoints].filter((e) => e.requests >= 10 && e.p95 !== null).sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0)).slice(0, 5),
      failing: [...endpoints].filter((e) => e.s5xx > 0).sort((a, b) => b.errorRate - a.errorRate || b.s5xx - a.s5xx).slice(0, 5),
    });
  });

  fastify.get("/:accountId/endpoint", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const q = endpointQuery.parse(request.query ?? {});
    await member(request, accountId);
    const { from, to, step } = range(q.window);
    const rows = await aggregate(accountId, from, to, step, { label: q.label, method: q.method.toUpperCase(), route: q.route });
    const byT = new Map(rows.map((r) => [r.bucket.getTime(), r]));
    const points = [];
    for (let t = from.getTime(); t < to.getTime(); t += step) {
      const r = byT.get(t);
      points.push({
        t: new Date(t).toISOString(),
        requests: r?.requests ?? 0,
        s4xx: r?.s4xx ?? 0,
        s5xx: r?.s5xx ?? 0,
        avgMs: r && r.requests ? Math.round(r.totalMs / r.requests) : null,
        p50: r ? percentileFromBuckets(r.hist, ENDPOINT_HIST_BOUNDS, 50, r.maxMs) : null,
        p95: r ? percentileFromBuckets(r.hist, ENDPOINT_HIST_BOUNDS, 95, r.maxMs) : null,
        p99: r ? percentileFromBuckets(r.hist, ENDPOINT_HIST_BOUNDS, 99, r.maxMs) : null,
      });
    }
    const [summary] = summarizeEndpoints(rows, { from, to, buckets: points.length });
    if (!summary) throw new NotFoundError("No traffic for this endpoint in the window");
    return successResponse(reply, "Success", 200, { window: q.window, stepMinutes: STEP_MINUTES[q.window], summary, points });
  });

  fastify.post("/:accountId/drift", { onRequest: [fastify.userAuthGuard], bodyLimit: 6 * 1024 * 1024, config: { apiKeyScope: "specs:read", apiDoc: { summary: "Compare live traffic with a spec", description: "Compares the endpoints seen in the window's traffic (optionally one tunnel label) with one of: a mock API (mockId), API docs (specId) or an OpenAPI document. Returns undocumented traffic, documented operations with no traffic, status classes the spec doesn't document, and coverage.", body: driftBody }, rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = driftBody.parse(request.body ?? {});
    await member(request, accountId);
    let spec;
    let specName: string;
    if (body.mockId) {
      const mock = await db.mockApi.findFirst({ where: { id: body.mockId, accountId } });
      if (!mock) throw new NotFoundError("Mock API not found");
      spec = specFromMock({ endpoints: (mock.endpoints ?? []) as MockApiDefinition["endpoints"], resources: (mock.resources ?? []) as MockApiDefinition["resources"] });
      specName = mock.name;
    } else if (body.specId) {
      const s = await db.apiSpec.findFirst({ where: { id: body.specId, accountId }, select: { id: true, name: true, draftText: true } });
      if (!s) throw new NotFoundError("API spec not found");
      const latest = await db.apiSpecVersion.findFirst({ where: { specId: s.id }, orderBy: { number: "desc" }, select: { doc: true } });
      const doc = latest?.doc ?? parseSpecText(s.draftText).doc;
      if (!doc) throw new ValidationError("The spec's draft doesn't parse and nothing is published yet");
      spec = specFromOpenApi(doc);
      specName = s.name;
    } else {
      let doc: unknown = body.document;
      if (typeof doc === "string") {
        try {
          doc = JSON.parse(doc);
        } catch {
          try {
            doc = parseYaml(doc as string, { maxAliasCount: 100 });
          } catch (err) {
            throw new ValidationError(`Could not read the document as JSON or YAML: ${(err as Error).message.split("\n")[0]}`);
          }
        }
      }
      try {
        spec = specFromOpenApi(doc);
      } catch (err) {
        throw new ValidationError((err as Error).message);
      }
      specName = String(((doc as Record<string, unknown>).info as Record<string, unknown> | undefined)?.title ?? "OpenAPI document");
    }
    const { endpoints } = await summaries(accountId, body.window, body.label || undefined);
    return successResponse(reply, "Success", 200, { spec: { name: specName, operations: spec.length }, window: body.window, observed: endpoints.length, ...specDrift(endpoints, spec) });
  });
}
