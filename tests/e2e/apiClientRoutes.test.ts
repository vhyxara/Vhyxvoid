// /api/v1/api-client against a real database (opt-in: VHYXVOID_TEST_DATABASE_URL)
// and a local HTTP server as the API under test: collections, encrypted
// environment secrets, sending (with the private-address guard), snippets,
// history, runs with captures, exports, plan limits and the feature switch.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { apiClientRoutes } from "../../apps/api/src/modules/platform/apiclient/apiClient.routes";

const Fastify = createRequire(new URL("../../apps/api/package.json", import.meta.url))("fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe.skipIf(!url)("API client routes", () => {
  let prisma: PrismaClient;
  let server: http.Server;
  let target = "";
  const tag = `apic-${Date.now()}`;
  const accounts: string[] = [];
  const users: string[] = [];
  let feature = true;
  let userId = "";

  async function workspace(level = 10) {
    const u = await prisma.user.create({ data: { email: `${tag}-${users.length}@apiclient.test`, password: "x", firstName: "Ada" } });
    users.push(u.id);
    const a = await prisma.account.create({ data: { name: `${tag} ws`, slug: `${tag}-${accounts.length}`, type: "ORGANIZATION", createdById: u.id } });
    accounts.push(a.id);
    const role = await prisma.role.create({ data: { accountId: a.id, name: "r", level } });
    await prisma.accountMember.create({ data: { userId: u.id, accountId: a.id, roleId: role.id, roleLevel: level } });
    return { accountId: a.id, userId: u.id };
  }

  async function app(asUser: () => string) {
    const f = Fastify({ bodyLimit: 20 * 1024 * 1024 });
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", { get: async (k: string) => (k === "features.apiClient" ? feature : undefined) });
    f.decorate("userAuthGuard", async (req: any) => void (req.user = { userId: asUser(), id: asUser(), email: "ada@x.dev" }));
    f.setErrorHandler((err: any, _req: any, reply: any) => reply.code(err.statusCode ?? 500).send({ message: err.message, code: err.code }));
    await f.register(apiClientRoutes, { prefix: "/api/v1/api-client" });
    await f.ready();
    return f;
  }

  let f: any;
  let ws: { accountId: string; userId: string };
  const call = async (method: string, path: string, payload?: unknown) => {
    const res = await f.inject({ method, url: `/api/v1/api-client/${ws.accountId}${path}`, payload: payload as never });
    return { status: res.statusCode, body: res.json(), raw: res };
  };

  beforeAll(async () => {
    process.env.SERVER_HMAC_PEPPER ??= "p".repeat(40);
    process.env.API_CLIENT_ALLOW_PRIVATE = "1";
    prisma = new PrismaClient({ datasourceUrl: url });
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.url === "/login") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ token: "from-login", user: { id: 7 } }));
        }
        res.writeHead(req.url?.startsWith("/missing") ? 404 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body: Buffer.concat(chunks).toString() }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    target = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ws = await workspace();
    userId = ws.userId;
    f = await app(() => userId);
  });

  afterAll(async () => {
    await f?.close();
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.account.deleteMany({ where: { id: { in: accounts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
    delete process.env.API_CLIENT_ALLOW_PRIVATE;
  });

  let collectionId = "";
  let envId = "";

  it("creates collections blank, from a curl command, and refuses invalid saves and stale versions", async () => {
    const blank = await call("POST", "/collections", { name: "Shop API" });
    expect(blank.status).toBe(201);
    expect(blank.body.data).toMatchObject({ name: "Shop API", requestCount: 0, variables: [{ key: "baseUrl" }] });
    collectionId = blank.body.data.id;
    const curl = await call("POST", "/collections", { document: `curl -X POST ${target}/orders -H 'Authorization: Bearer x' -d '{"a":1}'` });
    expect(curl.body.data.requests[0]).toMatchObject({ method: "POST", url: `${target}/orders`, auth: { type: "bearer", token: "x" }, body: { type: "json" } });
    const bad = await call("PUT", `/collections/${collectionId}`, { requests: [{ id: "q1", name: "", method: "GET", url: "", params: [], headers: [], auth: { type: "none" }, body: { type: "none" }, assertions: [], captures: [] }] });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/give it a name/);
    const stale = await call("PUT", `/collections/${collectionId}`, { name: "x", expectedVersion: 99 });
    expect(stale.status).toBe(409);
    const overview = await call("GET", "");
    expect(overview.body.data).toMatchObject({ enabled: true, maxCollections: 3, maxRequests: 50, sendsPerMinute: 30 });
    expect(overview.body.data.collections).toHaveLength(2);
  });

  it("keeps environment secrets encrypted and never returns them; keep: true leaves the value", async () => {
    const env = await call("POST", "/environments", { name: "Staging", variables: [{ key: "base", value: target }, { key: "token", value: "s3cret-value", secret: true }] });
    expect(env.status).toBe(201);
    envId = env.body.data.id;
    expect(env.body.data.variables).toEqual([{ key: "base", value: target, enabled: true }, { key: "token", value: "", enabled: true, secret: true, hasValue: true }]);
    const row = await prisma.apiEnvironment.findUnique({ where: { id: envId } });
    const stored = (row!.variables as any[]).find((v) => v.key === "token").value as string;
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("s3cret");
    const kept = await call("PUT", `/environments/${envId}`, { variables: [{ key: "base", value: target }, { key: "token", value: "", secret: true, keep: true }] });
    expect(kept.body.data.variables[1]).toMatchObject({ hasValue: true });
    expect(JSON.stringify((await prisma.apiEnvironment.findUnique({ where: { id: envId } }))!.variables)).not.toContain("s3cret");
    expect((await call("POST", "/environments", { name: "Staging" })).status).toBe(409);
  });

  it("sends with the secret, shows it masked, checks and captures, saves masked history", async () => {
    const request = { name: "Me", method: "GET", url: "{{base}}/me", auth: { type: "bearer", token: "{{token}}" }, assertions: [{ id: "a1", enabled: true, source: "status", op: "eq", value: "200" }, { id: "a2", enabled: true, source: "json", path: "auth", op: "contains", value: "s3cret" }], captures: [{ id: "c1", enabled: true, variable: "seen", source: "json", path: "url" }] };
    const sent = await call("POST", "/send", { request, environmentId: envId });
    expect(sent.status).toBe(200);
    const d = sent.body.data;
    expect(d.sent).toBe(true);
    expect(JSON.parse(d.response.body).auth).toBe("Bearer s3cret-value");
    expect(d.request.headers).toContainEqual(["Authorization", "Bearer {{token}}"]);
    expect(d.assertions.map((a: any) => a.pass)).toEqual([true, true]);
    expect(d.captures).toEqual([{ variable: "seen", ok: true, value: "/me" }]);
    expect(d.response.timings.total).toBeGreaterThan(0);
    const history = await call("GET", "/history");
    expect(history.body.data.items[0]).toMatchObject({ method: "GET", url: `${target}/me`, status: 200 });
    const one = await call("GET", `/history/${d.historyId}`);
    expect(one.body.data.request.auth.token).toBe("{{token}}");
    expect(JSON.stringify(one.body.data)).not.toContain("s3cret-value\"}"); // the echoed body holds it; the request does not
    const missing = await call("POST", "/send", { request: { ...request, url: "{{nope}}/x" } });
    expect(missing.body.data).toMatchObject({ sent: false, problems: ["Define {{nope}} (in the collection or the environment) before sending"] });
  });

  it("snippets keep secrets as {{name}}", async () => {
    const s = await call("POST", "/snippet", { request: { name: "x", method: "GET", url: "{{base}}/me", auth: { type: "bearer", token: "{{token}}" } }, lang: "curl", environmentId: envId });
    expect(s.body.data.code).toContain("Bearer {{token}}");
    expect(s.body.data.code).toContain(`${target}/me`);
    expect(s.body.data.code).not.toContain("s3cret");
  });

  it("refuses private addresses unless allowed for local development", async () => {
    delete process.env.API_CLIENT_ALLOW_PRIVATE;
    try {
      const literal = await call("POST", "/send", { request: { name: "x", method: "GET", url: `${target}/x` }, noHistory: true });
      expect(literal.body.data.error).toMatchObject({ code: "EPRIVATE" });
      expect(literal.body.data.error.message).toMatch(/public addresses only/);
      const named = await call("POST", "/send", { request: { name: "x", method: "GET", url: "http://localhost:1/x" }, noHistory: true });
      expect(named.body.data.error.code).toBe("EPRIVATE");
      const viaDns = await call("POST", "/send", { request: { name: "x", method: "GET", url: "http://localtest.me:1/x" }, noHistory: true });
      expect(["EPRIVATE", "ENOTFOUND", "EAI_AGAIN"]).toContain(viaDns.body.data.error.code);
    } finally {
      process.env.API_CLIENT_ALLOW_PRIVATE = "1";
    }
  });

  it("runs a collection: captures chain into the next request, the report is saved and listed", async () => {
    const save = await call("PUT", `/collections/${collectionId}`, {
      variables: [{ key: "base", value: "overridden-by-env", enabled: true }],
      auth: { type: "bearer", token: "{{token}}" },
      folders: [{ id: "f1", name: "Account" }],
      requests: [
        { id: "q1", name: "Login", method: "POST", url: "{{base}}/login", params: [], headers: [], auth: { type: "none" }, body: { type: "json", text: "{}" }, assertions: [], captures: [{ id: "c", enabled: true, variable: "token", source: "json", path: "token" }] },
        { id: "q2", name: "Profile", method: "GET", url: "{{base}}/me", folderId: "f1", params: [], headers: [], auth: { type: "inherit" }, body: { type: "none" }, assertions: [{ id: "a", enabled: true, source: "json", path: "auth", op: "eq", value: "Bearer from-login" }], captures: [] },
        { id: "q3", name: "Missing", method: "GET", url: "{{base}}/missing", folderId: "f1", params: [], headers: [], auth: { type: "inherit" }, body: { type: "none" }, assertions: [{ id: "a", enabled: true, source: "status", op: "eq", value: "200" }], captures: [] },
      ],
      expectedVersion: 1,
    });
    expect(save.status).toBe(200);
    expect(save.body.data.version).toBe(2);
    const run = await call("POST", `/collections/${collectionId}/run`, { environmentId: envId });
    expect(run.status).toBe(200);
    const report = run.body.data.report;
    expect(report).toMatchObject({ total: 3, passed: 2, failed: 1, environment: "Staging" });
    expect(report.results[0].captures[0]).toMatchObject({ variable: "token", value: "••••" });
    expect(report.results[2]).toMatchObject({ outcome: "failed", status: 404, folder: ["Account"] });
    const runs = await call("GET", `/collections/${collectionId}/runs`);
    expect(runs.body.data.runs[0]).toMatchObject({ total: 3, failed: 1, environmentName: "Staging" });
    const detail = await call("GET", `/runs/${run.body.data.id}`);
    expect(detail.body.data.report.results).toHaveLength(3);
  });

  it("exports VhyxVoid (with the environment, secrets empty) and Postman files", async () => {
    const native = await call("GET", `/collections/${collectionId}/export?format=vhyxvoid&environmentId=${envId}`);
    expect(native.raw.headers["content-disposition"]).toMatch(/shop-api\.vhyxvoid\.json/);
    expect(native.body.collection.requests).toHaveLength(3);
    expect(native.body.environments[0].variables[1]).toMatchObject({ key: "token", value: "", secret: true });
    const pm = await call("GET", `/collections/${collectionId}/export?format=postman`);
    expect(pm.body.info.schema).toMatch(/v2\.1\.0/);
  });

  it("creates a test collection for a mock API", async () => {
    const mock = await prisma.mockApi.create({ data: { accountId: ws.accountId, label: "store", name: "Store", endpoints: [{ id: "e1", name: "Health", enabled: true, method: "GET", path: "/health", responses: [{ id: "r", status: 200, headers: {}, body: "{}", isDefault: true }] }] as never } });
    const col = await call("POST", "/collections", { mockId: mock.id });
    expect(col.status).toBe(201);
    expect(col.body.data).toMatchObject({ name: "Store tests", variables: [{ key: "baseUrl", value: expect.stringMatching(/^https:\/\/.+--store\./) }], requests: [{ url: "{{baseUrl}}/health" }] });
  });

  it("enforces the plan's collection count and send rate, and the feature switch", async () => {
    const full = await call("POST", "/collections", { name: "One too many" });
    expect(full.status).toBe(402);
    const other = await workspace();
    const prev = { ws, userId };
    ws = other;
    userId = other.userId;
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 31; i++) statuses.push((await call("POST", "/send", { request: { name: "x", method: "GET", url: `${target}/r${i}` }, noHistory: true })).status);
      expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
      expect(statuses[30]).toBe(429);
      feature = false;
      expect((await call("POST", "/send", { request: { name: "x", method: "GET", url: `${target}/r` } })).status).toBe(403);
      expect((await call("POST", "/collections", { name: "x" })).status).toBe(403);
    } finally {
      feature = true;
      ws = prev.ws;
      userId = prev.userId;
    }
  });

  it("another workspace's member can't reach this workspace", async () => {
    const stranger = await workspace();
    const prev = userId;
    userId = stranger.userId;
    try {
      expect((await call("GET", "")).status).toBe(403);
      expect((await call("GET", `/collections/${collectionId}`)).status).toBe(403);
    } finally {
      userId = prev;
    }
  });

  it("clears my history", async () => {
    const del = await call("DELETE", "/history");
    expect(del.body.data.deleted).toBeGreaterThan(0);
    expect((await call("GET", "/history")).body.data.items).toEqual([]);
  });
});
