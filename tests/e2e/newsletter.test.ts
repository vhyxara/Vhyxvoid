// The newsletter: double opt-in with signed links, answers that never reveal
// whether an address is known, throttled confirmation emails, one-click
// unsubscribe, the CSV export, and a post emailed once to confirmed
// subscribers only, each with their own unsubscribe link.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { adminNewsletterRoutes, newsletterToken, publicNewsletterRoutes, readNewsletterToken, setNewsletterMailer } from "../../apps/api/src/modules/platform/newsletter/newsletter.routes";

const require = createRequire(import.meta.url);
const Fastify = require("../../apps/api/node_modules/fastify");
const rateLimit = require("../../apps/api/node_modules/@fastify/rate-limit");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;
const ID = "6f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";

describe("newsletter links", () => {
  it("are signed, confirm links expire, unsubscribe links don't", () => {
    const now = Date.now();
    const c = newsletterToken("confirm", ID, now);
    expect(readNewsletterToken("confirm", c, now)).toBe(ID);
    expect(readNewsletterToken("unsubscribe", c, now)).toBeNull();
    expect(readNewsletterToken("confirm", c, now + 8 * 86400_000)).toBeNull();
    expect(readNewsletterToken("confirm", c.replace(/.$/, (x) => (x === "A" ? "B" : "A")), now)).toBeNull();
    const u = newsletterToken("unsubscribe", ID, now);
    expect(readNewsletterToken("unsubscribe", u, now + 3650 * 86400_000)).toBe(ID);
    expect(readNewsletterToken("unsubscribe", "nope", now)).toBeNull();
  });
});

