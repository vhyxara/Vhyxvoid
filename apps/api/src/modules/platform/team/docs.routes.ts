// /api/v1/team/:accountId/docs — markdown documents in folders with version
// history (internal-tools/shared/api-platform-plan.md, phase 6).
//
//   GET    /docs                        folders and documents (no bodies), limits
//   POST   /docs/folders                { name, parentId? }
//   PATCH  /docs/folders/:fid           { name?, parentId? }
//   DELETE /docs/folders/:fid           its documents and folders move to the parent
//   POST   /docs                        { title, folderId?, body? } (plan maxTeamDocs)
//   GET    /docs/:id                    the document, its outline, cards for its links, comment counts per heading
//   PUT    /docs/:id                    { title?, body?, folderId?, expectedVersion? } (409 on a stale save)
//   DELETE /docs/:id                    (author, owners/admins)
//   GET    /docs/:id/versions           history (no bodies)
//   GET    /docs/:id/versions/:n        one version
//   GET    /docs/:id/diff?from=&to=     line diff between two versions ("current" = the document now)
//   POST   /docs/:id/versions/:n/restore
//
// Every member reads and edits documents. A save starts a new version unless
// the same person saved less than 10 minutes ago (then it updates theirs), so
// history shows sessions of work, not every keystroke.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ConflictError, ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { TEAM_BOUNDS, diffLines, diffStats, docOutline, mentionsOf, plainText, refsInText } from "@vhyxvoid/shared";
import { cardKey, resolveCards, teamContext, type Db } from "./team.shared";

const params = z.object({ accountId: z.string().uuid() });
const idParams = params.extend({ id: z.string().uuid() });
const folderParams = params.extend({ fid: z.string().uuid() });
const verParams = idParams.extend({ n: z.coerce.number().int().min(1) });
const SESSION_MS = 10 * 60_000;

type Doc = { id: string; accountId: string; folderId: string | null; title: string; body: string; version: number; createdById: string | null; updatedById: string | null; createdAt: Date; updatedAt: Date };
type Folder = { id: string; accountId: string; parentId: string | null; name: string };

