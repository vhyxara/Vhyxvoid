// Evaluates alert rules once a minute (one API instance at a time, job lease
// "alerts"). State rules notify when a subject starts firing and when it
// recovers; event rules (INBOX_FAILED) notify about what happened since the
// last evaluation. DOMAIN events are emitted by the domain checker directly.
import type { PrismaClient } from "@/generated/prisma";
import {
  ALERT_DEFAULTS,
  currentPlanOverrides,
  diffAlertStates,
  errorRateSubjects,
  getEffectivePlanLimitsForAccount,
  offlineSubjects,
  readSetting,
  usageSubject,
  type TunnelPresence,
} from "@vhyxvoid/shared";
import type { AlertRuleRow, AlertService } from "./alerts.service";

const PRESENCE_LOOKBACK_DAYS = 30;

type Rule = AlertRuleRow & { cursorAt: Date | null; createdAt: Date };

export async function runAlertEvaluation(prisma: PrismaClient, alerts: AlertService, now = Date.now()): Promise<{ rules: number; notified: number }> {
  if (!(await readSetting("features.alerts"))) return { rules: 0, notified: 0 };
  const rules = (await prisma.alertRule.findMany({
    where: { enabled: true, type: { in: ["TUNNEL_OFFLINE", "ERROR_RATE", "USAGE", "INBOX_FAILED"] }, account: { status: { notIn: ["DELETED", "SUSPENDED"] } } },
  })) as unknown as Rule[];
  let notified = 0;

  const presenceCache = new Map<string, TunnelPresence[]>();
  const presence = async (accountId: string) => {
    if (!presenceCache.has(accountId)) presenceCache.set(accountId, await tunnelPresence(prisma, accountId, now));
    return presenceCache.get(accountId)!;
  };

  for (const rule of rules) {
    try {
      if (rule.type === "INBOX_FAILED") {
        notified += await inboxFailed(prisma, alerts, rule, now);
        continue;
      }
      let firing: Array<{ subject: string; title: string; message: string; path: string; detail?: unknown }> = [];
      const base = `/organizations/${rule.accountId}`;
      if (rule.type === "TUNNEL_OFFLINE") {
        const tunnels = await presence(rule.accountId);
        const minutes = rule.windowMinutes ?? ALERT_DEFAULTS.TUNNEL_OFFLINE.windowMinutes;
        firing = offlineSubjects(rule, tunnels, now).map((label) => ({
          subject: label,
          title: `Tunnel ${label} is offline`,
          message: `The agent for ${label} disconnected and has not been back for ${minutes} minute${minutes === 1 ? "" : "s"}. Public requests to it fail until it reconnects (webhooks are kept if its inbox is on).`,
          path: `${base}/tunnels`,
        }));
      } else if (rule.type === "ERROR_RATE") {
        const minutes = rule.windowMinutes ?? ALERT_DEFAULTS.ERROR_RATE.windowMinutes;
        const rows = await prisma.tunnelMinuteStat.groupBy({
          by: ["label"],
          where: { accountId: rule.accountId, minute: { gte: new Date(now - minutes * 60_000) }, ...(rule.label ? { label: rule.label } : {}) },
          _sum: { requests: true, errors5xx: true },
        });
        firing = errorRateSubjects(
          rule,
          rows.map((r) => ({ label: r.label, requests: r._sum.requests ?? 0, errors5xx: r._sum.errors5xx ?? 0 })),
        ).map((s) => ({
          subject: s.label,
          title: `${s.rate}% server errors on ${s.label}`,
          message: `${s.errors} of ${s.requests} requests to ${s.label} got a 5xx answer in the last ${minutes} minutes (alert at ${rule.threshold ?? ALERT_DEFAULTS.ERROR_RATE.threshold}%).`,
          path: `${base}/inspector`,
          detail: s,
        }));
      } else if (rule.type === "USAGE") {
        const monthStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));
        const [usage, limits] = await Promise.all([
          prisma.usageAggregate.aggregate({ _sum: { quantity: true }, where: { accountId: rule.accountId, metric: "requests", periodStart: { gte: monthStart } } }),
          getEffectivePlanLimitsForAccount(prisma as never, rule.accountId, await currentPlanOverrides()),
        ]);
        const used = Number(usage._sum.quantity ?? 0);
        const hit = usageSubject(rule, used, limits.maxRequestsPerMonth, now);
        if (hit) {
          firing = [
            {
              subject: hit.subject,
              title: `${hit.percent}% of this month's requests used`,
              message: `${used.toLocaleString("en-US")} of ${limits.maxRequestsPerMonth.toLocaleString("en-US")} requests included in the plan have been used this month.`,
              path: `${base}/billing`,
            },
          ];
        }
      }

      const previous = await prisma.alertState.findMany({ where: { ruleId: rule.id } });
      const { fire, resolve } = diffAlertStates(previous, firing.map((f) => f.subject));
      for (const subject of fire) {
        const f = firing.find((x) => x.subject === subject)!;
        await prisma.alertState.upsert({
          where: { ruleId_subject: { ruleId: rule.id, subject } },
          create: { ruleId: rule.id, subject, firing: true, since: new Date(now), detail: (f.detail ?? null) as never },
          update: { firing: true, since: new Date(now), detail: (f.detail ?? null) as never },
        });
        await alerts.notify(rule, { kind: "FIRING", subject, title: f.title, message: f.message, path: f.path });
        notified++;
      }
      for (const subject of resolve) {
        const state = previous.find((p) => p.subject === subject)!;
        await prisma.alertState.update({ where: { id: state.id }, data: { firing: false, since: new Date(now) } });
        // A usage period simply ends; nothing to announce.
        if (rule.type === "USAGE") continue;
        const minutes = Math.max(1, Math.round((now - state.since.getTime()) / 60_000));
        await alerts.notify(rule, {
          kind: "RESOLVED",
          subject,
          title: rule.type === "TUNNEL_OFFLINE" ? `Tunnel ${subject} is back online` : `Errors on ${subject} are back to normal`,
          message: `Resolved after about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
          path: `${base}/${rule.type === "TUNNEL_OFFLINE" ? "tunnels" : "inspector"}`,
        });
        notified++;
      }
    } catch (err) {
      console.error({ err: (err as Error).message, ruleId: rule.id }, "[alerts] rule evaluation failed");
    }
  }
  return { rules: rules.length, notified };
}

/** Per label: is an agent connected, and when did the last connection end. */
async function tunnelPresence(prisma: PrismaClient, accountId: string, now: number): Promise<TunnelPresence[]> {
  const rows = await prisma.tunnelSession.groupBy({
    by: ["label", "status"],
    where: {
      accountId,
      OR: [{ status: "CONNECTED" }, { disconnectedAt: { gte: new Date(now - PRESENCE_LOOKBACK_DAYS * 86_400_000) } }],
    },
    _max: { disconnectedAt: true },
  });
  const byLabel = new Map<string, TunnelPresence>();
  for (const r of rows) {
    const t = byLabel.get(r.label) ?? { label: r.label, connected: false, lastDisconnectedAt: null };
    if (r.status === "CONNECTED") t.connected = true;
    else if (r._max.disconnectedAt && (!t.lastDisconnectedAt || r._max.disconnectedAt > t.lastDisconnectedAt)) t.lastDisconnectedAt = r._max.disconnectedAt;
    byLabel.set(r.label, t);
  }
  return [...byLabel.values()];
}

/** Webhooks that failed for good since the rule last looked. One notification per evaluation. */
async function inboxFailed(prisma: PrismaClient, alerts: AlertService, rule: Rule, now: number): Promise<number> {
  const since = rule.cursorAt ?? rule.createdAt;
  const failed = await prisma.inboxRequest.findMany({
    where: { accountId: rule.accountId, status: "FAILED", updatedAt: { gt: since, lte: new Date(now) }, ...(rule.label ? { label: rule.label } : {}) },
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: { label: true, method: true, path: true, lastError: true, updatedAt: true },
  });
  const cursor = failed.length === 50 ? failed[49].updatedAt : new Date(now);
  await prisma.alertRule.update({ where: { id: rule.id }, data: { cursorAt: cursor } });
  if (!failed.length) return 0;
  const first = failed[0];
  const more = failed.length > 1 ? ` and ${failed.length - 1} more` : "";
  await alerts.notify(rule, {
    kind: "EVENT",
    subject: first.label,
    title: `${failed.length} webhook${failed.length === 1 ? "" : "s"} could not be delivered`,
    message: `${first.method} ${first.path} on ${first.label}${more} gave up after repeated attempts. Last error: ${first.lastError ?? "unknown"}. You can redeliver them from the webhook inbox.`,
    path: `/organizations/${rule.accountId}/inbox`,
  });
  return 1;
}
