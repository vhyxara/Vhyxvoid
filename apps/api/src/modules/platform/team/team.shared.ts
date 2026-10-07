// Helpers shared by the team space routes (chat, docs, issues) and its jobs:
// workspace access and limits, realtime events, notifications for mentions,
// replies and assignments, and turning dashboard links into rich cards.
import type { FastifyInstance, FastifyRequest } from "fastify";

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError } from "@/core/errors/error.format";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import type { NotificationService } from "@/modules/notification/application/use-cases";
import { NotificationType } from "@/modules/notification/domain/enums";
import { currentPlanOverrides, docOutline, getEffectivePlanLimitsForAccount, ISSUE_STATUS_LABEL, refPath, type IssueStatus, type TeamEventKind, type TeamRef } from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";

// The generated client is typed; these routes use a few raw shapes, so keep it loose here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export type Member = { userId: string; level: number; isAdmin: boolean; accountName: string };

export function teamContext(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const db = prisma as Db;
  const notifications = () => (fastify as unknown as { notificationService?: NotificationService }).notificationService;

  async function member(request: FastifyRequest, accountId: string): Promise<Member> {
    const user = getUserContext(request);
    const m = await db.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true, account: { select: { name: true } } } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return { userId: user.id, level: m.roleLevel, isAdmin: m.roleLevel >= RoleLevel.ADMIN, accountName: m.account?.name ?? "your workspace" };
  }

  async function limits(accountId: string) {
    const [enabled, l] = await Promise.all([fastify.platformSettings.get("features.teamSpace"), getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides())]);
    const fin = (n: number, cap: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : cap);
    return {
      enabled: Boolean(enabled),
      maxChannels: fin(l.maxTeamChannels, 100_000),
      maxDocs: fin(l.maxTeamDocs, 1_000_000),
      maxIssues: fin(l.maxTeamIssues, 1_000_000),
      /** null = all history */
      historyDays: Number.isFinite(l.teamHistoryDays) ? Math.max(1, Math.floor(l.teamHistoryDays)) : null,
      plan: l.plan,
    };
  }

  /** Writes refuse when the platform switch is off or the plan has no team space (maxTeamChannels 0). */
  async function writable(accountId: string) {
    const lim = await limits(accountId);
    if (!lim.enabled) throw new ForbiddenError("The team space is switched off on this platform right now; it is read-only");
    if (lim.maxChannels === 0) throw new ForbiddenError("The team space isn't included in your plan");
    return lim;
  }

  const historyCutoff = (days: number | null) => (days ? new Date(Date.now() - days * 86_400_000) : new Date(0));

  /** Records a realtime event; every API instance's poller pushes it to its sockets. */
  async function emit(accountId: string, kind: TeamEventKind, payload: Record<string, unknown>, userIds: string[] = []) {
    await db.teamEvent.create({ data: { accountId, kind, payload: payload as never, userIds } }).catch((err: Error) => fastify.log.warn({ err }, "[team] event not recorded"));
  }

  async function people(accountId: string): Promise<Array<{ id: string; name: string; email: string; level: number }>> {
    const rows = await db.accountMember.findMany({ where: { accountId }, select: { roleLevel: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "asc" } });
    return rows.map((r: { roleLevel: number; user: { id: string; firstName: string; lastName: string; email: string } }) => ({ id: r.user.id, name: `${r.user.firstName} ${r.user.lastName}`.trim() || r.user.email.split("@")[0], email: r.user.email, level: r.roleLevel }));
  }

  /**
   * In-app notifications (the bell); the email digest picks unread ones up
   * later. Only workspace members, never the actor, one per user.
   */
  async function notify(accountId: string, actorId: string, userIds: string[], n: { type: "TEAM_MENTION" | "TEAM_ASSIGNED" | "TEAM_REPLY"; title: string; body: string; path: string; metadata?: Record<string, unknown> }) {
    const targets = [...new Set(userIds)].filter((u) => u !== actorId);
    if (!targets.length) return 0;
    const allowed = new Set((await db.accountMember.findMany({ where: { accountId, userId: { in: targets } }, select: { userId: true } })).map((m: { userId: string }) => m.userId));
    const svc = notifications();
    let sent = 0;
    for (const userId of targets.filter((u) => allowed.has(u))) {
      const params = { userId, accountId, type: NotificationType[n.type], title: n.title.slice(0, 200), body: n.body.slice(0, 500), actionUrl: n.path, metadata: { team: true, actorId, ...(n.metadata ?? {}) } };
      try {
        if (svc) await svc.createInApp.execute(params);
        else await db.notification.create({ data: { ...params, type: n.type } });
        sent++;
      } catch (err) {
        fastify.log.warn({ err }, "[team] notification not created");
      }
    }
    return sent;
  }

  /** Display names of user ids, for messages and notifications. */
  async function names(ids: string[]): Promise<Record<string, string>> {
    if (!ids.length) return {};
    const users = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, firstName: true, lastName: true, email: true } });
    return Object.fromEntries(users.map((u: { id: string; firstName: string; lastName: string; email: string }) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email.split("@")[0]]));
  }

  return { prisma, db, member, limits, writable, historyCutoff, emit, people, notify, names };
}

