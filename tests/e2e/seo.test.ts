// SEO: shared path/redirect rules, admin overrides, redirects (loops, bulk
// import), the missing-address log the website reports to, and the audit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { applyTitleTemplate, normalizeSitePath, profileUrls, resolveRedirect } from "../../packages/content/src/seo";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { adminSeoRoutes } from "../../apps/api/src/modules/platform/seo/seo.routes";
import { publicSeoRoutes } from "../../apps/api/src/modules/platform/seo/seo.public.routes";
import { publicRoutes } from "../../apps/api/src/modules/platform/public/public.routes";
import { adminBlogRoutes } from "../../apps/api/src/modules/platform/blog/blog.routes";

const require = createRequire(import.meta.url);
const Fastify = require("../../apps/api/node_modules/fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe("seo rules", () => {
  it("normalize site paths", () => {
    expect(normalizeSitePath("/About/")).toBe("/About");
    expect(normalizeSitePath("/a//b/?x=1#y")).toBe("/a/b");
    expect(normalizeSitePath("/")).toBe("/");
    expect(normalizeSitePath("https://x.test/a")).toBeNull();
    expect(normalizeSitePath("//evil.test")).toBeNull();
    expect(normalizeSitePath("/a/../b")).toBeNull();
    expect(normalizeSitePath("/a b")).toBeNull();
  });

  it("match redirects: exact first, then the longest /* rule, keeping the rest of the path", () => {
    const rules = [
      { from: "/docs/*", to: "/guides/*", permanent: true },
      { from: "/docs/old/*", to: "https://old.test/", permanent: false },
      { from: "/docs/intro", to: "/start", permanent: true },
    ];
    expect(resolveRedirect(rules, "/docs/intro")).toMatchObject({ to: "/start", from: "/docs/intro" });
    expect(resolveRedirect(rules, "/docs/a/b")).toMatchObject({ to: "/guides/a/b", permanent: true });
    expect(resolveRedirect(rules, "/docs")).toMatchObject({ to: "/guides" });
    expect(resolveRedirect(rules, "/docs/old/x")).toMatchObject({ to: "https://old.test/", permanent: false });
    expect(resolveRedirect(rules, "/docsx")).toBeNull();
  });

  it("build titles and profile lists", () => {
    expect(applyTitleTemplate("Pricing", "", "Acme")).toBe("Pricing — Acme");
    expect(applyTitleTemplate("Pricing", "%s | Acme tunnels", "Acme")).toBe("Pricing | Acme tunnels");
    expect(applyTitleTemplate("", "%s | X", "Acme")).toBe("Acme");
    expect(profileUrls("https://linkedin.com/a\nnot a url\nhttps://x.com/a", "https://x.com/a", "")).toEqual(["https://x.com/a", "https://linkedin.com/a"]);
  });
});

