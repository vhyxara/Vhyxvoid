import type { PrismaClient, ContentEntry } from "@/generated/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { CONTENT_KINDS, isContentKind, type ContentKind } from "./content.schemas";
import { DEFAULT_CONTENT, defaultEntry } from "./content.defaults";

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

  constructor(private readonly prisma: PrismaClient) {}

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
    return { items, total, available };
  }

  async get(id: string) {
    const row = await this.prisma.contentEntry.findUnique({
      where: { id },
      include: { revisions: { orderBy: { version: "desc" }, take: 20, select: { id: true, version: true, title: true, note: true, createdAt: true, createdById: true } } },
    });
    if (!row) throw new NotFoundError("Content entry not found");
    return row;
  }

  async create(input: { slug: string; kind: string; title: string; data?: unknown; seoTitle?: string | null; seoDescription?: string | null }, adminId: string) {
    if (!isContentKind(input.kind)) throw new ValidationError(`Unknown content kind "${input.kind}"`);
    const def = defaultEntry(input.slug);
    const data = parseData(input.kind, input.data ?? (def && def.kind === input.kind ? def.data : this.emptyData(input.kind)));
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

  async update(id: string, input: { title?: string; data?: unknown; seoTitle?: string | null; seoDescription?: string | null }, adminId: string) {
    const row = await this.prisma.contentEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Content entry not found");
    const data = input.data !== undefined ? parseData(row.kind, input.data) : undefined;
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
    this.publicCache.delete(row.slug);
    return updated;
  }

  /** Take an entry off the site (falls back to the built-in default if one exists, unless archived). */
  async setStatus(id: string, status: "DRAFT" | "ARCHIVED", adminId: string) {
    const row = await this.prisma.contentEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundError("Content entry not found");
    const updated = await this.prisma.contentEntry.update({ where: { id }, data: { status, updatedById: adminId } });
    this.publicCache.delete(row.slug);
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
    this.publicCache.delete(row.slug);
    return row;
  }

  private emptyData(kind: ContentKind): unknown {
    if (kind === "page") return { body: "", showInFooter: false, footerGroup: "company" };
    return DEFAULT_CONTENT.find((d) => d.kind === kind)?.data ?? {};
  }
}