// ── Rich cards ───────────────────────────────────────────────────────────────

export interface TeamCard {
  kind: TeamRef["kind"];
  /** Dashboard path to open it */
  href: string;
  title: string;
  subtitle: string;
  /** Short state shown as a badge (status, method, version…) */
  badge?: string;
  /** The object is gone or not visible to this user. */
  missing?: boolean;
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

/**
 * Cards for references, resolved in one query per kind, only inside the
 * workspace (a link to another workspace never reveals anything).
 */
export async function resolveCards(db: Db, accountId: string, userId: string, refs: TeamRef[]): Promise<Map<string, TeamCard>> {
  const out = new Map<string, TeamCard>();
  const mine = refs.filter((r) => r.accountId === accountId.toLowerCase());
  const key = (r: Pick<TeamRef, "kind" | "id" | "sub">) => `${r.kind}|${r.id}|${r.sub ?? ""}`;
  const ids = (kinds: TeamRef["kind"][]) => [...new Set(mine.filter((r) => kinds.includes(r.kind)).map((r) => r.id))];
  const missing = (r: TeamRef, title: string): TeamCard => ({ kind: r.kind, href: refPath(r), title, subtitle: "Not found in this workspace", missing: true });

  const [mocks, collections, runs, monitors, specs, docs, issues, channels] = await Promise.all([
    ids(["mock", "mockEndpoint"]).length ? db.mockApi.findMany({ where: { accountId, id: { in: ids(["mock", "mockEndpoint"]) } }, select: { id: true, name: true, label: true, endpoints: true } }) : [],
    ids(["collection", "request"]).length ? db.apiCollection.findMany({ where: { accountId, id: { in: ids(["collection", "request"]) } }, select: { id: true, name: true, requests: true } }) : [],
    ids(["loadTest"]).length ? db.loadTest.findMany({ where: { accountId, id: { in: ids(["loadTest"]) } }, select: { id: true, name: true, status: true, target: true, summary: true } }) : [],
    ids(["monitor"]).length ? db.apiMonitor.findMany({ where: { accountId, id: { in: ids(["monitor"]) } }, select: { id: true, name: true, status: true, intervalMinutes: true } }) : [],
    ids(["spec", "specOperation"]).length ? db.apiSpec.findMany({ where: { accountId, id: { in: ids(["spec", "specOperation"]) } }, select: { id: true, name: true, versions: { orderBy: { number: "desc" }, take: 1, select: { number: true, version: true } } } }) : [],
    ids(["doc"]).length ? db.teamDoc.findMany({ where: { accountId, id: { in: ids(["doc"]) } }, select: { id: true, title: true, body: true, updatedAt: true } }) : [],
    ids(["issue"]).length ? db.teamIssue.findMany({ where: { accountId, number: { in: ids(["issue"]).map(Number) } }, select: { number: true, title: true, status: true, assigneeId: true } }) : [],
    ids(["channel"]).length ? db.teamChannel.findMany({ where: { accountId, id: { in: ids(["channel"]) } }, select: { id: true, name: true, kind: true, isPrivate: true, topic: true, members: { where: { userId }, select: { userId: true } } } }) : [],
  ]);
  const by = <T extends Row>(rows: T[], k = "id") => new Map(rows.map((r) => [String(r[k]), r]));
  const M = by(mocks);
  const C = by(collections);
  const L = by(runs);
  const MO = by(monitors);
  const S = by(specs);
  const D = by(docs);
  const I = by(issues, "number");
  const CH = by(channels);

  for (const r of mine) {
    const href = refPath(r);
    let card: TeamCard;
    switch (r.kind) {
      case "mock":
      case "mockEndpoint": {
        const m = M.get(r.id);
        if (!m) {
          card = missing(r, "Mock API");
          break;
        }
        const ep = r.kind === "mockEndpoint" ? arr(m.endpoints).find((e) => e.id === r.sub) : undefined;
        card = ep
          ? { kind: r.kind, href, title: `${ep.method} ${ep.path}`, subtitle: `Endpoint of the mock API ${m.name}`, badge: ep.enabled === false ? "off" : `${arr(ep.responses).length} responses` }
          : { kind: r.kind, href, title: m.name, subtitle: `Mock API · ${arr(m.endpoints).length} endpoints`, badge: m.label };
        break;
      }
      case "collection":
      case "request": {
        const c = C.get(r.id);
        if (!c) {
          card = missing(r, "Collection");
          break;
        }
        const q = r.kind === "request" ? arr(c.requests).find((x) => x.id === r.sub) : undefined;
        card = q
          ? { kind: r.kind, href, title: q.name || `${q.method} ${q.url}`, subtitle: `${q.method} ${String(q.url).slice(0, 120)} · in ${c.name}`, badge: q.method }
          : { kind: r.kind, href, title: c.name, subtitle: `API client collection · ${arr(c.requests).length} requests` };
        break;
      }
      case "inspector":
        card = { kind: r.kind, href, title: "Captured request", subtitle: `Request inspector · tunnel ${r.sub}` };
        break;
      case "loadTest": {
        const t = L.get(r.id);
        const s = t?.summary as Row | null;
        card = t
          ? { kind: r.kind, href, title: t.name, subtitle: s ? `${s.requests} requests · ${Math.round(s.rps)}/s · p95 ${Math.round(s.latency?.p95 ?? 0)} ms · ${s.errorRate}% errors` : `Load test of ${t.target}`, badge: String(t.status).toLowerCase() }
          : missing(r, "Load test");
        break;
      }
      case "monitor": {
        const m = MO.get(r.id);
        card = m ? { kind: r.kind, href, title: m.name, subtitle: `Monitor · every ${m.intervalMinutes} min`, badge: String(m.status).toLowerCase() } : missing(r, "Monitor");
        break;
      }
      case "spec":
      case "specOperation": {
        const s = S.get(r.id);
        const v = s?.versions?.[0];
        card = s
          ? { kind: r.kind, href, title: r.kind === "specOperation" ? `${s.name}: ${r.sub}` : s.name, subtitle: v ? `API docs · v${v.number}${v.version ? ` (${v.version})` : ""}` : "API docs · not published", badge: r.kind === "specOperation" ? "operation" : undefined }
          : missing(r, "API docs");
        break;
      }
      case "doc": {
        const d = D.get(r.id);
        if (!d) {
          card = missing(r, "Document");
          break;
        }
        const section = r.sub ? docOutline(d.body).find((h) => h.anchor === r.sub) : undefined;
        card = { kind: r.kind, href, title: section ? `${d.title} › ${section.text}` : d.title, subtitle: `Document · updated ${new Date(d.updatedAt).toISOString().slice(0, 10)}` };
        break;
      }
      case "issue": {
        const i = I.get(r.id);
        card = i ? { kind: r.kind, href, title: `#${i.number} ${i.title}`, subtitle: "Issue", badge: ISSUE_STATUS_LABEL[i.status as IssueStatus] ?? i.status } : missing(r, `Issue #${r.id}`);
        break;
      }
      case "channel": {
        const ch = CH.get(r.id);
        const visible = ch && (ch.kind === "CHANNEL" && !ch.isPrivate ? true : ch.members.length > 0);
        card = visible ? { kind: r.kind, href, title: ch.kind === "DM" ? "Direct message" : `#${ch.name}`, subtitle: ch.topic || "Channel" } : missing(r, "Channel");
        break;
      }
    }
    out.set(key(r), card);
  }
  return out;
}

export const cardKey = (r: Pick<TeamRef, "kind" | "id" | "sub">) => `${r.kind}|${r.id}|${r.sub ?? ""}`;