describe.skipIf(!url)("seo", { timeout: 30_000 }, () => {
  let prisma: PrismaClient;
  let f: any;
  const tag = `seo${Date.now() % 1e7}`;
  const settings: Record<string, unknown> = { "general.productName": "Acme", "seo.indexing": true };
  const posts: string[] = [];

  beforeAll(async () => {
    process.env.WEB_REVALIDATE_SECRET = "s3cret";
    prisma = new PrismaClient({ datasourceUrl: url });
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", { publicValues: async () => settings });
    f.decorate("requireAbility", () => async (r: any) => void (r.admin = { id: "00000000-0000-4000-8000-00000000000b", email: "seo@test", isSuperAdmin: true }));
    f.setErrorHandler(errorHandler);
    await f.register(adminSeoRoutes, { prefix: "/api/v1/admin/seo" });
    await f.register(publicSeoRoutes, { prefix: "/api/v1/public/seo" });
    await f.register(publicRoutes, { prefix: "/api/v1/public" });
    await f.register(adminBlogRoutes, { prefix: "/api/v1/admin/blog" });
    await f.ready();
  });

  afterAll(async () => {
    delete process.env.WEB_REVALIDATE_SECRET;
    await f?.close();
    await prisma.seoRedirect.deleteMany({ where: { fromPath: { startsWith: `/${tag}` } } });
    await prisma.seoPage.deleteMany({ where: { path: { contains: tag } } });
    await prisma.seoNotFound.deleteMany({ where: { path: { startsWith: `/${tag}` } } });
    await prisma.blogPost.deleteMany({ where: { id: { in: posts } } });
    await prisma.$disconnect();
  });

  const call = (method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) =>
    f.inject({ method, url: `/api/v1${path}`, payload: payload as never, headers }).then((r: any) => ({ status: r.statusCode as number, body: r.json() }));
  const data = async (method: string, path: string, payload?: unknown) => {
    const r = await call(method, path, payload);
    if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data ?? r.body;
  };
  const p = (s: string) => `/${tag}${s}`;

  it("adds redirects, refusing loops, the home page and malformed ones", async () => {
    const a = await data("POST", "/admin/seo/redirects", { from: `${p("/old")}/`, to: p("/new") });
    expect(a.fromPath).toBe(p("/old"));
    expect(a.permanent).toBe(true);
    expect((await call("POST", "/admin/seo/redirects", { from: p("/old"), to: p("/other") })).status).toBe(409);
    // new → old would send visitors round in a circle.
    const loop = await call("POST", "/admin/seo/redirects", { from: p("/new"), to: p("/old") });
    expect(loop.status).toBe(400);
    expect(loop.body.message).toMatch(/loop/);
    expect((await call("POST", "/admin/seo/redirects", { from: "/", to: "/x" })).status).toBe(400);
    expect((await call("POST", "/admin/seo/redirects", { from: p("/a"), to: "javascript:alert(1)" })).status).toBe(400);
    expect((await call("POST", "/admin/seo/redirects", { from: p("/a"), to: p("/b/*") })).status).toBe(400); // /* target needs a /* source
    expect((await call("POST", "/admin/seo/redirects", { from: "/api/x", to: "/y" })).status).toBe(400);
    const wild = await data("POST", "/admin/seo/redirects", { from: p("/docs/*"), to: "https://docs.example.test/", permanent: false });
    expect(wild.toUrl).toBe("https://docs.example.test/");
    const pub = await data("GET", "/public/seo");
    expect(pub.redirects).toEqual(expect.arrayContaining([{ from: p("/old"), to: p("/new"), permanent: true }, { from: p("/docs/*"), to: "https://docs.example.test/", permanent: false }]));
  });

  it("imports redirects line by line, replacing existing ones and reporting bad lines", async () => {
    const r = await data("POST", "/admin/seo/redirects/bulk", {
      lines: [`# moved in the redesign`, `${p("/old")} ${p("/newer")}`, `${p("/b1")}, ${p("/b2")}, 302`, `${p("/c1")}`, `${p("/b2")} ${p("/b1")}`, ""].join("\n"),
    });
    expect(r).toMatchObject({ created: 1, updated: 1 });
    expect(r.errors.map((e: any) => e.line)).toEqual([4, 5]); // missing target; a loop with b1 → b2
    const b1 = await prisma.seoRedirect.findUnique({ where: { fromPath: p("/b1") } });
    expect(b1).toMatchObject({ toUrl: p("/b2"), permanent: false });
    expect((await prisma.seoRedirect.findUnique({ where: { fromPath: p("/old") } }))?.toUrl).toBe(p("/newer"));
  });

  it("logs missing addresses only from the website, and a redirect clears its entry", async () => {
    const report = (path: string, secret = "s3cret") => call("POST", "/public/seo/not-found", { path, referrer: "https://ref.test/page" }, { "x-revalidate-secret": secret });
    expect((await report(p("/gone"), "wrong")).status).toBe(404);
    expect((await call("POST", "/public/seo/not-found", { path: p("/gone") })).status).toBe(404);
    await report(p("/gone/"));
    await report(p("/gone?utm=x"));
    await report(p("/gone"));
    await report("https://evil.test/");
    const row = await prisma.seoNotFound.findUnique({ where: { path: p("/gone") } });
    expect(row).toMatchObject({ hits: 3, referrer: "https://ref.test/page" });
    const list = await call("GET", `/admin/seo/not-found?search=${tag}`);
    expect(list.body.items.map((i: any) => i.path)).toContain(p("/gone"));

    settings["seo.indexing"] = true;
    const audit = await data("GET", "/admin/seo/audit");
    expect(audit.issues.some((i: any) => i.code === "not_found" && i.path === p("/gone"))).toBe(true);

    await data("POST", "/admin/seo/redirects", { from: p("/gone"), to: "/" });
    expect(await prisma.seoNotFound.findUnique({ where: { path: p("/gone") } })).toBeNull();

    await call("POST", "/public/seo/redirect-hit", { from: p("/gone") }, { "x-revalidate-secret": "s3cret" });
    expect((await prisma.seoRedirect.findUnique({ where: { fromPath: p("/gone") } }))?.hits).toBe(1);
  });

  it("overrides what an address says; noindex keeps it out of the sitemap; clearing it restores the page's own", async () => {
    const mk = async (title: string) => {
      const post = await data("POST", "/admin/blog/posts", { title, body: "Words for the body of the post." });
      posts.push(post.id);
      await data("POST", `/admin/blog/posts/${post.id}/publish`);
      return post;
    };
    const one = await mk(`${tag} Same title`);
    const two = await mk(`${tag} Same title`);
    let rows = (await data("GET", "/admin/seo/pages")).items;
    const row = (path: string) => rows.find((r: any) => r.path === path);
    expect(row(`/blog/${one.slug}`).effective).toMatchObject({ title: `${tag} Same title`, titleFrom: "page", descriptionFrom: "page" });
    expect(row(`/blog/${one.slug}`).issues.map((i: any) => i.code)).toContain("title_duplicate");
    expect(row("/pricing")).toMatchObject({ kind: "route", editHref: expect.stringMatching(/^\/content/) });

    await data("PUT", "/admin/seo/pages", { path: `/blog/${two.slug}/`, title: `${tag} A better title`, description: "", noindex: false });
    await data("PUT", "/admin/seo/pages", { path: `/blog/${one.slug}`, noindex: true });
    rows = (await data("GET", "/admin/seo/pages")).items;
    expect(row(`/blog/${two.slug}`).effective).toMatchObject({ title: `${tag} A better title`, titleFrom: "override" });
    expect(row(`/blog/${two.slug}`).issues.map((i: any) => i.code)).not.toContain("title_duplicate");
    expect(row(`/blog/${one.slug}`).effective.noindex).toBe(true);

    const pub = await data("GET", "/public/seo");
    expect(pub.pages.find((x: any) => x.path === `/blog/${two.slug}`)).toMatchObject({ title: `${tag} A better title`, description: null });
    const map = await data("GET", "/public/sitemap");
    expect(map.posts.map((x: any) => x.slug)).toContain(two.slug);
    expect(map.posts.map((x: any) => x.slug)).not.toContain(one.slug);

    // Nothing left to override: the row goes away.
    await data("PUT", "/admin/seo/pages", { path: `/blog/${one.slug}`, noindex: false });
    expect(await prisma.seoPage.findUnique({ where: { path: `/blog/${one.slug}` } })).toBeNull();
    expect((await call("PUT", "/admin/seo/pages", { path: "not a path" })).status).toBe(400);
    expect((await call("PUT", "/admin/seo/pages", { path: `/${tag}/x`, imageUrl: "javascript:x" })).status).toBe(400);
  });

  it("the audit scores the site and points at what to fix", async () => {
    settings["seo.indexing"] = false;
    const off = await data("GET", "/admin/seo/audit");
    expect(off.issues[0]).toMatchObject({ level: "error", code: "indexing_off" });
    settings["seo.indexing"] = true;
    settings["seo.siteUrl"] = "https://www.acme.test";
    settings["seo.defaultDescription"] = "Acme shares your localhost.";
    const on = await data("GET", "/admin/seo/audit");
    expect(on.score).toBeGreaterThan(off.score);
    expect(on.issues.some((i: any) => i.code === "site_url")).toBe(false);
    // b1 → b2 is fine, but /old → /newer and others are not chains; add one.
    await data("POST", "/admin/seo/redirects", { from: p("/c-a"), to: p("/b1") });
    const chained = await data("GET", "/admin/seo/audit");
    expect(chained.issues.some((i: any) => i.code === "redirect_chain" && i.path === p("/c-a"))).toBe(true);
  });
});
