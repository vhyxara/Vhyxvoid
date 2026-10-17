// The blog against a real database (opt-in: VHYXVOID_TEST_DATABASE_URL):
// categories and tags reused or created by name, slugs, drafts / scheduled /
// published, old slugs redirecting, related posts, taxonomy counts, merging
// and deleting tags and categories, and the website being told to refresh.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { adminBlogRoutes } from "../../apps/api/src/modules/platform/blog/blog.routes";
import { publicBlogRoutes } from "../../apps/api/src/modules/platform/blog/blog.public.routes";
import { publicRoutes } from "../../apps/api/src/modules/platform/public/public.routes";
import { excerptOf, readingMinutes, slugify } from "../../apps/api/src/modules/platform/blog/blog.service";

const req = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const Fastify = req("fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe("blog text helpers", () => {
  it("make slugs, reading times and excerpts", () => {
    expect(slugify("Release Notes: Q3!")).toBe("release-notes-q3");
    expect(slugify("Café & Crème")).toBe("cafe-creme");
    expect(slugify("!!!")).toBe("");
    expect(readingMinutes("word ".repeat(1000))).toBe(5);
    expect(readingMinutes("")).toBe(1);
    expect(excerptOf({ excerpt: "", body: "# Title\n\nSome **bold** text with a [link](/x)." })).toBe("Title Some bold text with a link.");
    expect(excerptOf({ excerpt: "", body: "word ".repeat(100) }).endsWith("…")).toBe(true);
    expect(excerptOf({ excerpt: " Mine ", body: "x" })).toBe("Mine");
  });
});

