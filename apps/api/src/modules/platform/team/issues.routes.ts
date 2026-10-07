// /api/v1/team/:accountId/issues — the tracker (internal-tools/shared/api-platform-plan.md, phase 6).
//
//   GET    /issues?q=&sort=           issues matching the filter syntax (parseIssueQuery), labels in use, counts per status
//   POST   /issues                    { title, body?, status?, priority?, assigneeId?, labels?, dueDate?, links? } (plan maxTeamIssues)
//   GET    /issues/:n                 one issue with its activity, comments and cards for linked objects
//   PATCH  /issues/:n                 { title?, body?, status?, priority?, assigneeId?, labels?, dueDate?, links? }
//   POST   /issues/:n/move            { status, before?, after? } board drag: the numbers of the cards above and below
//   DELETE /issues/:n                 (creator, owners/admins)
//
// Linked objects are dashboard links (endpoints, requests, runs, docs…),
// given as `links` or written in the body. Every change is an event in the
// issue's activity; assigning someone notifies them.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_STATUS_LABEL,
  TEAM_BOUNDS,
  labelProblem,
  mentionsOf,
  normalizeLabels,
  parseIssueQuery,
  plainText,
  rankBetween,
  refFromUrl,
  refsInText,
  statusesFor,
  type IssueStatus,
  type TeamRef,
} from "@vhyxvoid/shared";
import { cardKey, resolveCards, teamContext, type Db } from "./team.shared";

const params = z.object({ accountId: z.string().uuid() });
const numParams = params.extend({ n: z.coerce.number().int().min(1) });
const labels = z
  .array(z.string().max(TEAM_BOUNDS.labelLength))
  .max(TEAM_BOUNDS.labels)
  .transform(normalizeLabels)
  .superRefine((v, ctx) => {
    const p = labelProblem(v);
    if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p });
  });
const fields = {
  title: z.string().trim().min(1).max(TEAM_BOUNDS.issueTitle),
  body: z.string().max(TEAM_BOUNDS.issueBody),
  status: z.enum(ISSUE_STATUSES),
  priority: z.enum(ISSUE_PRIORITIES),
  assigneeId: z.string().uuid().nullable(),
  labels,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable(),
  links: z.array(z.string().max(2000)).max(20),
};
const CLOSED: IssueStatus[] = ["DONE", "CANCELLED"];
const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };

