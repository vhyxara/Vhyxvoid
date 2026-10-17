// Draft preview links: signed, expiring, tamper-proof; they show the saved
// working copy (not the published one) of a page or a post.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { adminPreviewRoutes, publicPreviewRoutes, signPreview, verifyPreview, PREVIEW_HOURS } from "../../apps/api/src/modules/platform/preview/preview.routes";

const require = createRequire(import.meta.url);
const Fastify = require("../../apps/api/node_modules/fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe("preview links", () => {
  process.env.SERVER_HMAC_PEPPER ??= "test-pepper";
  const id = "00000000-0000-4000-8000-000000000001";

  it("verify what they were signed for, until they expire", () => {
    const now = Date.now();
    const { token, expiresAt } = signPreview("post", id, now);
    expect(verifyPreview(token, now)).toMatchObject({ k: "post", id });
    expect(expiresAt.getTime() - now).toBeGreaterThan((PREVIEW_HOURS - 1) * 3600_000);
    expect(verifyPreview(token, now + (PREVIEW_HOURS + 1) * 3600_000)).toBeNull();
  });

  it("refuse tampered or malformed tokens", () => {
    const { token } = signPreview("content", id);
    const [payload, sig] = token.split(".");
    const other = Buffer.from(JSON.stringify({ k: "content", id: "00000000-0000-4000-8000-000000000002", exp: 9999999999 })).toString("base64url");
    expect(verifyPreview(`${other}.${sig}`)).toBeNull();
    expect(verifyPreview(`${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(verifyPreview("nonsense")).toBeNull();
    expect(verifyPreview("")).toBeNull();
  });
});

describe.skipIf(!url)("previewing drafts", { timeout: 30_000 }, () => {
  let prisma: PrismaClient;
  let f: any;
  const tag = `pv${Date.now() % 1e7}`;
  const cleanup: Array<() => Promise<unknown>> = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("requireAbility", () => async (r: any) => void (r.admin = { id: "00000000-0000-4000-8000-00000000000d", email: "pv@test", isSuperAdmin: true }));
    f.setErrorHandler(errorHandler);
    await f.register(adminPreviewRoutes, { prefix: "/api/v1/admin/preview" });
    await f.register(publicPreviewRoutes, { prefix: "/api/v1/public/preview" });
    await f.ready();
  });

  afterAll(async () => {
    for (const c of cleanup) await c();
    await f?.close();
    await prisma.$disconnect();
  });

  const call = (method: string, path: string) => f.inject({ method, url: `/api/v1${path}` }).then((r: any) => ({ status: r.statusCode as number, body: r.json(), headers: r.headers }));

  it("shows a page's working copy, not what is published", async () => {
    const e = await prisma.contentEntry.create({ data: { slug: `${tag}-about`, kind: "page", title: "About", status: "PUBLISHED", data: { body: "# Draft words", showInFooter: false, footerGroup: "company" }, publishedData: { body: "# Live words", showInFooter: false, footerGroup: "company" } } });
    cleanup.push(() => prisma.contentEntry.delete({ where: { id: e.id } }));
    const link = await call("POST", `/admin/preview/content/${e.id}`);
    expect(link.status).toBe(201);
    expect(link.body.data.path).toBe(`/${tag}-about`);
    const view = await call("GET", `/public/preview?token=${link.body.data.token}`);
    expect(view.status).toBe(200);
    expect(view.body.data.entry.data.body).toBe("# Draft words");
    expect(view.headers["cache-control"]).toBe("no-store");
    expect(view.headers["x-robots-tag"]).toContain("noindex");
  });

  it("shows a draft post, and a deleted one is gone", async () => {
    const p = await prisma.blogPost.create({ data: { slug: `${tag}-draft`, title: "Not out yet", body: "Secret plans", excerpt: "", status: "DRAFT", authorName: "A", createdById: "x", updatedById: "x" } });
    const link = await call("POST", `/admin/preview/post/${p.id}`);
    expect(link.body.data.path).toBe(`/blog/${tag}-draft`);
    const view = await call("GET", `/public/preview?token=${link.body.data.token}`);
    expect(view.body.data).toMatchObject({ kind: "post", state: "DRAFT", post: { title: "Not out yet", body: "Secret plans", excerpt: "Secret plans" } });
    await prisma.blogPost.delete({ where: { id: p.id } });
    expect((await call("GET", `/public/preview?token=${link.body.data.token}`)).status).toBe(404);
    expect((await call("GET", "/public/preview?token=forged.token")).status).toBe(404);
    expect((await call("POST", `/admin/preview/post/${p.id}`)).status).toBe(404);
  });
});
