// /api/v1/team/:accountId/comments — comments on documents (optionally on one
// heading) and on issues (internal-tools/shared/api-platform-plan.md, phase 6).
//
//   GET    /comments?target=doc:<id>|issue:<number>
//   POST   /comments               { target, body, anchor? }
//   PATCH  /comments/:cid          { body?, resolved? } (body: author; resolved: anyone)
//   DELETE /comments/:cid          (author, owners/admins)
//
// Mentions notify; a comment also tells the document's author or the
// issue's assignee and creator (TEAM_REPLY).
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ForbiddenError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { TEAM_BOUNDS, mentionsOf, plainText } from "@vhyxvoid/shared";
import { teamContext, type Db } from "./team.shared";

const params = z.object({ accountId: z.string().uuid() });
const cParams = params.extend({ cid: z.string().uuid() });
const target = z.string().regex(/^(doc:[0-9a-f-]{36}|issue:\d{1,9})$/i, "target is doc:<id> or issue:<number>");

type Target = { kind: "doc" | "issue"; id: string; title: string; path: string; ownerIds: string[] };
type Comment = { id: string; accountId: string; targetKind: string; targetId: string; anchor: string | null; authorId: string; body: string; mentions: string[]; resolvedAt: Date | null; editedAt: Date | null; deletedAt: Date | null; createdAt: Date };

export async function teamCommentRoutes(fastify: FastifyInstance) {
  const t = teamContext(fastify);
  const db: Db = t.db;

  async function resolveTarget(accountId: string, raw: string): Promise<Target> {
    const [kind, id] = raw.split(":");
    if (kind === "doc") {
      const d = await db.teamDoc.findFirst({ where: { id, accountId }, select: { id: true, title: true, createdById: true } });
      if (!d) throw new NotFoundError("Document not found");
      return { kind: "doc", id: d.id, title: `“${d.title}”`, path: `/organizations/${accountId}/team/docs/${d.id}`, ownerIds: [d.createdById].filter(Boolean) };
    }
    const i = await db.teamIssue.findUnique({ where: { accountId_number: { accountId, number: Number(id) } }, select: { id: true, number: true, title: true, assigneeId: true, createdById: true } });
    if (!i) throw new NotFoundError(`Issue #${id} not found`);
    return { kind: "issue", id: i.id, title: `#${i.number}`, path: `/organizations/${accountId}/team/issues/${i.number}`, ownerIds: [i.assigneeId, i.createdById].filter(Boolean) };
  }
  const view = (c: Comment, names: Record<string, string>) => ({
    id: c.id,
    anchor: c.anchor,
    authorId: c.authorId,
    author: names[c.authorId] ?? "Former member",
    body: c.deletedAt ? "" : c.body,
    deleted: !!c.deletedAt,
    resolved: !!c.resolvedAt,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
  });

  fastify.get("/:accountId/comments", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "team:read" } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const q = z.object({ target }).parse(request.query ?? {});
    await t.member(request, accountId);
    const tg = await resolveTarget(accountId, q.target);
    const rows = (await db.teamComment.findMany({ where: { accountId, targetKind: tg.kind, targetId: tg.id }, orderBy: { createdAt: "asc" }, take: 500 })) as Comment[];
    const names = await t.names(rows.map((r) => r.authorId));
    return successResponse(reply, "Success", 200, { comments: rows.map((r) => view(r, names)) });
  });

  fastify.post("/:accountId/comments", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "team:write", rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const b = z.object({ target, body: z.string().trim().min(1).max(TEAM_BOUNDS.commentLength), anchor: z.string().max(120).nullable().optional() }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const tg = await resolveTarget(accountId, b.target);
    if (b.anchor && tg.kind !== "doc") throw new ValidationError("Only document comments can point at a heading");
    const mentions = mentionsOf(b.body);
    const c = (await db.teamComment.create({ data: { accountId, targetKind: tg.kind, targetId: tg.id, anchor: b.anchor ?? null, authorId: m.userId, body: b.body, mentions } })) as Comment;
    if (tg.kind === "issue") await db.teamIssueEvent.create({ data: { issueId: tg.id, accountId, actorId: m.userId, kind: "comment", to: c.id } });
    const names = await t.names([m.userId, ...mentions]);
    const text = plainText(b.body, names);
    await t.notify(accountId, m.userId, mentions, { type: "TEAM_MENTION", title: `${names[m.userId]} mentioned you in a comment on ${tg.title}`, body: text, path: tg.path, metadata: { commentId: c.id } });
    await t.notify(accountId, m.userId, tg.ownerIds.filter((u) => !mentions.includes(u)), { type: "TEAM_REPLY", title: `${names[m.userId]} commented on ${tg.title}`, body: text, path: tg.path, metadata: { commentId: c.id } });
    await t.emit(accountId, tg.kind === "doc" ? "doc" : "issue", tg.kind === "doc" ? { docId: tg.id, comments: true } : { issueId: tg.id, comments: true });
    return successResponse(reply, "Commented", 201, view(c, names));
  });

  fastify.patch("/:accountId/comments/:cid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, cid } = cParams.parse(request.params);
    const b = z.object({ body: z.string().trim().min(1).max(TEAM_BOUNDS.commentLength).optional(), resolved: z.boolean().optional() }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const c = (await db.teamComment.findFirst({ where: { id: cid, accountId, deletedAt: null } })) as Comment | null;
    if (!c) throw new NotFoundError("Comment not found");
    if (b.body !== undefined && c.authorId !== m.userId) throw new ForbiddenError("Only the author can edit a comment");
    const updated = (await db.teamComment.update({
      where: { id: cid },
      data: { ...(b.body !== undefined ? { body: b.body, mentions: mentionsOf(b.body), editedAt: new Date() } : {}), ...(b.resolved !== undefined ? { resolvedAt: b.resolved ? new Date() : null } : {}) },
    })) as Comment;
    await t.emit(accountId, c.targetKind === "doc" ? "doc" : "issue", c.targetKind === "doc" ? { docId: c.targetId, comments: true } : { issueId: c.targetId, comments: true });
    return successResponse(reply, "Saved", 200, view(updated, await t.names([updated.authorId])));
  });

  fastify.delete("/:accountId/comments/:cid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, cid } = cParams.parse(request.params);
    const m = await t.member(request, accountId);
    const c = (await db.teamComment.findFirst({ where: { id: cid, accountId, deletedAt: null } })) as Comment | null;
    if (!c) throw new NotFoundError("Comment not found");
    if (c.authorId !== m.userId && !m.isAdmin) throw new ForbiddenError("Only the author and owners/admins can delete a comment");
    await db.teamComment.update({ where: { id: cid }, data: { body: "", mentions: [], deletedAt: new Date() } });
    await t.emit(accountId, c.targetKind === "doc" ? "doc" : "issue", c.targetKind === "doc" ? { docId: c.targetId, comments: true } : { issueId: c.targetId, comments: true });
    return successResponse(reply, "Deleted", 200, { id: cid });
  });
}
