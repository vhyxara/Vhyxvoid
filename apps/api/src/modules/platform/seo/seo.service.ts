// SEO: what the website says about each address, the redirects it answers,
// and the audit that finds what to fix. Rules shared with the website
// (paths, redirect matching, title template) live in @vhyxvoid/content.
import { normalizeSitePath, pagePath, resolveRedirect, SEO_LIMITS, SITE_ROUTES, type RedirectRule } from "@vhyxvoid/content";

import { ValidationError } from "@/core/errors/error.format";
import type { PrismaClient } from "@/generated/prisma";
import { excerptOf, visibleWhere } from "../blog/blog.service";

type Settings = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

// ── Addresses ──

/** A site path for an override or a redirect source, or a 400 that says why not. */
export function sitePathOr400(input: string, what = "Address", wildcard = false): string {
  const p = normalizeSitePath(input);
  if (!p) throw new ValidationError(`${what}: use a path on the site starting with /, e.g. /old-page`);
  if (p.includes("*") && !(wildcard && p.endsWith("/*") && p.indexOf("*") === p.length - 1)) {
    throw new ValidationError(wildcard ? `${what}: * only works at the end, as /section/*` : `${what}: no * here`);
  }
  if (/^\/(api|_next|_vercel)(\/|$)/.test(p)) throw new ValidationError(`${what}: ${p} belongs to the website itself`);
  return p;
}

/** A redirect target: a site path or an absolute http(s) URL. */
export function redirectTargetOr400(input: string, fromWildcard: boolean): string {
  const v = input.trim();
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      if (!u.hostname || /[\s<>"']/.test(v)) throw new Error();
      return u.toString();
    } catch {
      throw new ValidationError("Target: not a valid URL");
    }
  }
  const p = normalizeSitePath(v);
  if (!p) throw new ValidationError("Target: a path on the site (/new-page) or a full https:// URL");
  if (p.endsWith("/*") && !fromWildcard) throw new ValidationError("Target: /* only works when the old address ends in /* too");
  if (p.includes("*") && !p.endsWith("/*")) throw new ValidationError("Target: * only works at the end");
  return p;
}

/**
 * Refuses a rule that would send a visitor in a circle, following the
 * redirects from the new rule's source (a sample path under it for /*)
 * the way the website does, up to 10 hops.
 */
export function assertNoLoop(rules: RedirectRule[], rule: RedirectRule): void {
  const all = [...rules.filter((r) => r.from !== rule.from), rule];
  let path = rule.from.endsWith("/*") ? `${rule.from.slice(0, -2)}/sample` : rule.from;
  const seen = new Set<string>([path]);
  for (let i = 0; i < 10; i++) {
    const hit = resolveRedirect(all, path);
    if (!hit || /^https?:/i.test(hit.to)) return;
    path = normalizeSitePath(hit.to) ?? hit.to;
    if (seen.has(path)) throw new ValidationError(`That would make a loop: ${[...seen, path].join(" → ")}`);
    seen.add(path);
  }
  throw new ValidationError("That would make a chain of more than 10 redirects");
}

// ── What each address says ──

export type PageKind = "route" | "page" | "post" | "category";
export type Issue = { level: "error" | "warning" | "info"; code: string; message: string; path?: string; fix?: string };

export type SeoRow = {
  path: string;
  kind: PageKind;
  label: string;
  /** Where to change it in the admin panel, besides the override. */
  editHref: string | null;
  live: boolean;
  own: { title: string; description: string; image: string };
  override: { id: string; title: string | null; description: string | null; imageUrl: string | null; noindex: boolean; updatedAt: Date } | null;
  effective: { title: string; description: string; image: string; noindex: boolean; titleFrom: "override" | "page" | "default"; descriptionFrom: "override" | "page" | "default" };
  issues: Issue[];
};

