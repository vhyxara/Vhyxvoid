// The changelog: drafts stay hidden, publishing dates an entry (or keeps the
// date given), future-dated entries wait, and the public list is newest first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { adminChangelogRoutes, publicChangelogRoutes } from "../../apps/api/src/modules/platform/changelog/changelog.routes";

const require = createRequire(import.meta.url);
const Fastify = require("../../apps/api/node_modules/fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe.skipIf(!url)("changelog", { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let f: any;
  const tag = `cl${Date.now().toString(36)}`;
  const invalidated: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("platformContent", { invalidate: (r: string) => invalidated.push(r) });
    f.decorate("requireAbility", () => async (r: any) => void (r.admin = { id: "00000000-0000-4000-8000-00000000000e", email: "a@test", isSuperAdmin: true }));
    f.setErrorHandler(errorHandler);
    await f.register(adminChangelogRoutes, { prefix: "/api/v1/admin/changelog" });
    await f.register(publicChangelogRoutes, { prefix: "/api/v1/public/changelog" });
    await f.ready();
  });

  afterAll(async () => {
    await f?.close();
    await prisma.changelogEntry.deleteMany({ where: { title: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  const call = (method: string, u: string, payload?: unknown) => f.inject({ method, url: u, payload }).then((r: any) => ({ status: r.statusCode as number, body: r.json() }));
  const ours = async () => (await call("GET", "/api/v1/public/changelog?limit=50")).body.data.items.filter((e: any) => e.title.startsWith(tag));

  it("keeps drafts hidden and dates entries when they are published", async () => {
    expect((await call("POST", "/api/v1/admin/changelog", { title: "" })).status).toBe(400);
    expect((await call("POST", "/api/v1/admin/changelog", { title: `${tag} x`, kinds: ["shiny"] })).status).toBe(400);
    const d = await call("POST", "/api/v1/admin/changelog", { title: `${tag} replay`, version: "1.8.0", kinds: ["new", "fixed"], body: "- Replay any request" });
    expect(d.status).toBe(201);
    expect(d.body.data).toMatchObject({ status: "DRAFT", publishedAt: null });
    expect(await ours()).toHaveLength(0);
    expect(invalidated).toHaveLength(0);

    const p = await call("PATCH", `/api/v1/admin/changelog/${d.body.data.id}`, { status: "PUBLISHED" });
    expect(p.body.data.publishedAt).toBeTruthy();
    expect(invalidated).toEqual(["changelog"]);
    expect((await ours()).map((e: any) => e.version)).toEqual(["1.8.0"]);

    // Back to draft and published again: it keeps its date.
    await call("PATCH", `/api/v1/admin/changelog/${d.body.data.id}`, { status: "DRAFT" });
    expect(await ours()).toHaveLength(0);
    const again = await call("PATCH", `/api/v1/admin/changelog/${d.body.data.id}`, { status: "PUBLISHED" });
    expect(again.body.data.publishedAt).toBe(p.body.data.publishedAt);
  });

  it("lists newest first, and waits for future dates", async () => {
    await call("POST", "/api/v1/admin/changelog", { title: `${tag} old`, status: "PUBLISHED", publishedAt: "2026-01-02T10:00:00Z" });
    await call("POST", "/api/v1/admin/changelog", { title: `${tag} future`, status: "PUBLISHED", publishedAt: new Date(Date.now() + 86400_000).toISOString() });
    expect((await ours()).map((e: any) => e.title)).toEqual([`${tag} replay`, `${tag} old`]);
    const admin = await call("GET", `/api/v1/admin/changelog?search=${tag}`);
    expect(admin.body.meta.total).toBe(3);
  });

  it("deletes", async () => {
    const [e] = await ours();
    expect((await call("DELETE", `/api/v1/admin/changelog/${e.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/v1/admin/changelog/${e.id}`)).status).toBe(404);
  });
});
