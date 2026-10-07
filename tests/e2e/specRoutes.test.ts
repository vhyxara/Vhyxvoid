// Phase 5 against a real database (opt-in: VHYXVOID_TEST_DATABASE_URL):
// /api/v1/specs (create, draft saves, validate, publish with the breaking-change
// report, versions, diff, restore, sharing, docs domains) and
// /api/v1/public/specs (visibility, password unlock, by-host, try-it to a mock
// through a stand-in hub, the OpenAPI download).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { specRoutes } from "../../apps/api/src/modules/platform/specs/specs.routes";
import { publicSpecRoutes } from "../../apps/api/src/modules/platform/specs/specs.public.routes";
import { analyticsRoutes } from "../../apps/api/src/modules/platform/perf/analytics.routes";
import { parseSpecText, signDocsToken, verifyDocsToken, hashDocsPassword } from "../../apps/api/src/modules/platform/specs/specDocs";
import { staticDnsResolver, verificationRecord } from "@vhyxvoid/shared";

const Fastify = createRequire(new URL("../../apps/api/package.json", import.meta.url))("fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe("specDocs helpers", () => {
  it("reads YAML and JSON, converts Swagger 2, and reports parse errors with a line", () => {
    expect(parseSpecText('{"openapi":"3.0.3","info":{"title":"a","version":"1"},"paths":{}}')).toMatchObject({ format: "json", converted: false });
    const sw = parseSpecText("swagger: '2.0'\ninfo: { title: a, version: '1' }\npaths: {}\n");
    expect(sw).toMatchObject({ format: "yaml", converted: true });
    expect(sw.problems[0].path).toBe("swagger");
    const bad = parseSpecText("openapi: 3.0.3\ninfo:\n  title: [unclosed\n");
    expect(bad.doc).toBeNull();
    expect(bad.problems[0].message).toMatch(/Not valid YAML/);
    expect(parseSpecText("hello: world\n").problems[0].message).toMatch(/OpenAPI 3/);
  });

  it("docs tokens expire and die with the password", () => {
    process.env.SERVER_HMAC_PEPPER ??= "p".repeat(40);
    const h1 = hashDocsPassword("s1", "secret-1");
    const t = signDocsToken("s1", h1, 1_000_000);
    expect(verifyDocsToken("s1", h1, t, 1_000_000)).toBe(true);
    expect(verifyDocsToken("s2", h1, t, 1_000_000)).toBe(false);
    expect(verifyDocsToken("s1", hashDocsPassword("s1", "secret-2"), t, 1_000_000)).toBe(false);
    expect(verifyDocsToken("s1", h1, t, 1_000_000 + 13 * 3600_000)).toBe(false);
    expect(verifyDocsToken("s1", h1, "garbage", 1_000_000)).toBe(false);
  });
});

