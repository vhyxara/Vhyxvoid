// Website CMS against a real database (opt-in: VHYXVOID_TEST_DATABASE_URL):
// the footer menu (built-in until one is published, page links resolved and
// dropped when the page isn't live), slugs pages can't use, the website being
// told to refresh after a change, and the contact form with its admin inbox.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { ContentService } from "../../apps/api/src/modules/platform/content/content.service";
import { footerSchema } from "../../apps/api/src/modules/platform/content/content.schemas";
import { publicRoutes } from "../../apps/api/src/modules/platform/public/public.routes";
import { adminContentRoutes } from "../../apps/api/src/modules/platform/admin/admin.settings-content.routes";
import { adminContactRoutes, publicContactRoutes, setContactMailer } from "../../apps/api/src/modules/platform/contact/contact.routes";
import { isReservedPageSlug } from "../../packages/content/src";

const req = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const Fastify = req("fastify");
const rateLimit = req("@fastify/rate-limit");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe("footer links and page slugs (no database)", () => {
  it("footer links take https, mailto and site paths, not other sites or scripts", () => {
    const col = (href: string) => ({ columns: [{ id: "c", title: "T", links: [{ id: "l", label: "L", type: "url", href }] }] });
    for (const ok of ["https://github.com/x", "mailto:hi@example.com", "/pricing", "/#features", "/"]) expect(footerSchema.safeParse(col(ok)).success, ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "//evil.example", "/\\evil.example", "ftp://x", "evil.example", "https://exa mple.com"]) expect(footerSchema.safeParse(col(bad)).success, bad).toBe(false);
    expect(footerSchema.safeParse({ columns: [{ id: "c", title: "T", links: [{ id: "l", label: "L", type: "page" }] }] }).success).toBe(false);
  });
  it("slugs that are the website's own routes are reserved", () => {
    for (const s of ["login", "dashboard/x", "pricing", "p/about", "fr", "api", "footer"]) expect(isReservedPageSlug(s), s).toBe(true);
    for (const s of ["about", "contact", "legal/terms", "privacy", "careers"]) expect(isReservedPageSlug(s), s).toBe(false);
  });
});