/** Every public address the website has, with what it says now and what to fix. */
export async function seoRows(prisma: PrismaClient, settings: Settings): Promise<SeoRow[]> {
  const product = str(settings["general.productName"]) || "VhyxVoid";
  const [overrides, entries, posts, categories] = await Promise.all([
    prisma.seoPage.findMany(),
    prisma.contentEntry.findMany({ where: { kind: { in: ["page", "landing", "pricing"] } }, select: { id: true, slug: true, kind: true, title: true, status: true, seoTitle: true, seoDescription: true } }),
    prisma.blogPost.findMany({ where: visibleWhere(), orderBy: { publishedAt: "desc" }, take: 2000, select: { id: true, slug: true, title: true, excerpt: true, body: true, seoTitle: true, seoDescription: true, coverImageUrl: true, coverImageAlt: true } }),
    prisma.blogCategory.findMany({ where: { posts: { some: visibleWhere() } }, select: { slug: true, name: true, description: true } }),
  ]);
  const byPath = new Map(overrides.map((o) => [o.path, o]));
  const entryBySlug = new Map(entries.map((e) => [e.slug, e]));
  const rows: SeoRow[] = [];
  const add = (r: Omit<SeoRow, "override" | "effective" | "issues">, extraIssues: Issue[] = []) => {
    const o = byPath.get(r.path) ?? null;
    const title = o?.title || r.own.title;
    const description = o?.description || r.own.description;
    rows.push({
      ...r,
      override: o && { id: o.id, title: o.title, description: o.description, imageUrl: o.imageUrl, noindex: o.noindex, updatedAt: o.updatedAt },
      effective: {
        title: title || product,
        description: description || str(settings["seo.defaultDescription"]),
        image: o?.imageUrl || r.own.image,
        noindex: !!o?.noindex,
        titleFrom: o?.title ? "override" : r.own.title ? "page" : "default",
        descriptionFrom: o?.description ? "override" : r.own.description ? "page" : "default",
      },
      issues: extraIssues,
    });
  };

  for (const route of SITE_ROUTES) {
    const entry = route.content ? entryBySlug.get(route.content) : undefined;
    const fromContent = entry && entry.status === "PUBLISHED";
    add({
      path: route.path,
      kind: "route",
      label: route.label,
      editHref: entry ? `/content/${entry.id}` : route.content ? "/content" : null,
      live: true,
      own: {
        title: (fromContent && entry.seoTitle) || route.title || (route.path === "/" ? `${product} — ${str(settings["general.tagline"])}`.replace(/ — $/, "") : ""),
        description: (fromContent && entry.seoDescription) || route.description,
        image: "",
      },
    });
  }
  for (const e of entries.filter((x) => x.kind === "page")) {
    add({ path: pagePath(e.slug), kind: "page", label: e.title, editHref: `/content/${e.id}`, live: e.status === "PUBLISHED", own: { title: e.seoTitle || e.title, description: e.seoDescription || "", image: "" } });
  }
  for (const p of posts) {
    const issues: Issue[] = [];
    if (p.coverImageUrl && !p.coverImageAlt.trim()) issues.push({ level: "warning", code: "image_alt", message: "The cover image has no description (alt text)." });
    add({ path: `/blog/${p.slug}`, kind: "post", label: p.title, editHref: `/blog/${p.id}`, live: true, own: { title: p.seoTitle || p.title, description: p.seoDescription || p.excerpt || excerptOf(p), image: p.coverImageUrl ?? "" } }, issues);
  }
  for (const c of categories) {
    add({ path: `/blog/category/${c.slug}`, kind: "category", label: `Category: ${c.name}`, editHref: "/blog/taxonomy", live: true, own: { title: c.name, description: c.description, image: "" } });
  }
  // Overrides for addresses not listed above (an old path, a docs page…) still show, so they can be removed.
  const known = new Set(rows.map((r) => r.path));
  for (const o of overrides.filter((x) => !known.has(x.path))) {
    add({ path: o.path, kind: "route", label: o.path, editHref: null, live: true, own: { title: "", description: "", image: "" } });
  }

  // Per-address checks, then duplicates across the indexable live ones.
  const generated = settings["seo.generatedImages"] !== false;
  const defaultImage = str(settings["seo.defaultImage"]);
  for (const r of rows) {
    if (!r.live) continue;
    const { title, description, noindex } = r.effective;
    if (noindex) {
      r.issues.push({ level: "info", code: "noindex", message: "Hidden from search engines (noindex)." });
      continue;
    }
    if (r.effective.descriptionFrom === "default") r.issues.push({ level: "warning", code: "description_missing", message: description ? "No description of its own: the site default is used." : "No description: search engines pick some text from the page." });
    else if (description.length > SEO_LIMITS.description) r.issues.push({ level: "info", code: "description_long", message: `Description is ${description.length} characters; about ${SEO_LIMITS.description} show.` });
    else if (description.length < SEO_LIMITS.descriptionMin) r.issues.push({ level: "info", code: "description_short", message: `Description is only ${description.length} characters; ${SEO_LIMITS.descriptionMin}–${SEO_LIMITS.description} works best.` });
    if (title.length > SEO_LIMITS.title) r.issues.push({ level: "info", code: "title_long", message: `Title is ${title.length} characters; about ${SEO_LIMITS.title} show.` });
    if (r.kind === "post" && !r.effective.image && !defaultImage && !generated) r.issues.push({ level: "info", code: "image_missing", message: "No share image: link previews show none." });
  }
  const indexable = rows.filter((r) => r.live && !r.effective.noindex && !["/login", "/register"].includes(r.path));
  for (const [field, code, label] of [["title", "title_duplicate", "title"], ["description", "description_duplicate", "description"]] as const) {
    const groups = new Map<string, SeoRow[]>();
    for (const r of indexable) {
      const v = r.effective[field].trim().toLowerCase();
      if (v && !(field === "description" && r.effective.descriptionFrom === "default")) groups.set(v, [...(groups.get(v) ?? []), r]);
    }
    for (const same of groups.values()) {
      if (same.length < 2) continue;
      for (const r of same) r.issues.push({ level: field === "title" ? "warning" : "info", code, message: `Same ${label} as ${same.filter((x) => x !== r).map((x) => x.path).slice(0, 3).join(", ")}.` });
    }
  }
  return rows;
}

