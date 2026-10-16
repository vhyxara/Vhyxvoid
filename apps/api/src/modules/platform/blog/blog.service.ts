// The blog: posts, categories and tags, edited in the admin panel and read by
// the website. Rules shared by the admin and public routes live here.
//
// - Categories and tags are found by slug or created when a post names one
//   ("Release notes" → release-notes); a second post naming it reuses it.
// - A post is visible when PUBLISHED and publishedAt has passed; a future
//   publishedAt is a scheduled post (it appears within a minute of the time,
//   the website's cache).
// - Changing a post's slug keeps the old one in previousSlugs, so old links
//   redirect.
import type { Prisma, PrismaClient } from "@/generated/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { notifyWebsite } from "../content/revalidate";

type Db = PrismaClient | Prisma.TransactionClient;

/** "Release Notes: Q3!" → "release-notes-q3". Empty for names with no letters or digits. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Words / 200, at least 1 minute. Markdown syntax is not counted as words. */
export function readingMinutes(markdown: string): number {
  const words = plainText(markdown).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Markdown to plain text, for excerpts and word counts. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The post's own excerpt, or the start of its text cut at a word. */
export function excerptOf(post: { excerpt: string; body: string }, max = 180): string {
  if (post.excerpt.trim()) return post.excerpt.trim();
  const text = plainText(post.body);
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** Visible on the website now. */
export const visibleWhere = (now = new Date()): Prisma.BlogPostWhereInput => ({ status: "PUBLISHED", publishedAt: { lte: now } });

export type PostState = "DRAFT" | "SCHEDULED" | "PUBLISHED";
export function postState(p: { status: string; publishedAt: Date | null }, now = new Date()): PostState {
  if (p.status !== "PUBLISHED") return "DRAFT";
  return p.publishedAt && p.publishedAt > now ? "SCHEDULED" : "PUBLISHED";
}

/** Find a category by name (as a slug) or create it; null for no category. */
export async function categoryFor(db: Db, name: string | null | undefined): Promise<string | null> {
  if (!name || !name.trim()) return null;
  const slug = slugify(name);
  if (!slug) throw new ValidationError(`"${name}" can't be a category: use letters or digits`);
  const row = await db.blogCategory.upsert({ where: { slug }, create: { slug, name: name.trim() }, update: {}, select: { id: true } });
  return row.id;
}

/** Find tags by name (as slugs) or create the missing ones; returns their ids, deduplicated, in order. */
export async function tagsFor(db: Db, names: string[]): Promise<string[]> {
  const wanted = new Map<string, string>();
  for (const n of names) {
    const slug = slugify(n);
    if (!slug) throw new ValidationError(`"${n}" can't be a tag: use letters or digits`);
    if (!wanted.has(slug)) wanted.set(slug, n.trim());
  }
  if (!wanted.size) return [];
  // skipDuplicates: two saves creating the same tag at once both succeed.
  await db.blogTag.createMany({ data: [...wanted].map(([slug, name]) => ({ slug, name })), skipDuplicates: true });
  const rows = await db.blogTag.findMany({ where: { slug: { in: [...wanted.keys()] } }, select: { id: true, slug: true } });
  const id = new Map(rows.map((r) => [r.slug, r.id]));
  return [...wanted.keys()].map((s) => id.get(s)!).filter(Boolean);
}

/**
 * A slug for a post: the one asked for, or one made from the title, made
 * unique with -2, -3… A slug another post used to have is taken back from it
 * (its old links then lead here).
 */
export async function uniquePostSlug(db: Db, wanted: string, exceptId?: string, strict = false): Promise<string> {
  const base = slugify(wanted) || "post";
  if (strict) {
    // A slug the admin typed is used as it is, or refused.
    const taken = await db.blogPost.findFirst({ where: { slug: base, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { title: true } });
    if (taken) throw new ConflictError(`"${taken.title}" already uses /blog/${base}`);
    return base;
  }
  for (let i = 1; i < 200; i++) {
    const s = i === 1 ? base : `${base.slice(0, 74)}-${i}`;
    const taken = await db.blogPost.findFirst({ where: { slug: s, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
    if (!taken) return s;
  }
  throw new ConflictError("Pick another slug");
}

/** Remove `slug` from other posts' previousSlugs (a post now uses it). */
export async function releaseOldSlug(db: Db, slug: string, ownerId: string) {
  const holders = await db.blogPost.findMany({ where: { previousSlugs: { has: slug }, NOT: { id: ownerId } }, select: { id: true, previousSlugs: true } });
  for (const h of holders) await db.blogPost.update({ where: { id: h.id }, data: { previousSlugs: h.previousSlugs.filter((x) => x !== slug) } });
}

export const summarySelect = {
  slug: true,
  title: true,
  excerpt: true,
  body: true,
  coverImageUrl: true,
  coverImageAlt: true,
  publishedAt: true,
  updatedAt: true,
  readingMinutes: true,
  authorName: true,
  featured: true,
  category: { select: { slug: true, name: true } },
  tags: { select: { tag: { select: { slug: true, name: true } } } },
} satisfies Prisma.BlogPostSelect;

type SummaryRow = Prisma.BlogPostGetPayload<{ select: typeof summarySelect }>;

/** What the website lists: no body, the excerpt filled in. */
export function summary(p: SummaryRow) {
  return {
    slug: p.slug,
    title: p.title,
    excerpt: excerptOf(p),
    coverImageUrl: p.coverImageUrl,
    coverImageAlt: p.coverImageAlt,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    readingMinutes: p.readingMinutes,
    authorName: p.authorName,
    featured: p.featured,
    category: p.category,
    tags: p.tags.map((t) => t.tag),
  };
}

/** After any blog change: the website refreshes its cached copy. */
export function blogChanged(reason: string) {
  notifyWebsite(reason);
}

export async function findPostOr404(db: Db, id: string) {
  const row = await db.blogPost.findUnique({ where: { id }, include: { category: true, tags: { include: { tag: true } } } });
  if (!row) throw new NotFoundError("Post not found");
  return row;
}