describe.skipIf(!url)("website CMS", { timeout: 30_000 }, () => {
  let prisma: PrismaClient;
  let f: any;
  let content: ContentService;
  let hook: http.Server;
  const hits: Array<{ secret: string | undefined; body: string }> = [];
  const sent: any[] = [];
  const settings: Record<string, unknown> = { "support.docsUrl": "/docs", "general.statusPageUrl": "https://status.example.com", "general.githubUrl": "", "general.twitterUrl": "", "support.contactForm": true, "support.email": "help@example.com" };
  let adminId = "";
  const tag = `cms${Date.now() % 1e8}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.contentEntry.deleteMany({ where: { slug: { in: ["footer", "about", `${tag}-a`, `${tag}-b`] } } });
    adminId = (await prisma.adminUser.findFirst({ select: { id: true } }))?.id ?? "00000000-0000-4000-8000-000000000000";
    hook = http.createServer((r, res) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => (hits.push({ secret: r.headers["x-revalidate-secret"] as string | undefined, body }), res.end("ok")));
    });
    await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
    process.env.WEB_REVALIDATE_URL = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/api/revalidate`;
    process.env.WEB_REVALIDATE_SECRET = "s3cret";
    const platformSettings = { get: async (k: string) => settings[k], publicValues: async () => ({}), list: async () => [], update: async () => ({ before: {}, after: {} }) };
    content = new ContentService(prisma as never, platformSettings as never);
    setContactMailer({ send: async (m: any) => (sent.push(m), { id: "x" }) } as never);
    f = Fastify({ trustProxy: true });
    await f.register(rateLimit, { global: false });
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", platformSettings);
    f.decorate("platformContent", content);
    f.decorate("requireAbility", () => async (r: any) => void (r.admin = { id: adminId, email: "a@x", isSuperAdmin: true }));
    f.setErrorHandler(errorHandler);
    await f.register(publicRoutes, { prefix: "/api/v1/public" });
    await f.register(publicContactRoutes, { prefix: "/api/v1/public" });
    await f.register(adminContentRoutes, { prefix: "/api/v1/admin/content" });
    await f.register(adminContactRoutes, { prefix: "/api/v1/admin/contact-messages" });
    await f.ready();
  });

  afterAll(async () => {
    setContactMailer(null);
    delete process.env.WEB_REVALIDATE_URL;
    delete process.env.WEB_REVALIDATE_SECRET;
    await f?.close();
    await new Promise<void>((r) => hook.close(() => r()));
    await prisma.contentEntry.deleteMany({ where: { slug: { in: ["footer", "about", `${tag}-a`, `${tag}-b`] } } });
    await prisma.contactMessage.deleteMany({ where: { email: { endsWith: "@cms.test" } } });
    await prisma.$disconnect();
  });

  const call = (method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) =>
    f.inject({ method, url: `/api/v1${path}`, payload: payload as never, headers }).then((r: any) => ({ status: r.statusCode as number, body: r.json() }));
  const data = async (method: string, path: string, payload?: unknown) => {
    const r = await call(method, path, payload);
    if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data;
  };
  const menu = async () => (await data("GET", "/public/bootstrap")).footerMenu;
  const waitForHit = async (n: number) => {
    for (let i = 0; i < 50 && hits.length < n; i++) await new Promise((r) => setTimeout(r, 20));
  };

  it("serves the built-in footer until one is published, settings links included", async () => {
    const m = await menu();
    expect(m.custom).toBe(false);
    expect(m.columns.map((c: any) => c.title)).toEqual(["Product", "Company", "Legal"]);
    expect(m.columns[1].links).toContainEqual({ label: "Status", href: "https://status.example.com", external: true });
    expect(m.columns[2].links.map((l: any) => l.href)).toEqual(expect.arrayContaining(["/terms", "/privacy"]));
    // The old field stays for websites deployed before the footer menu.
    expect(Array.isArray((await data("GET", "/public/bootstrap")).footer)).toBe(true);
  });

  it("a new footer entry starts as a copy of the built-in footer; published, it replaces it", async () => {
    expect((await call("POST", "/admin/content", { slug: "site-footer", kind: "footer", title: "Footer" })).status).toBe(400);
    const entry = await data("POST", "/admin/content", { slug: "footer", kind: "footer", title: "Footer" });
    expect(entry.data.columns.map((c: any) => c.title)).toEqual(["Product", "Company", "Legal"]);
    expect(entry.data.columns[2].links.find((l: any) => l.slug === "terms")).toMatchObject({ type: "page", label: "Terms of Service" });

    const about = await data("POST", "/admin/content", { slug: "about", kind: "page", title: "About us", data: { body: "# About" } });
    const columns = [
      { id: "c1", title: "Company", links: [{ id: "a", label: "About", type: "page", slug: "about" }, { id: "b", label: "Careers", type: "url", href: "https://jobs.example.com", newTab: true }, { id: "g", label: "Ghost", type: "page", slug: "no-such-page" }] },
      { id: "c2", title: "Legal", links: [{ id: "t", label: "Terms", type: "page", slug: "terms" }] },
    ];
    await data("PUT", `/admin/content/${entry.id}`, { data: { columns } });
    const before = hits.length;
    await data("POST", `/admin/content/${entry.id}/publish`, {});
    await waitForHit(before + 1);
    expect(hits.at(-1)).toMatchObject({ secret: "s3cret", body: JSON.stringify({ tags: ["cms"] }) });

    // "about" is still a draft and "no-such-page" doesn't exist: both left out.
    let m = await menu();
    expect(m.custom).toBe(true);
    expect(m.columns).toEqual([
      { title: "Company", links: [{ label: "Careers", href: "https://jobs.example.com", external: true }] },
      { title: "Legal", links: [{ label: "Terms", href: "/terms", external: false }] },
    ]);
    await data("POST", `/admin/content/${about.id}/publish`, {});
    m = await menu();
    expect(m.columns[0].links[0]).toEqual({ label: "About", href: "/about", external: false });
    // Unpublishing the page takes its link out again, at once.
    await data("POST", `/admin/content/${about.id}/unpublish`, {});
    expect((await menu()).columns[0].links.map((l: any) => l.label)).toEqual(["Careers"]);
  });

  it("refuses page slugs that are the website's own routes", async () => {
    for (const slug of ["login", "dashboard/settings", "pricing", "p/about"]) {
      const r = await call("POST", "/admin/content", { slug, kind: "page", title: "x" });
      expect(r.status, slug).toBe(400);
      expect(r.body.message).toMatch(/website's own addresses/);
    }
    expect((await call("POST", "/admin/content", { slug: `${tag}-a`, kind: "page", title: "Fine" })).status).toBe(201);
    expect((await call("POST", "/admin/content", { slug: "footer", kind: "page", title: "x" })).status).toBeGreaterThanOrEqual(400);
  });

  it("the contact form stores the message, emails support, and the inbox manages it", async () => {
    sent.length = 0;
    const r = await call("POST", "/public/contact", { name: "Ada", email: "ada@cms.test", subject: "Hello <b>", message: "I would like to know more <script>x</script>.", page: "contact" }, { "x-forwarded-for": "198.51.100.7" });
    expect(r.status).toBe(202);
    const row = await prisma.contactMessage.findUnique({ where: { id: r.body.data.id } });
    expect(row).toMatchObject({ name: "Ada", email: "ada@cms.test", page: "contact", status: "NEW" });
    await new Promise((res) => setTimeout(res, 20));
    expect(sent[0]).toMatchObject({ to: "help@example.com", replyTo: "ada@cms.test" });
    expect(sent[0].html).not.toMatch(/<script>|<b>/);
    expect(sent[0].html).toMatch(/&lt;script&gt;/);

    const list = await call("GET", "/admin/contact-messages?search=ada%40cms.test");
    expect(list.body.items.map((m: any) => m.id)).toContain(row!.id);
    expect(list.body.extra.unread).toBeGreaterThanOrEqual(1);
    expect((await data("PATCH", `/admin/contact-messages/${row!.id}`, { status: "ARCHIVED" })).status).toBe("ARCHIVED");
    expect((await call("GET", "/admin/contact-messages?search=ada%40cms.test")).body.items).toHaveLength(0); // archived are hidden by default
    expect((await call("GET", "/admin/contact-messages?status=ARCHIVED&search=ada%40cms.test")).body.items).toHaveLength(1);
    expect((await call("DELETE", `/admin/contact-messages/${row!.id}`)).status).toBe(200);
    expect((await call("GET", `/admin/contact-messages/${row!.id}`)).status).toBe(404);
  });

  it("drops bot submissions quietly, validates, rate limits and can be switched off", async () => {
    const ip = { "x-forwarded-for": "198.51.100.8" };
    const bot = await call("POST", "/public/contact", { name: "Bot", email: "bot@cms.test", message: "Buy things now please", website: "http://spam" }, ip);
    expect(bot.status).toBe(202);
    expect(await prisma.contactMessage.count({ where: { email: "bot@cms.test" } })).toBe(0);
    const bad = await call("POST", "/public/contact", { name: "", email: "nope", message: "short" }, ip);
    expect(bad.status).toBe(400);
    expect(bad.body.errors.map((e: any) => e.path[0]).sort()).toEqual(["email", "message", "name"]);

    settings["support.contactForm"] = false;
    expect((await call("POST", "/public/contact", { name: "Off", email: "off@cms.test", message: "Is anyone there at all?" }, { "x-forwarded-for": "198.51.100.9" })).status).toBe(503);
    settings["support.contactForm"] = true;

    const flood = { "x-forwarded-for": "198.51.100.10" };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await call("POST", "/public/contact", { name: "Flood", email: "flood@cms.test", message: `Message number ${i} here` }, flood)).status);
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses[5]).toBe(429);
  });
});