// ── The audit ──

export async function seoAudit(prisma: PrismaClient, settings: Settings) {
  const rows = await seoRows(prisma, settings);
  const [redirects, notFound] = await Promise.all([
    prisma.seoRedirect.findMany({ select: { id: true, fromPath: true, toUrl: true, permanent: true } }),
    prisma.seoNotFound.findMany({ where: { hits: { gte: 3 } }, orderBy: { hits: "desc" }, take: 20 }),
  ]);
  const site: Issue[] = [];
  if (settings["seo.indexing"] === false) site.push({ level: "error", code: "indexing_off", message: "Search engines are told to stay out of the whole site.", fix: "defaults" });
  if (!str(settings["seo.siteUrl"]) && !process.env.SITE_URL) site.push({ level: "warning", code: "site_url", message: "No site address set: canonical links and the sitemap use whatever address each request came in on.", fix: "defaults" });
  if (!str(settings["seo.defaultDescription"])) site.push({ level: "warning", code: "default_description", message: "No default description for pages without their own.", fix: "defaults" });
  if (!str(settings["seo.defaultImage"]) && settings["seo.generatedImages"] === false) site.push({ level: "warning", code: "default_image", message: "No share image: link previews of most pages show none.", fix: "defaults" });
  if (!str(settings["seo.googleVerification"]) && !str(settings["seo.bingVerification"])) site.push({ level: "info", code: "verification", message: "Not verified with Google Search Console or Bing Webmaster Tools, where you see how the site does in search.", fix: "defaults" });
  if (!str(settings["seo.organizationLogo"])) site.push({ level: "info", code: "logo", message: "No organization logo for search engines' knowledge panel.", fix: "defaults" });

  // Redirects: chains, and rules that hide a live address.
  const rules = redirects.map((r) => ({ from: r.fromPath, to: r.toUrl, permanent: r.permanent }));
  const livePaths = new Set(rows.filter((r) => r.live && r.kind !== "route").map((r) => r.path));
  for (const r of redirects) {
    if (!/^https?:/i.test(r.toUrl) && !r.toUrl.endsWith("/*")) {
      const next = resolveRedirect(rules, r.toUrl);
      if (next) site.push({ level: "warning", code: "redirect_chain", message: `${r.fromPath} → ${r.toUrl} → ${next.to}: point ${r.fromPath} straight at ${next.to}.`, path: r.fromPath, fix: "redirects" });
    }
    if (!r.fromPath.endsWith("/*") && livePaths.has(r.fromPath)) site.push({ level: "warning", code: "redirect_hides_page", message: `${r.fromPath} is a live page, but a redirect sends visitors away from it.`, path: r.fromPath, fix: "redirects" });
  }
  for (const n of notFound) {
    if (!resolveRedirect(rules, n.path)) site.push({ level: "warning", code: "not_found", message: `${n.path} was asked for ${n.hits} times and doesn't exist.`, path: n.path, fix: "not-found" });
  }

  const pageIssues = rows.flatMap((r) => r.issues.filter((i) => i.code !== "noindex").map((i) => ({ ...i, path: r.path, fix: "pages" })));
  const all = [...site, ...pageIssues];
  const count = (level: Issue["level"]) => all.filter((i) => i.level === level).length;
  const score = Math.max(0, 100 - 15 * count("error") - 4 * count("warning") - Math.min(10, count("info")));
  return {
    score,
    counts: { error: count("error"), warning: count("warning"), info: count("info") },
    issues: all,
    pages: { total: rows.length, live: rows.filter((r) => r.live).length, noindex: rows.filter((r) => r.effective.noindex).length, withOverride: rows.filter((r) => r.override).length },
    redirects: redirects.length,
  };
}