describe.skipIf(!url)("API docs routes", () => {
  let prisma: PrismaClient;
  let f: any;
  let hub: http.Server;
  const tag = `spec-${Date.now()}`;
  const accounts: string[] = [];
  const users: string[] = [];
  let ws = { accountId: "", userId: "", slug: "" };
  let actAs = "";
  const hubSeen: Array<{ host: string; path: string; method: string; body: string }> = [];
  const dnsRecords: Record<string, Record<string, string[]>> = {};
  let features = true;

  async function workspace(level = 100) {
    const u = await prisma.user.create({ data: { email: `${tag}-${users.length}@spec.test`, password: "x", firstName: "Ada" } });
    users.push(u.id);
    const slug = `${tag}-${accounts.length}`.toLowerCase();
    const a = await prisma.account.create({ data: { name: `${tag} ws`, slug, type: "ORGANIZATION", createdById: u.id } });
    accounts.push(a.id);
    const role = await prisma.role.create({ data: { accountId: a.id, name: "r", level } });
    await prisma.accountMember.create({ data: { userId: u.id, accountId: a.id, roleId: role.id, roleLevel: level } });
    return { accountId: a.id, userId: u.id, slug };
  }
  const call = async (method: string, path: string, payload?: unknown) => {
    const res = await f.inject({ method, url: `/api/v1/specs/${ws.accountId}${path}`, payload: payload as never });
    return { status: res.statusCode, body: res.body.startsWith("{") ? res.json() : res.body, headers: res.headers };
  };
  const pub = async (method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await f.inject({ method, url: `/api/v1/public/specs${path}`, payload: payload as never, headers });
    return { status: res.statusCode, body: res.body.startsWith("{") ? res.json() : res.body, headers: res.headers };
  };

  beforeAll(async () => {
    process.env.SERVER_HMAC_PEPPER ??= "p".repeat(40);
    process.env.HUB_DOMAIN = "vv.test";
    process.env.APP_URL = "https://app.example";
    prisma = new PrismaClient({ datasourceUrl: url });
    hub = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        hubSeen.push({ host: String(req.headers.host), path: req.url ?? "", method: req.method ?? "", body });
        res.writeHead(200, { "content-type": "application/json", "set-cookie": "a=b" });
        res.end(JSON.stringify({ from: "mock", path: req.url }));
      });
    });
    await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
    process.env.HUB_INTERNAL_URL = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`;

    ws = await workspace();
    actAs = ws.userId;
    // The default plan (Free) has neither passwords nor domains; the free case is tested on its own.
    await prisma.account.update({ where: { id: ws.accountId }, data: { limitOverrides: { maxApiSpecs: 20, protectedDocs: true, docsCustomDomains: true } } });
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", { get: async (k: string) => (k.startsWith("features.") ? features : undefined) });
    f.decorate("userAuthGuard", async (req: any) => void (req.user = { userId: actAs, id: actAs }));
    f.setErrorHandler((err: any, _req: any, reply: any) => reply.code(err.statusCode ?? 500).send({ message: err.message }));
    const hubClient = { invalidateDomain: async () => undefined };
    await f.register(specRoutes, { prefix: "/api/v1/specs", hub: hubClient, dns: { resolveTxt: (n: string) => staticDnsResolver(dnsRecords as never).resolveTxt(n), resolveCname: (n: string) => staticDnsResolver(dnsRecords as never).resolveCname(n), resolve4: (n: string) => staticDnsResolver(dnsRecords as never).resolve4(n), resolve6: (n: string) => staticDnsResolver(dnsRecords as never).resolve6(n) } });
    await f.register(publicSpecRoutes, { prefix: "/api/v1/public/specs" });
    await f.register(analyticsRoutes, { prefix: "/api/v1/analytics" });
    await f.ready();
  });

  afterAll(async () => {
    await f?.close();
    await new Promise<void>((r) => hub.close(() => r()));
    await prisma.account.deleteMany({ where: { id: { in: accounts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  let specId = "";
  let v1 = "";

  it("creates from the starter, saves drafts with an optimistic lock and validates without saving", async () => {
    const created = await call("POST", "", { name: "Shop API" });
    expect(created.status).toBe(201);
    specId = created.body.data.id;
    expect(created.body.data).toMatchObject({ slug: "shop-api", visibility: "PRIVATE", latest: null, unpublished: true, publicUrl: `https://app.example/api-docs/${ws.slug}/shop-api` });
    // Same name again: the slug gets a suffix.
    expect((await call("POST", "", { name: "Shop API" })).body.data.slug).toBe("shop-api-2");

    const got = await call("GET", `/${specId}`);
    expect(got.body.data.draftText).toContain("openapi: 3.0.3");
    expect(got.body.data.problems).toEqual([]);

    const v = await call("POST", "/validate", { text: "openapi: 3.0.3\ninfo: {title: x}\npaths: {}\n" });
    expect(v.body.data.problems.map((p: any) => p.path)).toContain("info.version");
    expect(v.body.data.model.title).toBe("x");

    // A broken draft is kept (people save half-written YAML), with its problems.
    const broken = await call("PUT", `/${specId}`, { text: "openapi: 3.0.3\ninfo: [\n", expectedVersion: got.body.data.version });
    expect(broken.status).toBe(200);
    expect(broken.body.data.problems[0].message).toMatch(/Not valid YAML/);
    expect((await call("PUT", `/${specId}`, { text: "x", expectedVersion: got.body.data.version })).status).toBe(409);
    // Publishing a broken draft is refused.
    expect((await call("POST", `/${specId}/publish`, {})).status).toBe(400);
  });

  it("publishes versions with the changes since the last one", async () => {
    const starter = (await call("POST", "", { name: "Tmp", slug: "tmp" })).body.data;
    const text = (await call("GET", `/${starter.id}`)).body.data.draftText as string;
    await call("DELETE", `/${starter.id}`);
    await call("PUT", `/${specId}`, { text });
    const p1 = await call("POST", `/${specId}/publish`, { notes: "First" });
    expect(p1.status).toBe(201);
    expect(p1.body.data).toMatchObject({ number: 1, version: "1.0.0", breaking: 0, notes: "First" });
    v1 = p1.body.data.id;
    expect((await call("POST", `/${specId}/publish`, {})).status).toBe(409);

    // A form edit: the whole document, written back as YAML.
    const doc = (await call("GET", `/${specId}/export?format=json`)).body;
    const parsed = typeof doc === "string" ? JSON.parse(doc) : doc;
    delete parsed.paths["/users/{id}"];
    parsed.info.version = "2.0.0";
    const saved = await call("PUT", `/${specId}`, { doc: parsed });
    expect(saved.body.data.draftText).toContain("version: 2.0.0");
    expect(saved.body.data.unpublished).toBe(true);

    const preview = await call("POST", `/${specId}/preview`, {});
    expect(preview.body.data.counts.breaking).toBe(1);
    expect(preview.body.data.changes[0]).toMatchObject({ severity: "breaking", location: "GET /users/{id}", message: "operation removed" });

    const p2 = await call("POST", `/${specId}/publish`, {});
    expect(p2.body.data).toMatchObject({ number: 2, version: "2.0.0", breaking: 1 });
    const versions = await call("GET", `/${specId}/versions`);
    expect(versions.body.data.versions.map((v: any) => v.number)).toEqual([2, 1]);
    expect(versions.body.data.versions[0].counts).toMatchObject({ breaking: 1 });

    const diff = await call("GET", `/${specId}/diff?from=${v1}&to=latest`);
    expect(diff.body.data).toMatchObject({ from: "v1", to: "v2" });
    expect(diff.body.data.counts.breaking).toBe(1);
    const one = await call("GET", `/${specId}/versions/${v1}`);
    expect(one.body.data.model.operationCount).toBe(3);

    expect((await call("POST", `/${specId}/versions/${v1}/restore`)).status).toBe(200);
    expect((await call("GET", `/${specId}`)).body.data.draftText).toContain("/users/{id}");
    const yaml = await call("GET", `/${specId}/export?version=latest`);
    expect(yaml.headers["content-disposition"]).toContain("shop-api-v2.yaml");
  });

  it("public docs: private is 404, public answers, a password locks it", async () => {
    expect((await pub("GET", `/${ws.slug}/shop-api`)).status).toBe(404);
    expect((await call("PUT", `/${specId}/sharing`, { visibility: "PUBLIC" })).status).toBe(200);
    const read = await pub("GET", `/${ws.slug}/shop-api`);
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ name: "Shop API", number: 2, canTry: false });
    expect(read.body.data.versions.map((v: any) => v.number)).toEqual([2, 1]);
    expect((await pub("GET", `/${ws.accountId}/shop-api?version=1`)).body.data.model.operationCount).toBe(3);
    // Any origin may read them.
    const pre = await pub("OPTIONS", `/${ws.slug}/shop-api`, undefined, { origin: "https://docs.acme.dev", "access-control-request-method": "GET" });
    expect(pre.status).toBeLessThan(500);

    expect((await call("PUT", `/${specId}/sharing`, { visibility: "PASSWORD" })).status).toBe(400);
    expect((await call("PUT", `/${specId}/sharing`, { visibility: "PASSWORD", password: "open-sesame" })).status).toBe(200);
    const lockedRead = await pub("GET", `/${ws.slug}/shop-api`);
    expect(lockedRead.status).toBe(401);
    expect(lockedRead.body.data.passwordRequired).toBe(true);
    expect((await pub("POST", `/${ws.slug}/shop-api/unlock`, { password: "nope" })).status).toBe(401);
    const token = (await pub("POST", `/${ws.slug}/shop-api/unlock`, { password: "open-sesame" })).body.data.token;
    expect((await pub("GET", `/${ws.slug}/shop-api`, undefined, { "x-docs-token": token })).status).toBe(200);
    const dl = await pub("GET", `/${ws.slug}/shop-api/openapi?format=json&token=${token}`);
    expect(dl.body.info.version).toBe("2.0.0");
    // A new password logs every reader out.
    await call("PUT", `/${specId}/sharing`, { visibility: "PASSWORD", password: "second-pass" });
    expect((await pub("GET", `/${ws.slug}/shop-api`, undefined, { "x-docs-token": token })).status).toBe(401);
  });

  it("try-it goes to the linked mock through the hub, never elsewhere", async () => {
    await call("PUT", `/${specId}/sharing`, { visibility: "PUBLIC" });
    expect((await pub("POST", `/${ws.slug}/shop-api/try`, { path: "/users" })).status).toBe(400);
    const mock = await prisma.mockApi.create({ data: { accountId: ws.accountId, label: "shop", name: "Shop mock" } });
    expect((await call("PUT", `/${specId}/sharing`, { visibility: "PUBLIC", tryMockId: mock.id })).status).toBe(200);
    expect((await pub("GET", `/${ws.slug}/shop-api`)).body.data.canTry).toBe(true);
    const tried = await pub("POST", `/${ws.slug}/shop-api/try`, { method: "POST", path: "/users?x=1", headers: { "content-type": "application/json", host: "evil.example", cookie: "s=1" }, body: '{"name":"Ada"}' });
    expect(tried.status).toBe(200);
    expect(tried.body.data).toMatchObject({ status: 200, body: JSON.stringify({ from: "mock", path: "/users?x=1" }) });
    expect(tried.body.data.headers["set-cookie"]).toBeUndefined();
    expect(hubSeen.at(-1)).toMatchObject({ host: `${ws.slug}--shop.vv.test`, method: "POST", path: "/users?x=1", body: '{"name":"Ada"}' });
  });

  it("creates a spec from a mock and from a Swagger 2 document", async () => {
    const mock = await prisma.mockApi.create({ data: { accountId: ws.accountId, label: "pets", name: "Pets", endpoints: [{ id: "e1", method: "GET", path: "/pets", responses: [{ id: "r1", status: 200, body: "[]", headers: [] }] }] as never } });
    const fromMock = await call("POST", "", { name: "Pets docs", mockId: mock.id });
    expect(fromMock.status).toBe(201);
    const text = (await call("GET", `/${fromMock.body.data.id}`)).body.data.draftText;
    expect(text).toContain("/pets");
    expect(text).toContain(`https://${ws.slug}--pets.vv.test`);
    const sw = await call("POST", "", { name: "Legacy", document: JSON.stringify({ swagger: "2.0", info: { title: "L", version: "1" }, paths: {} }) });
    expect((await call("GET", `/${sw.body.data.id}`)).body.data.draftText).toContain('"openapi": "3.0.3"');
  });

  it("analytics compares traffic with a spec's latest version", async () => {
    const res = await f.inject({ method: "POST", url: `/api/v1/analytics/${ws.accountId}/drift`, payload: { window: "1h", specId } });
    expect(res.statusCode).toBe(200);
    // v2 (the latest) dropped GET /users/{id}: two operations, none called.
    expect(res.json().data).toMatchObject({ spec: { name: "Shop API" } });
    expect(res.json().data.unused).toHaveLength(2);
  });

  it("docs domains: plan-gated, verified by TXT, then served by host", async () => {
    const add = await call("PUT", `/${specId}/domain`, { hostname: "docs.acme.test" });
    expect(add.status).toBe(200);
    const rec = add.body.data.domainRecords.verification;
    expect((await pub("GET", "/by-host/docs.acme.test")).status).toBe(404);
    expect((await call("POST", `/${specId}/domain/check`)).body.data.customDomainVerified).toBe(false);
    const token = (await prisma.apiSpec.findUnique({ where: { id: specId } }))!.customDomainToken!;
    expect(rec).toMatchObject(verificationRecord("docs.acme.test", token));
    dnsRecords[rec.name] = { TXT: [rec.value] };
    const checked = await call("POST", `/${specId}/domain/check`);
    expect(checked.body.data).toMatchObject({ customDomainVerified: true, customDomainUrl: "https://docs.acme.test" });
    expect((await pub("GET", "/by-host/docs.acme.test")).body.data).toMatchObject({ workspace: ws.slug, slug: "shop-api" });

    // Free plan: no passwords, no domains.
    const free = await workspace();
    await prisma.account.update({ where: { id: free.accountId }, data: { limitOverrides: { protectedDocs: false, docsCustomDomains: false, maxApiSpecs: 1 } } });
    const saved = ws;
    ws = free;
    actAs = free.userId;
    try {
      const s = (await call("POST", "", { name: "One" })).body.data;
      expect((await call("POST", "", { name: "Two" })).status).toBe(402);
      expect((await call("PUT", `/${s.id}/sharing`, { visibility: "PASSWORD", password: "abcdefgh" })).status).toBe(403);
      expect((await call("PUT", `/${s.id}/domain`, { hostname: "docs.free.test" })).status).toBe(403);
    } finally {
      ws = saved;
      actAs = saved.userId;
    }
  });

  it("members edit; sharing and deleting are for admins; the feature switch hides everything", async () => {
    const m = await prisma.user.create({ data: { email: `${tag}-member@spec.test`, password: "x", firstName: "M" } });
    users.push(m.id);
    const role = await prisma.role.create({ data: { accountId: ws.accountId, name: "m", level: 10 } });
    await prisma.accountMember.create({ data: { userId: m.id, accountId: ws.accountId, roleId: role.id, roleLevel: 10 } });
    actAs = m.id;
    try {
      expect((await call("PUT", `/${specId}`, { description: "by a member" })).status).toBe(200);
      expect((await call("PUT", `/${specId}/sharing`, { visibility: "PRIVATE" })).status).toBe(403);
      expect((await call("DELETE", `/${specId}`)).status).toBe(403);
    } finally {
      actAs = ws.userId;
    }
    features = false;
    try {
      expect((await pub("GET", `/${ws.slug}/shop-api`)).status).toBe(404);
      expect((await call("POST", `/${specId}/publish`, {})).status).toBe(403);
    } finally {
      features = true;
    }
  });
});