export async function teamDocRoutes(fastify: FastifyInstance) {
  const t = teamContext(fastify);
  const db: Db = t.db;

  async function find(accountId: string, id: string): Promise<Doc> {
    const d = (await db.teamDoc.findFirst({ where: { id, accountId } })) as Doc | null;
    if (!d) throw new NotFoundError("Document not found");
    return d;
  }
  async function folder(accountId: string, id: string | null | undefined): Promise<Folder | null> {
    if (!id) return null;
    const f = (await db.teamFolder.findFirst({ where: { id, accountId } })) as Folder | null;
    if (!f) throw new NotFoundError("Folder not found");
    return f;
  }
  /** Records the save in history (new version, or the author's recent one). */
  async function snapshot(doc: Doc, userId: string) {
    const latest = await db.teamDocVersion.findFirst({ where: { docId: doc.id }, orderBy: { number: "desc" } });
    if (latest && latest.title === doc.title && latest.body === doc.body) return latest.number;
    if (latest && latest.authorId === userId && Date.now() - new Date(latest.updatedAt).getTime() < SESSION_MS) {
      await db.teamDocVersion.update({ where: { id: latest.id }, data: { title: doc.title, body: doc.body, updatedAt: new Date() } });
      return latest.number;
    }
    const number = (latest?.number ?? 0) + 1;
    await db.teamDocVersion.create({ data: { docId: doc.id, accountId: doc.accountId, number, title: doc.title, body: doc.body, authorId: userId } });
    return number;
  }
  async function notifyMentions(accountId: string, userId: string, doc: Doc, before: string) {
    const prev = new Set(mentionsOf(before));
    const added = mentionsOf(doc.body).filter((u) => !prev.has(u));
    if (!added.length) return;
    const names = await t.names([userId, ...added]);
    const line = doc.body.split("\n").find((l) => added.some((u) => l.includes(u))) ?? "";
    await t.notify(accountId, userId, added, { type: "TEAM_MENTION", title: `${names[userId]} mentioned you in “${doc.title}”`, body: plainText(line, names), path: `/organizations/${accountId}/team/docs/${doc.id}`, metadata: { docId: doc.id } });
  }

  fastify.get("/:accountId/docs", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const m = await t.member(request, accountId);
    const [folders, docs, lim] = await Promise.all([
      db.teamFolder.findMany({ where: { accountId }, orderBy: { name: "asc" } }),
      db.teamDoc.findMany({ where: { accountId }, orderBy: { title: "asc" }, select: { id: true, title: true, folderId: true, updatedAt: true, updatedById: true, createdById: true } }),
      t.limits(accountId),
    ]);
    const names = await t.names(docs.map((d: Doc) => d.updatedById).filter(Boolean));
    return successResponse(reply, "Success", 200, {
      enabled: lim.enabled && lim.maxChannels > 0,
      limits: { maxDocs: lim.maxDocs, docs: docs.length },
      canManage: m.isAdmin,
      folders,
      docs: docs.map((d: Doc) => ({ ...d, updatedBy: d.updatedById ? (names[d.updatedById] ?? "Former member") : null })),
    });
  });

  fastify.post("/:accountId/docs/folders", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const b = z.object({ name: z.string().trim().min(1).max(TEAM_BOUNDS.folderName), parentId: z.string().uuid().nullable().optional() }).parse(request.body ?? {});
    await t.member(request, accountId);
    await t.writable(accountId);
    await folder(accountId, b.parentId);
    if ((await db.teamFolder.count({ where: { accountId } })) >= 500) throw new ValidationError("At most 500 folders");
    const f = await db.teamFolder.create({ data: { accountId, name: b.name, parentId: b.parentId ?? null } });
    await t.emit(accountId, "doc", { folders: true });
    return successResponse(reply, "Folder created", 201, f);
  });

  fastify.patch("/:accountId/docs/folders/:fid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, fid } = folderParams.parse(request.params);
    const b = z.object({ name: z.string().trim().min(1).max(TEAM_BOUNDS.folderName).optional(), parentId: z.string().uuid().nullable().optional() }).parse(request.body ?? {});
    await t.member(request, accountId);
    await t.writable(accountId);
    await folder(accountId, fid);
    if (b.parentId) {
      // No folder inside itself or its own subfolders.
      const all = (await db.teamFolder.findMany({ where: { accountId }, select: { id: true, parentId: true } })) as Folder[];
      const parent = new Map(all.map((f) => [f.id, f.parentId]));
      for (let at: string | null | undefined = b.parentId, i = 0; at && i < 600; at = parent.get(at), i++) if (at === fid) throw new ValidationError("A folder can't go inside itself");
      await folder(accountId, b.parentId);
    }
    const f = await db.teamFolder.update({ where: { id: fid }, data: { ...(b.name ? { name: b.name } : {}), ...(b.parentId !== undefined ? { parentId: b.parentId } : {}) } });
    await t.emit(accountId, "doc", { folders: true });
    return successResponse(reply, "Saved", 200, f);
  });

  fastify.delete("/:accountId/docs/folders/:fid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, fid } = folderParams.parse(request.params);
    await t.member(request, accountId);
    await t.writable(accountId);
    const f = (await folder(accountId, fid))!;
    await db.$transaction([
      db.teamDoc.updateMany({ where: { accountId, folderId: fid }, data: { folderId: f.parentId } }),
      db.teamFolder.updateMany({ where: { accountId, parentId: fid }, data: { parentId: f.parentId } }),
      db.teamFolder.delete({ where: { id: fid } }),
    ]);
    await t.emit(accountId, "doc", { folders: true });
    return successResponse(reply, "Folder removed; its contents moved up", 200, { id: fid });
  });

  fastify.post("/:accountId/docs", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const b = z.object({ title: z.string().trim().min(1).max(TEAM_BOUNDS.docTitle), folderId: z.string().uuid().nullable().optional(), body: z.string().max(TEAM_BOUNDS.docBody).default("") }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    const lim = await t.writable(accountId);
    const count = await db.teamDoc.count({ where: { accountId } });
    if (count >= lim.maxDocs) throw new PlanLimitExceededError({ limit: lim.maxDocs, current: count, limitKey: "maxTeamDocs", plan: lim.plan });
    await folder(accountId, b.folderId);
    const d = (await db.teamDoc.create({ data: { accountId, title: b.title, body: b.body, folderId: b.folderId ?? null, createdById: m.userId, updatedById: m.userId } })) as Doc;
    await snapshot(d, m.userId);
    await notifyMentions(accountId, m.userId, d, "");
    await t.emit(accountId, "doc", { docId: d.id });
    return successResponse(reply, "Document created", 201, { id: d.id, title: d.title, version: d.version });
  });

  fastify.get("/:accountId/docs/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const m = await t.member(request, accountId);
    const d = await find(accountId, id);
    const refs = refsInText(d.body, accountId, 30);
    const [cards, comments, names, latest, lim] = await Promise.all([
      resolveCards(db, accountId, m.userId, refs),
      db.teamComment.groupBy({ by: ["anchor"], where: { targetKind: "doc", targetId: id, deletedAt: null, resolvedAt: null }, _count: { _all: true } }),
      t.names([d.createdById, d.updatedById].filter(Boolean) as string[]),
      db.teamDocVersion.findFirst({ where: { docId: id }, orderBy: { number: "desc" }, select: { number: true } }),
      t.limits(accountId),
    ]);
    return successResponse(reply, "Success", 200, {
      ...d,
      createdBy: d.createdById ? (names[d.createdById] ?? "Former member") : null,
      updatedBy: d.updatedById ? (names[d.updatedById] ?? "Former member") : null,
      outline: docOutline(d.body),
      cards: refs.map((r) => ({ url: r.url, card: cards.get(cardKey(r)) })),
      openComments: Object.fromEntries(comments.map((c: { anchor: string | null; _count: { _all: number } }) => [c.anchor ?? "", c._count._all])),
      latestVersion: latest?.number ?? 0,
      canDelete: m.isAdmin || d.createdById === m.userId,
      writable: lim.enabled && lim.maxChannels > 0,
    });
  });

  fastify.put("/:accountId/docs/:id", { onRequest: [fastify.userAuthGuard], bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const b = z.object({ title: z.string().trim().min(1).max(TEAM_BOUNDS.docTitle).optional(), body: z.string().max(TEAM_BOUNDS.docBody).optional(), folderId: z.string().uuid().nullable().optional(), expectedVersion: z.number().int().min(1).optional() }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const before = await find(accountId, id);
    if (b.expectedVersion !== undefined && b.expectedVersion !== before.version) throw new ConflictError("Someone saved this document after you opened it. Reload to see their changes; copy yours first.");
    if (b.folderId !== undefined) await folder(accountId, b.folderId);
    const res = await db.teamDoc.updateMany({
      where: { id, accountId, version: before.version },
      data: { ...(b.title !== undefined ? { title: b.title } : {}), ...(b.body !== undefined ? { body: b.body } : {}), ...(b.folderId !== undefined ? { folderId: b.folderId } : {}), version: { increment: 1 }, updatedById: m.userId },
    });
    if (!res.count) throw new ConflictError("Someone saved this document at the same moment. Reload and try again.");
    const d = await find(accountId, id);
    const number = await snapshot(d, m.userId);
    if (b.body !== undefined) await notifyMentions(accountId, m.userId, d, before.body);
    await t.emit(accountId, "doc", { docId: id, version: d.version, by: m.userId });
    return successResponse(reply, "Saved", 200, { id, version: d.version, title: d.title, latestVersion: number, updatedAt: d.updatedAt, outline: docOutline(d.body) });
  });

  fastify.delete("/:accountId/docs/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const m = await t.member(request, accountId);
    const d = await find(accountId, id);
    if (!m.isAdmin && d.createdById !== m.userId) throw new ForbiddenError("Only the author and owners/admins can delete a document");
    await db.$transaction([db.teamComment.deleteMany({ where: { targetKind: "doc", targetId: id } }), db.teamDoc.delete({ where: { id } })]);
    await t.emit(accountId, "doc", { docId: id, deleted: true });
    return successResponse(reply, "Deleted", 200, { id });
  });

  fastify.get("/:accountId/docs/:id/versions", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await t.member(request, accountId);
    await find(accountId, id);
    const rows = await db.teamDocVersion.findMany({ where: { docId: id }, orderBy: { number: "desc" }, take: 200, select: { number: true, title: true, authorId: true, createdAt: true, updatedAt: true } });
    const names = await t.names(rows.map((r: { authorId: string | null }) => r.authorId).filter(Boolean));
    return successResponse(reply, "Success", 200, { versions: rows.map((r: { authorId: string | null }) => ({ ...r, author: r.authorId ? (names[r.authorId] ?? "Former member") : null })) });
  });

  fastify.get("/:accountId/docs/:id/versions/:n", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id, n } = verParams.parse(request.params);
    await t.member(request, accountId);
    await find(accountId, id);
    const v = await db.teamDocVersion.findUnique({ where: { docId_number: { docId: id, number: n } } });
    if (!v) throw new NotFoundError("Version not found");
    return successResponse(reply, "Success", 200, v);
  });

  fastify.get("/:accountId/docs/:id/diff", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const q = z.object({ from: z.coerce.number().int().min(1), to: z.union([z.literal("current"), z.coerce.number().int().min(1)]).default("current") }).parse(request.query ?? {});
    await t.member(request, accountId);
    const d = await find(accountId, id);
    const a = await db.teamDocVersion.findUnique({ where: { docId_number: { docId: id, number: q.from } } });
    const b = q.to === "current" ? { title: d.title, body: d.body } : await db.teamDocVersion.findUnique({ where: { docId_number: { docId: id, number: q.to } } });
    if (!a || !b) throw new NotFoundError("Version not found");
    const lines = diffLines(a.body, b.body);
    return successResponse(reply, "Success", 200, { from: q.from, to: q.to, titleChanged: a.title !== b.title ? { from: a.title, to: b.title } : null, lines, ...diffStats(lines) });
  });

  fastify.post("/:accountId/docs/:id/versions/:n/restore", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id, n } = verParams.parse(request.params);
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const d = await find(accountId, id);
    const v = await db.teamDocVersion.findUnique({ where: { docId_number: { docId: id, number: n } } });
    if (!v) throw new NotFoundError("Version not found");
    await db.teamDoc.update({ where: { id }, data: { title: v.title, body: v.body, version: { increment: 1 }, updatedById: m.userId } });
    // Restoring is its own version, so the restore can be undone too.
    const restored = await find(accountId, id);
    const latest = await db.teamDocVersion.findFirst({ where: { docId: id }, orderBy: { number: "desc" } });
    await db.teamDocVersion.create({ data: { docId: id, accountId, number: (latest?.number ?? 0) + 1, title: restored.title, body: restored.body, authorId: m.userId } });
    await t.emit(accountId, "doc", { docId: id, version: restored.version, by: m.userId });
    return successResponse(reply, `Version ${n} restored`, 200, { id, version: restored.version, from: d.version });
  });
}
