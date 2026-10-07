// Phase 4 against a real database (opt-in: VHYXVOID_TEST_DATABASE_URL):
// endpoint stats written by the hub's TrafficStatsService and read by
// /api/v1/analytics (summaries, endpoint detail, spec drift); /api/v1/load-tests
// with a stand-in hub (targets, limits, live run, cancel, compare); monitors
// (run now, the scheduled job, MONITOR alerts firing and resolving).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { TrafficStatsService } from "../../apps/hub/src/services/TrafficStats.service";
import { analyticsRoutes } from "../../apps/api/src/modules/platform/perf/analytics.routes";
import { loadTestRoutes } from "../../apps/api/src/modules/platform/perf/loadTests.routes";
import { monitorRoutes } from "../../apps/api/src/modules/platform/perf/monitors.routes";
import { runDueMonitors } from "../../apps/api/src/modules/platform/perf/monitors.worker";
import { runAlertEvaluation } from "../../apps/api/src/modules/platform/alerts/alerts.worker";
import { AlertService } from "../../apps/api/src/modules/platform/alerts/alerts.service";

const Fastify = createRequire(new URL("../../apps/api/package.json", import.meta.url))("fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!url)("performance routes", () => {
  let prisma: PrismaClient;
  let f: any;
  let hub: http.Server;
  let app: http.Server;
  let appUrl = "";
  const tag = `perf-${Date.now()}`;
  const accounts: string[] = [];
  const users: string[] = [];
  let ws = { accountId: "", userId: "", slug: "" };
  let appHealthy = true;
  const hubSeen: Array<{ host: string; internal: boolean; loadTest: string | undefined; path: string }> = [];

  async function workspace(level = 100) {
    const u = await prisma.user.create({ data: { email: `${tag}-${users.length}@perf.test`, password: "x", firstName: "Ada" } });
    users.push(u.id);
    const slug = `${tag}-${accounts.length}`.toLowerCase();
    const a = await prisma.account.create({ data: { name: `${tag} ws`, slug, type: "ORGANIZATION", createdById: u.id } });
    accounts.push(a.id);
    const role = await prisma.role.create({ data: { accountId: a.id, name: "r", level } });
    await prisma.accountMember.create({ data: { userId: u.id, accountId: a.id, roleId: role.id, roleLevel: level } });
    return { accountId: a.id, userId: u.id, slug };
  }
  const call = async (method: string, prefix: string, path: string, payload?: unknown) => {
    const res = await f.inject({ method, url: `/api/v1/${prefix}/${ws.accountId}${path}`, payload: payload as never });
    return { status: res.statusCode, body: res.json() };
  };

  beforeAll(async () => {
    process.env.SERVER_HMAC_PEPPER ??= "p".repeat(40);
    process.env.API_CLIENT_ALLOW_PRIVATE = "1";
    process.env.HUB_DOMAIN = "vv.test";
    process.env.HUB_INTERNAL_SECRET = "perf-test-internal-secret-0123456789";
    prisma = new PrismaClient({ datasourceUrl: url });

    // Stand-in hub: answers by Host like the real one, records what arrives.
    hub = http.createServer((req, res) => {
      hubSeen.push({ host: String(req.headers.host), internal: req.headers["x-vhyxvoid-internal"] === process.env.HUB_INTERNAL_SECRET, loadTest: req.headers["x-vhyxvoid-load-test"] as string | undefined, path: req.url ?? "" });
      req.resume();
      req.on("end", () => {
        const status = req.url?.startsWith("/fail") ? 500 : 200;
        setTimeout(() => (res.writeHead(status, { "content-type": "application/json" }), res.end('{"ok":true}')), 3);
      });
    });
    await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
    process.env.HUB_INTERNAL_URL = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`;

    // The API that monitors check.
    app = http.createServer((req, res) => {
      res.writeHead(appHealthy ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: appHealthy, path: req.url }));
    });
    await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
    appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;

    ws = await workspace();
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", { get: async (k: string) => (k.startsWith("features.") ? true : undefined) });
    f.decorate("userAuthGuard", async (req: any) => void (req.user = { userId: ws.userId, id: ws.userId }));
    f.setErrorHandler((err: any, _req: any, reply: any) => reply.code(err.statusCode ?? 500).send({ message: err.message }));
    await f.register(analyticsRoutes, { prefix: "/api/v1/analytics" });
    await f.register(loadTestRoutes, { prefix: "/api/v1/load-tests" });
    await f.register(monitorRoutes, { prefix: "/api/v1/monitors" });
    await f.ready();
  });

  afterAll(async () => {
    await f?.close();
    await new Promise<void>((r) => hub.close(() => r()));
    await new Promise<void>((r) => app.close(() => r()));
    await prisma.$executeRawUnsafe(`DELETE FROM "tunnel_endpoint_stats" WHERE "accountId" = ANY($1)`, accounts);
    await prisma.alertRule.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.account.deleteMany({ where: { id: { in: accounts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
    delete process.env.API_CLIENT_ALLOW_PRIVATE;
  });

  describe("analytics", () => {
    it("the hub's endpoint stats merge in SQL and read back as summaries, detail and drift", async () => {
      const now = Date.now();
      const stats = new TrafficStatsService(prisma, () => now);
      for (let i = 0; i < 40; i++) stats.record(ws.accountId, "api", i < 36 ? 200 : 500, 20 + i, "GET", `/users/${i}?x=1`);
      stats.record(ws.accountId, "api", 201, 300, "POST", "/users");
      stats.record(ws.accountId, "api", 200, 5, "GET", "/admin/secret");
      await stats.flush();
      // A second flush into the same bucket adds counts and histogram cells.
      for (let i = 0; i < 10; i++) stats.record(ws.accountId, "api", 200, 2000, "GET", "/users/99");
      await stats.flush();
      const rows = await prisma.$queryRawUnsafe<Array<{ requests: number; hist: number[]; sample: string }>>(`SELECT "requests", "hist", "sample" FROM "tunnel_endpoint_stats" WHERE "accountId" = $1 AND "route" = '/users/:id'`, ws.accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0].requests).toBe(50);
      expect(rows[0].hist.reduce((a, b) => a + b, 0)).toBe(50);
      expect(rows[0].sample).toBe("/users/0");

      const list = await call("GET", "analytics", "?window=1h");
      expect(list.status).toBe(200);
      const d = list.body.data;
      expect(d.labels).toEqual(["api"]);
      expect(d.totals).toMatchObject({ requests: 52, endpoints: 3 });
      const users = d.endpoints.find((e: any) => e.route === "/users/:id");
      expect(users).toMatchObject({ method: "GET", requests: 50, s5xx: 4, errorRate: 8, isNew: true });
      expect(users.p99).toBeGreaterThan(1000);
      expect(d.slowest[0].route).toBe("/users/:id");
      expect(d.failing[0].route).toBe("/users/:id");

      const detail = await call("GET", "analytics", `/endpoint?window=1h&label=api&method=GET&route=${encodeURIComponent("/users/:id")}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.points).toHaveLength(12);
      expect(detail.body.data.points.reduce((n: number, p: any) => n + p.requests, 0)).toBe(50);

      const drift = await call("POST", "analytics", "/drift", { window: "1h", document: JSON.stringify({ openapi: "3.0.0", info: { title: "Users" }, paths: { "/users/{id}": { get: { responses: { "200": {} } } }, "/users": { post: { responses: { "201": {} } }, get: { responses: { "200": {} } } } } }) });
      expect(drift.status).toBe(200);
      expect(drift.body.data).toMatchObject({ spec: { name: "Users", operations: 3 }, matched: 2, undocumented: [{ method: "GET", route: "/admin/secret" }], unused: [{ method: "GET", path: "/users" }] });
      expect(drift.body.data.unexpectedStatuses[0]).toMatchObject({ route: "/users/:id", statusClass: "5xx", requests: 4 });
      expect((await call("POST", "analytics", "/drift", { window: "1h", document: "{}" })).status).toBe(400);
    });
  });

  describe("load tests", () => {
    it("lists targets and refuses anything that isn't the workspace's own", async () => {
      await prisma.customDomain.create({ data: { accountId: ws.accountId, hostname: `${tag}.example.com`, label: "api", verificationToken: "t", verifiedAt: new Date() } });
      await prisma.customDomain.create({ data: { accountId: ws.accountId, hostname: `unverified-${tag}.example.com`, label: "api", verificationToken: "t" } });
      const o = await call("GET", "load-tests", "");
      expect(o.body.data.limits).toMatchObject({ maxVus: 10, maxSeconds: 60, maxRps: 50, perDay: 5, usedToday: 0 });
      expect(o.body.data.targets.map((t: any) => t.kind)).toContain("domain");
      const start = (target: string, extra: object = {}) => call("POST", "load-tests", "", { name: "x", target, vus: 2, durationSec: 5, ...extra });
      for (const bad of ["https://example.org/", `https://other--api.vv.test/`, `https://unverified-${tag}.example.com/`, "http://127.0.0.1:9100/"]) {
        const r = await start(bad);
        expect(r.status, bad).toBe(400);
        expect(r.body.message).toMatch(/only this workspace's tunnels/);
      }
      expect((await start(`https://${ws.slug}--api.vv.test/`, { vus: 11 })).body.message).toMatch(/up to 10 virtual users/);
      expect((await start(`https://${ws.slug}--api.vv.test/`, { durationSec: 61 })).body.message).toMatch(/up to 60 seconds/);
    });

    let first = "";
    it("runs against the hub with the target's Host, marked, with live progress, and finishes PASSED or FAILED by thresholds", async () => {
      hubSeen.length = 0;
      const started = await call("POST", "load-tests", "", { name: "Users", target: `https://${ws.slug}--api.vv.test/users?page=1`, method: "GET", headers: [["X-Test", "1"], ["Host", "evil.example"]], vus: 3, durationSec: 5, maxRps: 20, thresholds: { p95Ms: 5000, errorRatePct: 1 } });
      expect(started.status).toBe(201);
      first = started.body.data.id;
      expect((await call("POST", "load-tests", "", { target: `https://${ws.slug}--api.vv.test/`, vus: 1, durationSec: 5 })).status).toBe(409);
      await sleep(3200);
      const live = await call("GET", "load-tests", `/${first}`);
      expect(live.body.data.status).toBe("RUNNING");
      expect(live.body.data.timeline.length).toBeGreaterThanOrEqual(2);
      let done: any;
      for (let i = 0; i < 40 && (!done || done.status === "RUNNING"); i++) {
        await sleep(250);
        done = (await call("GET", "load-tests", `/${first}`)).body.data;
      }
      expect(done.status).toBe("PASSED");
      expect(done.summary.requests).toBeGreaterThan(60);
      expect(done.summary.requests).toBeLessThanOrEqual(110);
      expect(done.summary.thresholds.every((t: any) => t.pass)).toBe(true);
      expect(done.timeline).toHaveLength(5);
      expect(hubSeen.every((h) => h.host === `${ws.slug}--api.vv.test` && h.internal && h.loadTest === first && h.path === "/users?page=1")).toBe(true);
    }, 20_000);

    it("cancels, compares, deletes", async () => {
      const second = (await call("POST", "load-tests", "", { name: "Failing", target: `https://${tag}.example.com/fail`, vus: 2, durationSec: 30, thresholds: { errorRatePct: 1 } })).body.data.id;
      await sleep(1200);
      expect((await call("POST", "load-tests", `/${second}/cancel`)).status).toBe(200);
      let row: any;
      for (let i = 0; i < 30 && (!row || row.status === "RUNNING"); i++) {
        await sleep(250);
        row = (await call("GET", "load-tests", `/${second}`)).body.data;
      }
      expect(row.status).toBe("CANCELLED");
      expect(row.summary.errorRate).toBe(100);
      const cmp = await call("GET", "load-tests", `/compare?a=${first}&b=${second}`);
      expect(cmp.status).toBe(200);
      expect(cmp.body.data.rows.find((r: any) => r.metric === "Error rate (%)")).toMatchObject({ a: 0, b: 100, better: false });
      expect((await call("DELETE", "load-tests", `/${second}`)).status).toBe(200);
      expect((await call("GET", "load-tests", "")).body.data.limits.usedToday).toBe(1);
    }, 20_000);
  });

  describe("monitors", () => {
    let monitorId = "";
    it("creates within the plan, runs now (UP), then DOWN on failures; the job runs due monitors", async () => {
      const col = await prisma.apiCollection.create({
        data: {
          accountId: ws.accountId,
          name: "Health",
          variables: [{ key: "base", value: appUrl, enabled: true }] as never,
          requests: [{ id: "q1", name: "Health", method: "GET", url: "{{base}}/health", params: [], headers: [], auth: { type: "none" }, body: { type: "none" }, assertions: [{ id: "a", enabled: true, source: "status", op: "eq", value: "200" }], captures: [] }] as never,
        },
      });
      expect((await call("POST", "monitors", "", { name: "Health", collectionId: col.id, intervalMinutes: 5 })).body.message).toMatch(/every 15 minutes at most/);
      const created = await call("POST", "monitors", "", { name: "Health", collectionId: col.id, intervalMinutes: 15 });
      expect(created.status).toBe(201);
      monitorId = created.body.data.id;
      expect((await call("POST", "monitors", "", { name: "Two", collectionId: col.id, intervalMinutes: 15 })).status).toBe(402);

      const ran = await call("POST", "monitors", `/${monitorId}/run`);
      expect(ran.body.data).toMatchObject({ ok: true, consecutiveFailures: 0 });
      appHealthy = false;
      expect((await call("POST", "monitors", `/${monitorId}/run`)).body.data).toMatchObject({ ok: false, consecutiveFailures: 1 });
      // The job picks it up once it is due.
      await prisma.apiMonitor.update({ where: { id: monitorId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      const job = await runDueMonitors(prisma as never);
      expect(job.ran).toBeGreaterThanOrEqual(1);
      const m = await prisma.apiMonitor.findUnique({ where: { id: monitorId } });
      expect(m).toMatchObject({ status: "DOWN", consecutiveFailures: 2 });
      expect(m!.lastError).toMatch(/Health: status equals 200 \(expected 200, got 503\)/);
      expect(m!.nextRunAt.getTime()).toBeGreaterThan(Date.now());

      const detail = await call("GET", "monitors", `/${monitorId}?window=24h`);
      expect(detail.body.data.uptime).toMatchObject({ checks: 3, ok: 1 });
      expect(detail.body.data.recent[0].ok).toBe(false);
      const failed = await call("GET", "monitors", `/${monitorId}/results/${detail.body.data.recent[0].id}`);
      expect(failed.body.data.report.results[0].outcome).toBe("failed");
      const list = await call("GET", "monitors", "");
      expect(list.body.data.monitors[0]).toMatchObject({ status: "DOWN", uptime24h: 33.33, collectionName: "Health" });
    });

    it("MONITOR alert rules fire after N failures in a row and resolve when it passes", async () => {
      const alerts = new AlertService(prisma as never, () => undefined);
      const rule = await prisma.alertRule.create({ data: { accountId: ws.accountId, name: "Health down", type: "MONITOR", label: monitorId, threshold: 2, notifyMembers: false } });
      await runAlertEvaluation(prisma as never, alerts);
      let events = await prisma.alertEvent.findMany({ where: { ruleId: rule.id }, orderBy: { createdAt: "asc" } });
      expect(events.map((e) => [e.kind, e.title])).toEqual([["FIRING", "Monitor Health is failing"]]);
      appHealthy = true;
      await call("POST", "monitors", `/${monitorId}/run`);
      await runAlertEvaluation(prisma as never, alerts);
      events = await prisma.alertEvent.findMany({ where: { ruleId: rule.id }, orderBy: { createdAt: "asc" } });
      expect(events.map((e) => e.kind)).toEqual(["FIRING", "RESOLVED"]);
      expect(events[1].title).toBe("Monitor Health is passing again");
    });
  });
});