describe.skipIf(!url)("newsletter", { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let f: any;
  const sent: any[] = [];
  const tag = `nl${Date.now().toString(36)}`;
  const addr = (n: string) => `${n}.${tag}@example.com`;
  const settings: Record<string, unknown> = { "newsletter.enabled": true, "seo.siteUrl": "https://site.test", "general.productName": "VhyxVoid" };
  let postId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.newsletterSubscriber.deleteMany({ where: { email: { contains: tag } } });
    setNewsletterMailer({ send: async (m: any) => (sent.push(m), { id: "x" }) } as never, 0);
    f = Fastify({ trustProxy: true });
    await f.register(rateLimit, { global: false });
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", { get: async (k: string) => settings[k] });
    f.decorate("requireAbility", () => async (r: any) => void (r.admin = { id: "00000000-0000-4000-8000-00000000000d", email: "admin@test", isSuperAdmin: true }));
    f.setErrorHandler(errorHandler);
    await f.register(publicNewsletterRoutes, { prefix: "/api/v1/public/newsletter" });
    await f.register(adminNewsletterRoutes, { prefix: "/api/v1/admin/newsletter" });
    await f.ready();
    postId = (await prisma.blogPost.create({ data: { slug: `${tag}-post`, title: "Replay is here", body: "Replay any request.", status: "PUBLISHED", publishedAt: new Date(Date.now() - 1000), coverImageUrl: "/media/x/cover.png" } })).id;
  });

  afterAll(async () => {
    setNewsletterMailer(null);
    await f?.close();
    await prisma.newsletterSubscriber.deleteMany({ where: { email: { contains: tag } } });
    await prisma.blogPost.deleteMany({ where: { slug: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  const call = (method: string, u: string, payload?: unknown, ip = "10.0.0.1") => f.inject({ method, url: u, payload, headers: { "x-forwarded-for": ip } }).then((r: any) => ({ status: r.statusCode as number, body: r.headers["content-type"]?.includes("json") ? r.json() : r.body }));
  const subscribe = (email: string, ip?: string) => call("POST", "/api/v1/public/newsletter", { email, source: "footer" }, ip);
  const linkIn = (m: any, path: string) => new URL(String(m.text.match(new RegExp(`https://site\\.test${path}\\?token=\\S+`))?.[0])).searchParams.get("token")!;

  it("signs up with a confirmation email, and only confirmed addresses count", async () => {
    sent.length = 0;
    const r = await subscribe(addr("ann").toUpperCase(), "10.0.1.1");
    expect(r.status).toBe(202);
    const row = await prisma.newsletterSubscriber.findUnique({ where: { email: addr("ann") } });
    expect(row).toMatchObject({ status: "PENDING", source: "footer" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(addr("ann"));

    const c = await call("POST", "/api/v1/public/newsletter/confirm", { token: linkIn(sent[0], "/newsletter/confirm") });
    expect(c.status).toBe(200);
    expect(await prisma.newsletterSubscriber.findUnique({ where: { email: addr("ann") } })).toMatchObject({ status: "CONFIRMED" });
    expect((await call("POST", "/api/v1/public/newsletter/confirm", { token: "bad.0.token" })).status).toBe(400);
  });

  it("answers the same for known addresses and doesn't flood an inbox", async () => {
    sent.length = 0;
    expect((await subscribe(addr("ann"), "10.0.2.1")).status).toBe(202);
    expect(sent).toHaveLength(0); // already confirmed: nothing sent, same answer
    await subscribe(addr("bob"), "10.0.2.2");
    await subscribe(addr("bob"), "10.0.2.3");
    expect(sent.filter((m) => m.to === addr("bob"))).toHaveLength(1);
    // The honeypot: answered as if fine, nothing stored.
    const r = await call("POST", "/api/v1/public/newsletter", { email: addr("bot"), website: "x" }, "10.0.2.4");
    expect(r.status).toBe(202);
    expect(await prisma.newsletterSubscriber.findUnique({ where: { email: addr("bot") } })).toBeNull();
    settings["newsletter.enabled"] = false;
    expect((await subscribe(addr("cat"), "10.0.2.5")).status).toBe(503);
    settings["newsletter.enabled"] = true;
  });

  it("lists with counts and exports confirmed subscribers only", async () => {
    const l = await call("GET", `/api/v1/admin/newsletter?search=${tag}`);
    expect(l.body.meta.total).toBe(2);
    expect(l.body.extra.counts.CONFIRMED).toBeGreaterThanOrEqual(1);
    const csv = await call("GET", "/api/v1/admin/newsletter/export.csv");
    expect(csv.body).toContain(addr("ann"));
    expect(csv.body).not.toContain(addr("bob"));
  });

  it("emails a live post once, to confirmed subscribers, each with their own one-click unsubscribe", async () => {
    sent.length = 0;
    const t = await call("POST", `/api/v1/admin/newsletter/posts/${postId}/send`, { test: true });
    expect(t.body.data.to).toBe("admin@test");
    expect(sent[0].subject).toBe("[Test] Replay is here");
    expect(await prisma.blogPost.findUnique({ where: { id: postId }, select: { newsletterSentAt: true } })).toEqual({ newsletterSentAt: null });

    sent.length = 0;
    const r = await call("POST", `/api/v1/admin/newsletter/posts/${postId}/send`, {});
    expect(r.status).toBe(202);
    expect((await call("POST", `/api/v1/admin/newsletter/posts/${postId}/send`, {})).status).toBe(409);
    await expect.poll(() => sent.filter((m) => m.to === addr("ann")).length).toBe(1);
    const mine = sent.find((m) => m.to === addr("ann"));
    expect(sent.some((m) => m.to === addr("bob"))).toBe(false);
    expect(mine.html).toContain("https://site.test/media/x/cover.png");
    expect(mine.text).toContain("https://site.test/blog/");
    expect(mine.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const token = new URL(mine.headers["List-Unsubscribe"].slice(1, -1)).searchParams.get("token");

    // A mail client's one-click: form-encoded POST, token in the query.
    const u = await f.inject({ method: "POST", url: `/api/v1/public/newsletter/unsubscribe?token=${token}`, payload: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(u.statusCode).toBe(200);
    expect(await prisma.newsletterSubscriber.findUnique({ where: { email: addr("ann") } })).toMatchObject({ status: "UNSUBSCRIBED" });
  });

  it("refuses posts that aren't live", async () => {
    const draft = await prisma.blogPost.create({ data: { slug: `${tag}-draft`, title: "Draft", body: "x" } });
    expect((await call("POST", `/api/v1/admin/newsletter/posts/${draft.id}/send`, {})).status).toBe(400);
  });
});
