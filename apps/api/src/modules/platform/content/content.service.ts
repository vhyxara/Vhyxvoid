import type { PrismaClient, ContentEntry } from "@/generated/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { CONTENT_KINDS, isContentKind, type ContentKind } from "./content.schemas";
import { DEFAULT_CONTENT, defaultEntry } from "./content.defaults";
import { FOOTER_SLUG, isReservedPageSlug, pagePath, type FooterContent, type FooterMenu } from "@vhyxvoid/content";
import { notifyWebsite } from "./revalidate";

/** The settings the built-in footer reads (SettingsService.get). */
type SettingsReader = { get(key: "support.docsUrl" | "general.statusPageUrl" | "general.githubUrl" | "general.twitterUrl"): Promise<unknown> };

export type PublicContent = {
  slug: string;
  kind: string;
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  data: unknown;
  publishedAt: string | null;
  isDefault: boolean;
};

function parseData(kind: string, data: unknown) {
  if (!isContentKind(kind)) throw new ValidationError(`Unknown content kind "${kind}"`);
  const result = CONTENT_KINDS[kind].schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      `Invalid ${CONTENT_KINDS[kind].label} content: ${result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/**
 * Website content managed from the admin panel. `data` is the working copy
 * admins edit; publishing copies it to `publishedData` (what the public site
 * reads) and snapshots a revision. Public reads are cached in-process for
 * 30 s and invalidated on publish.
 */
export class ContentService {
  private readonly publicCache = new Map<string, { at: number; value: PublicContent | null }>();
  private footerCache: { at: number; value: FooterMenu } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings?: SettingsReader,
  ) {}

  /** After any change: drop cached reads here and on the website. */
  invalidate(reason: string) {
    this.publicCache.clear();
    this.footerCache = null;
    notifyWebsite(reason);
  }

  // ── Public ────────────────────────────────────────────────────────────────

  async getPublished(slug: string): Promise<PublicContent | null> {
    const hit = this.publicCache.get(slug);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const row = await this.prisma.contentEntry.findUnique({ where: { slug } });
    let value: PublicContent | null = null;
    if (row && row.status === "PUBLISHED" && row.publishedData) {
      value = {
        slug: row.slug,
        kind: row.kind,
        title: row.title,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        data: row.publishedData,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        isDefault: false,
      };
    } else if (!row || row.status !== "ARCHIVED") {
      // Built-in default until an admin publishes their own version.
      const def = defaultEntry(slug);
      if (def) {
        value = { slug, kind: def.kind, title: def.title, seoTitle: null, seoDescription: def.seoDescription ?? null, data: def.data, publishedAt: null, isDefault: true };
      }
    }
    this.publicCache.set(slug, { at: Date.now(), value });
    return value;
  }

  /** Published markdown pages flagged for the footer (plus defaults not yet overridden). */
  async footerLinks(): Promise<Array<{ slug: string; title: string; group: string }>> {
    const rows = await this.prisma.contentEntry.findMany({
      where: { kind: "page" },
      select: { slug: true, title: true, status: true, publishedData: true },
    });
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    const links: Array<{ slug: string; title: string; group: string }> = [];
    for (const r of rows) {
      const d = r.publishedData as { showInFooter?: boolean; footerGroup?: string } | null;
      if (r.status === "PUBLISHED" && d?.showInFooter) links.push({ slug: r.slug, title: r.title, group: d.footerGroup ?? "legal" });
    }
    for (const def of DEFAULT_CONTENT) {
      const d = def.data as { showInFooter?: boolean; footerGroup?: string };
      if (def.kind === "page" && d.showInFooter && !bySlug.has(def.slug)) links.push({ slug: def.slug, title: def.title, group: d.footerGroup ?? "legal" });
    }
    return links;
  }

  /**
   * The footer the site renders. The published "footer" entry when there is
   * one (links to pages that aren't live are left out), else the built-in
   * footer: fixed product/company links, the Status/GitHub/X settings, and
   * pages flagged "show in footer". Cached 30 s; any content change clears it.
   */
  async footerMenu(): Promise<FooterMenu> {
    if (this.footerCache && Date.now() - this.footerCache.at < 30_000) return this.footerCache.value;
    const row = await this.prisma.contentEntry.findUnique({ where: { slug: FOOTER_SLUG } });
    let value: FooterMenu;
    if (row && row.kind === "footer" && row.status === "PUBLISHED" && row.publishedData) {
      const data = row.publishedData as FooterContent;
      const columns: FooterMenu["columns"] = [];
      for (const col of data.columns ?? []) {
        const links: FooterMenu["columns"][number]["links"] = [];
        for (const l of col.links ?? []) {
          if (l.type === "page") {
            const page = l.slug ? await this.getPublished(l.slug) : null;
            if (page && page.kind === "page") links.push({ label: l.label, href: pagePath(page.slug), external: !!l.newTab });
          } else if (l.href) {
            links.push({ label: l.label, href: l.href, external: !!l.newTab });
          }
        }
        if (links.length || col.title) columns.push({ title: col.title, links });
      }
      value = { columns, custom: true };
    } else {
      value = { columns: await this.builtInFooter(), custom: false };
    }
    this.footerCache = { at: Date.now(), value };
    return value;
  }

  /** Today's footer, before an admin publishes their own. */
  private async builtInFooter(): Promise<FooterMenu["columns"]> {
    const setting = async (k: Parameters<SettingsReader["get"]>[0]) => {
      const v = this.settings ? await this.settings.get(k).catch(() => "") : "";
      return typeof v === "string" ? v : "";
    };
    const [docs, status, github, twitter, pages, posts, changelog] = await Promise.all([
      setting("support.docsUrl"),
      setting("general.statusPageUrl"),
      setting("general.githubUrl"),
      setting("general.twitterUrl"),
      this.footerLinks(),
      // "Blog" appears once there is something to read.
      this.prisma.blogPost.count({ where: { status: "PUBLISHED", publishedAt: { lte: new Date() } } }).catch(() => 0),
      // "Changelog" too, once there is an entry.
      this.prisma.changelogEntry.count({ where: { status: "PUBLISHED", publishedAt: { lte: new Date() } } }).catch(() => 0),
    ]);
    const group = (g: string) => pages.filter((p) => p.group === g).map((p) => ({ label: p.title, href: pagePath(p.slug), external: false }));
    const ext = (label: string, href: string) => (href ? [{ label, href, external: true }] : []);
    return [
      { title: "Product", links: [{ label: "Features", href: "/#features", external: false }, { label: "Pricing", href: "/pricing", external: false }, { label: "Docs", href: docs || "/docs", external: false }, ...(changelog ? [{ label: "Changelog", href: "/changelog", external: false }] : []), ...group("product")] },
      { title: "Company", links: [...group("company"), ...(posts ? [{ label: "Blog", href: "/blog", external: false }] : []), { label: "Support", href: "/support", external: false }, ...ext("Status", status), ...ext("GitHub", github), ...ext("X / Twitter", twitter)] },
      { title: "Legal", links: group("legal") },
    ];
  }

  /** The built-in footer as an editable footer entry: the first draft of a custom one. */
  private async footerDraft(): Promise<FooterContent> {
    const pages = new Map((await this.footerLinks()).map((p) => [pagePath(p.slug), p.slug]));
    let n = 0;
    const id = () => `l${++n}`;
    return {
      columns: (await this.builtInFooter()).map((c, i) => ({
        id: `c${i + 1}`,
        title: c.title,
        links: c.links.map((l) => (pages.has(l.href) ? { id: id(), label: l.label, type: "page" as const, slug: pages.get(l.href), newTab: false } : { id: id(), label: l.label, type: "url" as const, href: l.href, newTab: l.external })),
      })),
    };
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  async list(q: { kind?: string; status?: string; search?: string; skip: number; take: number }) {
    const where = {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status as ContentEntry["status"] } : {}),
      ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" as const } }, { slug: { contains: q.search, mode: "insensitive" as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.contentEntry.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: q.skip,
        take: q.take,
        select: { id: true, slug: true, kind: true, title: true, status: true, version: true, publishedAt: true, updatedAt: true, createdAt: true },
      }),
      this.prisma.contentEntry.count({ where }),
    ]);
    // Built-in entries an admin hasn't created yet, so they can be edited.
    const existing = new Set((await this.prisma.contentEntry.findMany({ select: { slug: true } })).map((r) => r.slug));
    const available = DEFAULT_CONTENT.filter((d) => !existing.has(d.slug)).map((d) => ({ slug: d.slug, kind: d.kind, title: d.title }));
    // The footer menu starts as a copy of the built-in footer (footerDraft).
    if (!existing.has(FOOTER_SLUG)) available.push({ slug: FOOTER_SLUG, kind: "footer", title: "Footer menu" });
    return { items, total, available };
  }

  async get(id: string) {
    const row = await this.prisma.contentEntry.findUnique({
      where: { id },
      include: { revisions: { orderBy: { version: "desc" }, take: 20, select: { id: true, version: true, title: true, note: true, createdAt: true, createdById: true } } },
    });
    if (!row) throw new NotFoundError("Content entry not found");
    return withNewSections(row);
  }

  async create(input: { slug: string; kind: string; title: string; data?: unknown; seoTitle?: string | null; seoDescription?: string | null }, adminId: string) {
    if (!isContentKind(input.kind)) throw new ValidationError(`Unknown content kind "${input.kind}"`);
    if ((input.kind === "footer") !== (input.slug === FOOTER_SLUG)) throw new ValidationError(`The footer menu is the one entry with slug "${FOOTER_SLUG}"`);
    if (input.kind === "page" && isReservedPageSlug(input.slug)) throw new ValidationError(`"/${input.slug.split("/")[0]}" is one of the website's own addresses; pick another slug`);
    const def = defaultEntry(input.slug);
    const initial = input.data ?? (def && def.kind === input.kind ? def.data : input.kind === "footer" ? await this.footerDraft() : this.emptyData(input.kind));
    const data = parseData(input.kind, initial);
    try {
      return await this.prisma.contentEntry.create({
        data: {
          slug: input.slug,
          kind: input.kind,
          title: input.title,
          data: data as object,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? def?.seoDescription ?? null,
          updatedById: adminId,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError(`An entry with slug "${input.slug}" already exists`);
      throw err;
    }
  }

  /**
   * Save the working copy. With `expectedUpdatedAt` (what the editor loaded),
   * a save that would overwrite someone else's newer save is refused with
   * 409 instead of silently winning.
   */
  async update(
    id: string,
    input: { title?: string; data?: unknown; seoTitle?: string | null; seoDescription?: string | null; expectedUpdatedAt?: Date },
    adminId: string,
  ) {
    const row = await this.prisma.contentEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Content entry not found");
    const data = input.data !== undefined ? parseData(row.kind, input.data) : undefined;
    if (input.expectedUpdatedAt) {
      const res = await this.prisma.contentEntry.updateMany({
        where: { id, updatedAt: input.expectedUpdatedAt },
        data: { updatedById: adminId },
      });
      if (res.count === 0) throw new ConflictError("Someone saved this entry after you opened it. Reload to see their changes, then make yours again.");
    }
    const updated = await this.prisma.contentEntry.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(data !== undefined ? { data: data as object } : {}),
        ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
        ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription } : {}),
        updatedById: adminId,
      },
    });
    return { before: row, after: updated };
  }

  /** Make the working copy live and snapshot it as a new revision. */
  async publish(id: string, adminId: string, note?: string) {
    const row = await this.prisma.contentEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Content entry not found");
    const data = parseData(row.kind, row.data);
    const version = row.version + 1;
    const [updated] = await this.prisma.$transaction([
      this.prisma.contentEntry.update({
        where: { id },
        data: { status: "PUBLISHED", publishedData: data as object, publishedAt: new Date(), version, updatedById: adminId },
      }),
      this.prisma.contentRevision.create({
        data: { entryId: id, version, title: row.title, data: data as object, note: note ?? null, createdById: adminId },
      }),
    ]);
    this.invalidate(`publishing ${row.slug}`);
    return updated;
  }

  /** Take an entry off the site (falls back to the built-in default if one exists, unless archived). */
  async setStatus(id: string, status: "DRAFT" | "ARCHIVED", adminId: string) {
    const row = await this.prisma.contentEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Content entry not found");
    const updated = await this.prisma.contentEntry.update({ where: { id }, data: { status, updatedById: adminId } });
    this.invalidate(`unpublishing ${row.slug}`);
    return { before: row, after: updated };
  }

  /** Copy a revision back into the working copy (publish separately). */
  async restoreRevision(id: string, revisionId: string, adminId: string) {
    const rev = await this.prisma.contentRevision.findFirst({ where: { id: revisionId, entryId: id } });
    if (!rev) throw new NotFoundError("Revision not found");
    return this.prisma.contentEntry.update({ where: { id }, data: { data: rev.data as object, title: rev.title, updatedById: adminId } });
  }

  async remove(id: string) {
    const row = await this.prisma.contentEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Content entry not found");
    await this.prisma.contentEntry.delete({ where: { id } });
    this.invalidate(`deleting ${row.slug}`);
    return row;
  }

  private emptyData(kind: ContentKind): unknown {
    if (kind === "page") return { body: "", showInFooter: false, footerGroup: "company" };
    return DEFAULT_CONTENT.find((d) => d.kind === kind)?.data ?? {};
  }
}

/**
 * Landing sections added after an entry was saved (the journey) are filled
 * in from the built-in content when the entry is opened for editing, so the
 * editor shows them; the website shows the built-in one until it is published.
 */
export function withNewSections<T extends { kind: string; data: unknown }>(row: T): T {
  const data = row.data as Record<string, unknown> | null;
  if (row.kind !== "landing" || !data || typeof data !== "object" || "journey" in data) return row;
  const journey = (defaultEntry("home")?.data as { journey?: unknown } | undefined)?.journey;
  return journey ? { ...row, data: { ...data, journey } } : row;
}