describe.skipIf(!url)("blog", { timeout: 30_000 }, () => {
  let prisma: PrismaClient;
  let f: any;
  let hook: http.Server;
  const hits: string[] = [];
  const tag = `bt${Date.now() % 1e7}`;
  const created: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    hook = http.createServer((r, res) => (hits.push(r.url ?? ""), res.end("ok")));
    await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
    process.env.WEB_REVALIDATE_URL = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/api/revalidate`;
    process.env.WEB_REVALIDATE_SECRET = "s";
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("requireAbility", () => async (r: any) => void (r.admin = { id: "00000000-0000-4000-8000-00000000000a", email: "writer@blog.test", isSuperAdmin: true }));
    f.setErrorHandler(errorHandler);
    await f.register(adminBlogRoutes, { prefix: "/api/v1/admin/blog" });
    await f.register(publicBlogRoutes, { prefix: "/api/v1/public/blog" });
    await f.register(publicRoutes, { prefix: "/api/v1/public" });
    await f.ready();
  });

  afterAll(async () => {
    delete process.env.WEB_REVALIDATE_URL;
    delete process.env.WEB_REVALIDATE_SECRET;
    await f?.close();
    await new Promise<void>((r) => hook.close(() => r()));
    await prisma.blogPost.deleteMany({ where: { id: { in: created } } });
    await prisma.blogCategory.deleteMany({ where: { slug: { startsWith: tag } } });
    await prisma.blogTag.deleteMany({ where: { slug: { startsWith: tag } } });
    await prisma.blogAuthor.deleteMany({ where: { slug: { startsWith: tag } } });
    await prisma.$disconnect();
  });

  const call = (method: string, path: string, payload?: unknown) => f.inject({ method, url: `/api/v1${path}`, payload: payload as never }).then((r: any) => ({ status: r.statusCode as number, body: r.json() }));
  const data = async (method: string, path: string, payload?: unknown) => {
    const r = await call(method, path, payload);
    if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data ?? r.body;
  };
  const post = async (b: Record<string, unknown>) => {
    const p = await data("POST", "/admin/blog/posts", { body: "Some words for the post body.", ...b });
    created.push(p.id);
    return p;
  };
  const cat = (n: string) => `${tag} ${n}`;

  it("reuses categories and tags by name and creates the missing ones", async () => {
    const a = await post({ title: `${tag} Shipping faster`, category: cat("Engineering"), tags: [`${tag} Releases`, `${tag} Performance`] });
    expect(a.category.name).toBe(cat("Engineering"));
    expect(a.tags.map((t: any) => t.slug)).toEqual([`${tag}-releases`, `${tag}-performance`]);
    // Different case and spacing: the same category and tag.
    const b = await post({ title: `${tag} Another`, category: cat("ENGINEERING "), tags: [`${tag}  releases`, `${tag} Security`, `${tag} security`] });
    expect(b.category.id).toBe(a.category.id);
    expect(b.tags.map((t: any) => t.slug)).toEqual([`${tag}-releases`, `${tag}-security`]);
    expect(await prisma.blogCategory.count({ where: { slug: { startsWith: tag } } })).toBe(1);
    expect(await prisma.blogTag.count({ where: { slug: { startsWith: tag } } })).toBe(3);
    // Five posts at once naming the same new tag: one tag.
    await Promise.all(Array.from({ length: 5 }, (_, i) => post({ title: `${tag} parallel ${i}`, tags: [`${tag} Brand new`] })));
    expect(await prisma.blogTag.count({ where: { slug: `${tag}-brand-new` } })).toBe(1);
    const tags = await data("GET", "/admin/blog/tags");
    expect(tags.find((t: any) => t.slug === `${tag}-brand-new`).postCount).toBe(5);
  });

  it("makes slugs unique from titles, but refuses a typed slug that is taken", async () => {
    const one = await post({ title: `${tag} Same title` });
    const two = await post({ title: `${tag} Same title` });
    expect([one.slug, two.slug]).toEqual([`${tag}-same-title`, `${tag}-same-title-2`]);
    expect((await call("POST", "/admin/blog/posts", { title: "x", slug: one.slug })).status).toBe(409);
    expect((await call("PUT", `/admin/blog/posts/${two.id}`, { slug: one.slug })).status).toBe(409);
    expect((await call("POST", "/admin/blog/posts", { title: "x", coverImageUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await call("POST", "/admin/blog/posts", { title: "x", slug: "Not A Slug" })).status).toBe(400);
  });

  it("drafts are hidden; scheduled posts appear when their time comes; published ones list newest first", async () => {
    const draft = await post({ title: `${tag} Draft`, category: cat("Product") });
    const later = await post({ title: `${tag} Later`, category: cat("Product") });
    const now = await post({ title: `${tag} Now`, category: cat("Product"), featured: true });
    expect((await call("POST", `/admin/blog/posts/${(await post({ title: `${tag} Empty`, body: "" })).id}/publish`, {})).status).toBe(400);
    const before = hits.length;
    const sched = await data("POST", `/admin/blog/posts/${later.id}/publish`, { publishAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(sched.state).toBe("SCHEDULED");
    const pub = await data("POST", `/admin/blog/posts/${now.id}/publish`, {});
    expect(pub.state).toBe("PUBLISHED");
    for (let i = 0; i < 50 && hits.length < before + 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(hits.length).toBeGreaterThanOrEqual(before + 2);

    const list = await data("GET", `/public/blog/posts?category=${slugify(cat("Product"))}`);
    expect(list.items.map((p: any) => p.title)).toEqual([`${tag} Now`]);
    expect(list.category.name).toBe(cat("Product"));
    expect(list.items[0]).not.toHaveProperty("body");
    expect(list.items[0].excerpt).toBe("Some words for the post body.");
    expect((await call("GET", `/public/blog/posts/${draft.slug}`)).status).toBe(404);
    expect((await call("GET", `/public/blog/posts/${later.slug}`)).status).toBe(404);
    expect((await data("GET", "/admin/blog/posts?status=SCHEDULED&search=" + tag)).items.map((p: any) => p.title)).toEqual([`${tag} Later`]);
    // The scheduled time passes: it shows.
    await prisma.blogPost.update({ where: { id: later.id }, data: { publishedAt: new Date(Date.now() - 1000) } });
    // Newest first: "Now" was published after "Later"'s (moved-back) time.
    expect((await data("GET", `/public/blog/posts?category=${slugify(cat("Product"))}`)).items.map((p: any) => p.title)).toEqual([`${tag} Now`, `${tag} Later`]);
    // The featured post leads page 1 of the unfiltered list.
    expect((await data("GET", "/public/blog/posts")).featured?.title).toBeTruthy();
    expect((await call("GET", "/public/blog/posts?category=no-such-category")).status).toBe(404);
  });

  it("a renamed published post keeps its old address as a redirect; related posts share a category or tag", async () => {
    const a = await post({ title: `${tag} Original name`, category: cat("Guides"), tags: [`${tag} Howto`] });
    const b = await post({ title: `${tag} Related by tag`, tags: [`${tag} Howto`] });
    const c = await post({ title: `${tag} Unrelated` });
    for (const p of [a, b, c]) await data("POST", `/admin/blog/posts/${p.id}/publish`, {});
    const renamed = await data("PUT", `/admin/blog/posts/${a.id}`, { slug: `${tag}-new-name` });
    expect(renamed.previousSlugs).toContain(`${tag}-original-name`);
    expect(await data("GET", `/public/blog/posts/${tag}-original-name`)).toEqual({ redirect: `${tag}-new-name` });
    const full = await data("GET", `/public/blog/posts/${tag}-new-name`);
    expect(full.post.body).toBe("Some words for the post body.");
    expect(full.related.map((p: any) => p.title)).toEqual([`${tag} Related by tag`]);
    // A new post may take the old slug; the redirect then stops.
    const taker = await post({ title: "x", slug: `${tag}-original-name` });
    expect((await prisma.blogPost.findUnique({ where: { id: a.id } }))!.previousSlugs).not.toContain(`${tag}-original-name`);
    expect(taker.slug).toBe(`${tag}-original-name`);
  });

  it("a save changes only the fields it sends", async () => {
    const p = await post({ title: `${tag} Keep me`, excerpt: "Short", category: cat("Keep"), tags: [`${tag} Keep`], featured: true, coverImageUrl: "https://example.com/c.png", coverImageAlt: "Cover" });
    const after = await data("PUT", `/admin/blog/posts/${p.id}`, { title: `${tag} Kept` });
    expect(after).toMatchObject({ title: `${tag} Kept`, excerpt: "Short", body: "Some words for the post body.", featured: true, coverImageUrl: "https://example.com/c.png", coverImageAlt: "Cover" });
    expect(after.category.name).toBe(cat("Keep"));
    expect(after.tags.map((t: any) => t.slug)).toEqual([`${tag}-keep`]);
    // Clearing is explicit.
    const cleared = await data("PUT", `/admin/blog/posts/${p.id}`, { category: null, tags: [], coverImageUrl: null });
    expect([cleared.category, cleared.tags, cleared.coverImageUrl]).toEqual([null, [], null]);
  });

  it("saves over a newer save are refused; unpublishing hides the post", async () => {
    const p = await post({ title: `${tag} Racy` });
    await data("PUT", `/admin/blog/posts/${p.id}`, { title: `${tag} Racy 2`, expectedUpdatedAt: p.updatedAt });
    expect((await call("PUT", `/admin/blog/posts/${p.id}`, { title: `${tag} Racy 3`, expectedUpdatedAt: p.updatedAt })).status).toBe(409);
    await data("POST", `/admin/blog/posts/${p.id}/publish`, {});
    expect((await call("GET", `/public/blog/posts/${p.slug}`)).status).toBe(200);
    const back = await data("POST", `/admin/blog/posts/${p.id}/unpublish`, {});
    expect(back.state).toBe("DRAFT");
    expect((await call("GET", `/public/blog/posts/${p.slug}`)).status).toBe(404);
  });

  it("taxonomy counts visible posts only; tags merge; deleting a category leaves its posts uncategorized", async () => {
    const tax = await data("GET", "/public/blog/taxonomy");
    const guides = tax.categories.find((c: any) => c.slug === slugify(cat("Guides")));
    expect(guides.count).toBe(1);
    expect(tax.tags.find((t: any) => t.slug === `${tag}-brand-new`)).toBeUndefined(); // only drafts use it

    const tags = await data("GET", "/admin/blog/tags");
    const from = tags.find((t: any) => t.slug === `${tag}-performance`);
    const into = tags.find((t: any) => t.slug === `${tag}-releases`);
    const merged = await data("POST", `/admin/blog/tags/${from.id}/merge`, { into: into.id });
    expect(merged.posts).toBe(1);
    expect(await prisma.blogTag.findUnique({ where: { id: from.id } })).toBeNull();
    expect((await data("GET", "/admin/blog/tags")).find((t: any) => t.id === into.id).postCount).toBe(2); // the merged post already had it

    const cats = await data("GET", "/admin/blog/categories");
    const eng = cats.find((c: any) => c.slug === slugify(cat("Engineering")));
    const del = await call("DELETE", `/admin/blog/categories/${eng.id}`);
    expect(del.status).toBe(200);
    expect(del.body.message).toMatch(/2 post\(s\) now have no category/);
    expect(await prisma.blogPost.count({ where: { id: { in: created }, categoryId: eng.id } })).toBe(0);
    expect((await call("PATCH", `/admin/blog/categories/${cats.find((c: any) => c.slug === slugify(cat("Guides"))).id}`, { slug: slugify(cat("Product")) })).status).toBe(409);
  });

  it("the sitemap lists visible posts and their categories, not drafts", async () => {
    const live = await post({ title: `${tag} Sitemap live`, category: cat("Mapped") });
    await data("POST", `/admin/blog/posts/${live.id}/publish`);
    const draft = await post({ title: `${tag} Sitemap draft`, category: cat("Unmapped") });
    const map = await data("GET", "/public/sitemap");
    expect(map.posts.map((p: any) => p.slug)).toContain(live.slug);
    expect(map.posts.map((p: any) => p.slug)).not.toContain(draft.slug);
    expect(map.categories).toContain(slugify(cat("Mapped")));
    expect(map.categories).not.toContain(slugify(cat("Unmapped")));
    expect(Array.isArray(map.pages)).toBe(true);
  });

  it("authors: profiles sign posts, renames reach their posts, /posts?author= lists theirs, deleting keeps the name", async () => {
    const bad = await call("POST", "/admin/blog/authors", { name: "X", avatarUrl: "javascript:alert(1)" });
    expect(bad.status).toBe(400);
    const ada = await data("POST", "/admin/blog/authors", { name: `${tag} Ada`, title: "Engineer", bio: "Writes about tunnels.", twitter: "https://x.com/ada_dev", github: "@ada" });
    expect(ada).toMatchObject({ slug: `${tag}-ada`, twitter: "ada_dev", github: "ada", postCount: 0 });
    expect((await call("POST", "/admin/blog/authors", { name: "Dup", slug: ada.slug })).status).toBe(409);

    const p = await post({ title: `${tag} By Ada`, authorId: ada.id });
    expect(p).toMatchObject({ authorId: ada.id, authorName: `${tag} Ada` });
    expect((await call("POST", "/admin/blog/posts", { title: "x", authorId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
    await data("POST", `/admin/blog/posts/${p.id}/publish`);

    await data("PATCH", `/admin/blog/authors/${ada.id}`, { name: `${tag} Ada L` });
    const again = await data("PATCH", `/admin/blog/authors/${ada.id}`, { bio: "Still writes." });
    expect(again).toMatchObject({ name: `${tag} Ada L`, title: "Engineer", bio: "Still writes." });

    const pub = await data("GET", `/public/blog/posts/${p.slug}`);
    expect(pub.post.authorName).toBe(`${tag} Ada L`);
    expect(pub.post.author).toEqual({ slug: ada.slug, name: `${tag} Ada L`, title: "Engineer", bio: "Still writes.", avatarUrl: "", website: "", twitter: "ada_dev", github: "ada", linkedin: "" });
    const list = await data("GET", `/public/blog/posts?author=${ada.slug}`);
    expect(list.author.name).toBe(`${tag} Ada L`);
    expect(list.items.map((x: any) => x.slug)).toEqual([p.slug]);
    expect((await call("GET", `/public/blog/posts?author=${tag}-nobody`)).status).toBe(404);
    expect((await data("GET", "/public/sitemap")).authors).toContain(ada.slug);

    // Back to the name only.
    const unsigned = await data("PUT", `/admin/blog/posts/${p.id}`, { authorId: null });
    expect(unsigned).toMatchObject({ authorId: null, authorName: `${tag} Ada L` });
    await data("PUT", `/admin/blog/posts/${p.id}`, { authorId: ada.id });
    await data("DELETE", `/admin/blog/authors/${ada.id}`);
    expect(await prisma.blogPost.findUnique({ where: { id: p.id }, select: { authorId: true, authorName: true } })).toEqual({ authorId: null, authorName: `${tag} Ada L` });
  });
});