type Issue = { id: string; accountId: string; number: number; title: string; body: string; status: IssueStatus; priority: string; assigneeId: string | null; labels: string[]; dueDate: Date | null; refs: unknown; rank: string; createdById: string | null; closedAt: Date | null; createdAt: Date; updatedAt: Date };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function teamIssueRoutes(fastify: FastifyInstance) {
  const t = teamContext(fastify);
  const db: Db = t.db;

  async function find(accountId: string, n: number): Promise<Issue> {
    const i = (await db.teamIssue.findUnique({ where: { accountId_number: { accountId, number: n } } })) as Issue | null;
    if (!i) throw new NotFoundError(`Issue #${n} not found`);
    return i;
  }
  /** Linked objects: explicit links plus links in the body, this workspace only. */
  function refsFrom(accountId: string, links: string[] | undefined, body: string, prev: TeamRef[] = [], prevBody = ""): TeamRef[] {
    // Without new links, keep the previous explicit ones (those that didn't come from the old body).
    const fromOldBody = new Set(refsInText(prevBody, accountId, 50).map(cardKey));
    const explicit = links === undefined ? prev.filter((r) => !fromOldBody.has(cardKey(r))) : links.map(refFromUrl).filter((r): r is TeamRef => !!r && r.accountId === accountId.toLowerCase());
    const all = [...explicit, ...refsInText(body, accountId, 20)];
    const seen = new Set<string>();
    return all.filter((r) => !seen.has(cardKey(r)) && seen.add(cardKey(r))).slice(0, 20);
  }
  async function assignable(accountId: string, userId: string | null | undefined) {
    if (!userId) return;
    if (!(await db.accountMember.findUnique({ where: { userId_accountId: { userId, accountId } } }))) throw new ValidationError("The assignee must be in this workspace");
  }
  const view = (i: Issue, names: Record<string, string>) => ({
    number: i.number,
    title: i.title,
    status: i.status,
    priority: i.priority,
    assigneeId: i.assigneeId,
    assignee: i.assigneeId ? (names[i.assigneeId] ?? "Former member") : null,
    labels: i.labels,
    dueDate: day(i.dueDate),
    rank: i.rank,
    linkCount: Array.isArray(i.refs) ? i.refs.length : 0,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    closedAt: i.closedAt,
  });
  async function lastRank(accountId: string, status: string): Promise<string | null> {
    const last = await db.teamIssue.findFirst({ where: { accountId, status }, orderBy: { rank: "desc" }, select: { rank: true } });
    return last?.rank ?? null;
  }
  async function notifyAssignee(accountId: string, actorId: string, i: Issue) {
    if (!i.assigneeId || i.assigneeId === actorId) return;
    const names = await t.names([actorId]);
    await t.notify(accountId, actorId, [i.assigneeId], { type: "TEAM_ASSIGNED", title: `${names[actorId]} assigned you #${i.number}`, body: i.title, path: `/organizations/${accountId}/team/issues/${i.number}`, metadata: { issueNumber: i.number } });
  }
  async function notifyMentions(accountId: string, actorId: string, i: Issue, before: string) {
    const prev = new Set(mentionsOf(before));
    const added = mentionsOf(i.body).filter((u) => !prev.has(u));
    if (!added.length) return;
    const names = await t.names([actorId, ...added]);
    await t.notify(accountId, actorId, added, { type: "TEAM_MENTION", title: `${names[actorId]} mentioned you in #${i.number}`, body: plainText(i.title, names), path: `/organizations/${accountId}/team/issues/${i.number}`, metadata: { issueNumber: i.number } });
  }

  const issuesQuery = z.object({ q: z.string().max(500).default(""), sort: z.enum(["rank", "updated", "created", "priority", "due", "number"]).default("updated") });
  fastify.get("/:accountId/issues", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "team:read", apiDoc: { summary: "List issues", description: "q uses the filter syntax of the dashboard, for example: status:todo assignee:me label:bug.", query: issuesQuery } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const qs = issuesQuery.parse(request.query ?? {});
    const m = await t.member(request, accountId);
    const q = parseIssueQuery(qs.q);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const where: Record<string, unknown> = { accountId, status: { in: statusesFor(q) } };
    if (q.assignee === "me") where.assigneeId = m.userId;
    else if (q.assignee === "none") where.assigneeId = null;
    else if (q.assignee && /^[0-9a-f-]{36}$/i.test(q.assignee)) where.assigneeId = q.assignee;
    if (q.labels.length) where.labels = { hasEvery: q.labels };
    if (q.priority.length) where.priority = { in: q.priority };
    if (q.due === "overdue") where.dueDate = { lt: today };
    else if (q.due === "today") where.dueDate = today;
    else if (q.due === "week") where.dueDate = { gte: today, lte: new Date(today.getTime() + 7 * 86_400_000) };
    else if (q.due === "none") where.dueDate = null;
    if (q.text) {
      const n = /^#?(\d{1,9})$/.exec(q.text);
      where.OR = [{ title: { contains: q.text, mode: "insensitive" } }, { body: { contains: q.text, mode: "insensitive" } }, ...(n ? [{ number: Number(n[1]) }] : [])];
    }
    const orderBy = qs.sort === "rank" ? [{ rank: "asc" }] : qs.sort === "created" ? [{ createdAt: "desc" }] : qs.sort === "number" ? [{ number: "desc" }] : qs.sort === "due" ? [{ dueDate: { sort: "asc", nulls: "last" } }, { number: "desc" }] : [{ updatedAt: "desc" }];
    const [rows, labelRows, counts, lim, people] = await Promise.all([
      db.teamIssue.findMany({ where, orderBy, take: 500 }),
      db.$queryRawUnsafe(`SELECT DISTINCT unnest("labels") AS label FROM "team_issues" WHERE "accountId" = $1 ORDER BY 1 LIMIT 200`, accountId) as Promise<Array<{ label: string }>>,
      db.teamIssue.groupBy({ by: ["status"], where: { accountId }, _count: { _all: true } }),
      t.limits(accountId),
      t.people(accountId),
    ]);
    let issues = rows as Issue[];
    if (qs.sort === "priority") issues = [...issues].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.number - a.number);
    const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
    const total = counts.reduce((s: number, c: { _count: { _all: number } }) => s + c._count._all, 0);
    return successResponse(reply, "Success", 200, {
      enabled: lim.enabled && lim.maxChannels > 0,
      limits: { maxIssues: lim.maxIssues, issues: total },
      query: q,
      me: m.userId,
      people,
      labels: labelRows.map((l) => l.label),
      counts: Object.fromEntries(ISSUE_STATUSES.map((s) => [s, counts.find((c: { status: string }) => c.status === s)?._count._all ?? 0])),
      issues: issues.map((i) => view(i, names)),
    });
  });

  const createIssueBody = z.object({ title: fields.title, body: fields.body.default(""), status: fields.status.default("TODO"), priority: fields.priority.default("NONE"), assigneeId: fields.assigneeId.default(null), labels: fields.labels.default([]), dueDate: fields.dueDate.default(null), links: fields.links.default([]) });
  fastify.post("/:accountId/issues", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "team:write", apiDoc: { summary: "Open an issue", description: "Opened by the key's creator. links attach dashboard objects (mock endpoints, requests, runs, docs).", body: createIssueBody, status: 201 }, rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const b = createIssueBody.parse(request.body ?? {});
    const m = await t.member(request, accountId);
    const lim = await t.writable(accountId);
    const count = await db.teamIssue.count({ where: { accountId } });
    if (count >= lim.maxIssues) throw new PlanLimitExceededError({ limit: lim.maxIssues, current: count, limitKey: "maxTeamIssues", plan: lim.plan });
    await assignable(accountId, b.assigneeId);
    const refs = refsFrom(accountId, b.links, b.body);
    let issue: Issue | null = null;
    for (let attempt = 0; attempt < 5 && !issue; attempt++) {
      const last = await db.teamIssue.findFirst({ where: { accountId }, orderBy: { number: "desc" }, select: { number: true } });
      try {
        issue = (await db.teamIssue.create({
          data: {
            accountId,
            number: (last?.number ?? 0) + 1,
            title: b.title,
            body: b.body,
            status: b.status,
            priority: b.priority,
            assigneeId: b.assigneeId,
            labels: b.labels,
            dueDate: b.dueDate ? new Date(b.dueDate) : null,
            refs: refs as never,
            rank: rankBetween(await lastRank(accountId, b.status), null),
            createdById: m.userId,
            closedAt: CLOSED.includes(b.status) ? new Date() : null,
            events: { create: { accountId, actorId: m.userId, kind: "created" } },
          },
        })) as Issue;
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err; // two issues at once: take the next number
      }
    }
    if (!issue) throw new ValidationError("Could not number the issue; try again");
    await notifyAssignee(accountId, m.userId, issue);
    await notifyMentions(accountId, m.userId, issue, "");
    await t.emit(accountId, "issue", { number: issue.number });
    return successResponse(reply, `Created #${issue.number}`, 201, view(issue, await t.names(issue.assigneeId ? [issue.assigneeId] : [])));
  });

  fastify.get("/:accountId/issues/:n", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "team:read", apiDoc: { summary: "Get an issue", description: "With its links and activity." } } }, async (request, reply) => {
    const { accountId, n } = numParams.parse(request.params);
    const m = await t.member(request, accountId);
    const i = await find(accountId, n);
    const [events, comments, lim] = await Promise.all([
      db.teamIssueEvent.findMany({ where: { issueId: i.id }, orderBy: { createdAt: "asc" }, take: 500 }),
      db.teamComment.findMany({ where: { targetKind: "issue", targetId: i.id }, orderBy: { createdAt: "asc" }, take: 500 }),
      t.limits(accountId),
    ]);
    const refs = (i.refs as TeamRef[]) ?? [];
    const cards = await resolveCards(db, accountId, m.userId, refs);
    const ids = [i.assigneeId, i.createdById, ...events.map((e: { actorId: string | null }) => e.actorId), ...comments.map((c: { authorId: string }) => c.authorId), ...events.flatMap((e: { kind: string; from: unknown; to: unknown }) => (e.kind === "assignee" ? [e.from, e.to] : []))].filter((x): x is string => typeof x === "string");
    const names = await t.names(ids);
    return successResponse(reply, "Success", 200, {
      ...view(i, names),
      body: i.body,
      createdBy: i.createdById ? (names[i.createdById] ?? "Former member") : null,
      links: refs.map((r) => ({ url: r.url, card: cards.get(cardKey(r)) })),
      events: events.map((e: { id: string; kind: string; actorId: string | null; from: unknown; to: unknown; createdAt: Date }) => ({ ...e, actor: e.actorId ? (names[e.actorId] ?? "Former member") : null, ...(e.kind === "assignee" ? { fromName: typeof e.from === "string" ? names[e.from] : null, toName: typeof e.to === "string" ? names[e.to] : null } : {}) })),
      comments: comments.map((c: { id: string; authorId: string; body: string; deletedAt: Date | null; editedAt: Date | null; createdAt: Date }) => ({ id: c.id, authorId: c.authorId, author: names[c.authorId] ?? "Former member", body: c.deletedAt ? "" : c.body, deleted: !!c.deletedAt, editedAt: c.editedAt, createdAt: c.createdAt })),
      canDelete: m.isAdmin || i.createdById === m.userId,
      writable: lim.enabled && lim.maxChannels > 0,
    });
  });

  const updateIssueBody = z.object({ title: fields.title.optional(), body: fields.body.optional(), status: fields.status.optional(), priority: fields.priority.optional(), assigneeId: fields.assigneeId.optional(), labels: fields.labels.optional(), dueDate: fields.dueDate.optional(), links: fields.links.optional() });
  fastify.patch("/:accountId/issues/:n", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "team:write", apiDoc: { summary: "Update an issue", description: "Any of title, body, status, priority, assignee, labels, due date and links.", body: updateIssueBody }, rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, n } = numParams.parse(request.params);
    const b = updateIssueBody.parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const before = await find(accountId, n);
    await assignable(accountId, b.assigneeId);
    const data: Record<string, unknown> = {};
    const events: Array<{ kind: string; from: unknown; to: unknown }> = [];
    const change = (kind: string, from: unknown, to: unknown, set: Record<string, unknown>) => {
      if (JSON.stringify(from) === JSON.stringify(to)) return;
      Object.assign(data, set);
      events.push({ kind, from, to });
    };
    if (b.title !== undefined) change("title", before.title, b.title, { title: b.title });
    if (b.status !== undefined && b.status !== before.status) {
      change("status", before.status, b.status, { status: b.status, rank: rankBetween(await lastRank(accountId, b.status), null), closedAt: CLOSED.includes(b.status) ? new Date() : null });
    }
    if (b.priority !== undefined) change("priority", before.priority, b.priority, { priority: b.priority });
    if (b.assigneeId !== undefined) change("assignee", before.assigneeId, b.assigneeId, { assigneeId: b.assigneeId });
    if (b.labels !== undefined) change("labels", before.labels, b.labels, { labels: b.labels });
    if (b.dueDate !== undefined) change("due", day(before.dueDate), b.dueDate, { dueDate: b.dueDate ? new Date(b.dueDate) : null });
    if (b.body !== undefined && b.body !== before.body) {
      data.body = b.body;
      events.push({ kind: "body", from: null, to: null });
    }
    if (b.links !== undefined || b.body !== undefined) {
      const refs = refsFrom(accountId, b.links, b.body ?? before.body, (before.refs as TeamRef[]) ?? [], before.body);
      change("links", ((before.refs as TeamRef[]) ?? []).length, refs.length, { refs });
    }
    if (!events.length) return successResponse(reply, "Nothing changed", 200, view(before, {}));
    const issue = (await db.teamIssue.update({ where: { id: before.id }, data: { ...data, events: { create: events.map((e) => ({ accountId, actorId: m.userId, kind: e.kind, from: e.from as never, to: e.to as never })) } } })) as Issue;
    if (b.assigneeId !== undefined && b.assigneeId !== before.assigneeId) await notifyAssignee(accountId, m.userId, issue);
    if (b.body !== undefined) await notifyMentions(accountId, m.userId, issue, before.body);
    // The assignee hears about status changes made by others (a new assignee already got "assigned you").
    const reassigned = b.assigneeId !== undefined && b.assigneeId !== before.assigneeId;
    if (b.status !== undefined && b.status !== before.status && issue.assigneeId && issue.assigneeId !== m.userId && !reassigned) {
      const names = await t.names([m.userId]);
      await t.notify(accountId, m.userId, [issue.assigneeId], { type: "TEAM_REPLY", title: `${names[m.userId]} moved #${issue.number} to ${ISSUE_STATUS_LABEL[issue.status]}`, body: issue.title, path: `/organizations/${accountId}/team/issues/${issue.number}`, metadata: { issueNumber: issue.number } });
    }
    await t.emit(accountId, "issue", { number: issue.number });
    return successResponse(reply, "Saved", 200, view(issue, await t.names(issue.assigneeId ? [issue.assigneeId] : [])));
  });

  const moveIssueBody = z.object({ status: fields.status, before: z.number().int().min(1).nullable().optional(), after: z.number().int().min(1).nullable().optional() });
  fastify.post("/:accountId/issues/:n/move", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: "team:write", apiDoc: { summary: "Move an issue on the board", description: "To a status column, between two issues (their numbers).", body: moveIssueBody }, rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, n } = numParams.parse(request.params);
    const b = moveIssueBody.parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const issue = await find(accountId, n);
    const neighbour = async (num: number | null | undefined) => {
      if (!num || num === n) return null;
      const x = await db.teamIssue.findUnique({ where: { accountId_number: { accountId, number: num } }, select: { rank: true, status: true } });
      return x && x.status === b.status ? x.rank : null;
    };
    const above = await neighbour(b.before);
    let below = await neighbour(b.after);
    if (above && below && above >= below) below = null; // stale client order: put it right after "above"
    let rank: string;
    try {
      rank = rankBetween(above, below ?? (above ? (await db.teamIssue.findFirst({ where: { accountId, status: b.status, rank: { gt: above }, NOT: { id: issue.id } }, orderBy: { rank: "asc" }, select: { rank: true } }))?.rank : null));
    } catch {
      rank = rankBetween(await lastRank(accountId, b.status), null);
    }
    const statusChanged = b.status !== issue.status;
    const updated = (await db.teamIssue.update({
      where: { id: issue.id },
      data: {
        rank,
        ...(statusChanged ? { status: b.status, closedAt: CLOSED.includes(b.status) ? new Date() : null, events: { create: { accountId, actorId: m.userId, kind: "status", from: issue.status, to: b.status } } } : {}),
      },
    })) as Issue;
    if (statusChanged && updated.assigneeId && updated.assigneeId !== m.userId) {
      const names = await t.names([m.userId]);
      await t.notify(accountId, m.userId, [updated.assigneeId], { type: "TEAM_REPLY", title: `${names[m.userId]} moved #${updated.number} to ${ISSUE_STATUS_LABEL[updated.status]}`, body: updated.title, path: `/organizations/${accountId}/team/issues/${updated.number}`, metadata: { issueNumber: updated.number } });
    }
    await t.emit(accountId, "issue", { number: n });
    return successResponse(reply, "Moved", 200, view(updated, {}));
  });

  fastify.delete("/:accountId/issues/:n", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, n } = numParams.parse(request.params);
    const m = await t.member(request, accountId);
    const i = await find(accountId, n);
    if (!m.isAdmin && i.createdById !== m.userId) throw new ForbiddenError("Only the creator and owners/admins can delete an issue");
    await db.$transaction([db.teamComment.deleteMany({ where: { targetKind: "issue", targetId: i.id } }), db.teamIssue.delete({ where: { id: i.id } })]);
    await t.emit(accountId, "issue", { number: n, deleted: true });
    return successResponse(reply, `Deleted #${n}`, 200, { number: n });
  });
}
