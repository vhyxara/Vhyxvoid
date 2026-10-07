// Monitors (phase 4): scheduled runs of an API client collection. The
// "monitors" job (one API instance at a time) runs the due monitors every
// minute, five at a time, each capped at 60 s, through the same SSRF-guarded
// runner as the dashboard. A result is stored per check (the report only when
// it failed); MONITOR alert rules read consecutiveFailures.
//
// Monitor sends don't use the interactive apiClientSendsPerMinute budget; the
// plan bounds them through maxMonitors and minMonitorIntervalMinutes.
import type { PrismaClient } from "@/generated/prisma";
import { API_CLIENT_BOUNDS, nextMonitorRun, readSetting, runCollection, type ApiAuth, type ApiCollection, type ApiFolder, type ApiRequest, type ApiVariable, type RunReport } from "@vhyxvoid/shared";
import { guardedSend } from "../apiclient/runner";
import { decryptSecret } from "../apiclient/secrets";
import { reapStaleLoadTests } from "./loadRunner";

const RESULT_RETENTION_DAYS = 30;
const RUN_DEADLINE_MS = 60_000;
const CONCURRENCY = 5;
const PER_TICK = 100;

type Monitor = { id: string; accountId: string; name: string; collectionId: string; environmentId: string | null; folderId: string | null; intervalMinutes: number; consecutiveFailures: number };

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The first thing that went wrong, for the monitor list and the alert. */
export function firstProblem(report: RunReport): string | null {
  if (report.total === 0) return "The collection (or folder) has no requests";
  const bad = report.results.find((r) => r.outcome === "failed" || r.outcome === "errored");
  if (!bad) return null;
  if (bad.outcome === "errored") return `${bad.name}: ${bad.error ?? "could not be sent"}`;
  const check = bad.assertions.find((a) => !a.pass);
  return `${bad.name}: ${check ? `${check.label} (${check.message})` : `answered ${bad.status}`}`;
}

/** Runs one monitor now and records the result. */
export async function runMonitor(prisma: PrismaClient, m: Monitor, now = Date.now()) {
  const db = prisma as unknown as { apiCollection: any; apiEnvironment: any; apiMonitor: any; apiMonitorResult: any };
  const col = await db.apiCollection.findFirst({ where: { id: m.collectionId, accountId: m.accountId } });
  const env = m.environmentId ? await db.apiEnvironment.findFirst({ where: { id: m.environmentId, accountId: m.accountId } }) : null;
  let report: RunReport;
  if (!col) {
    report = { collection: "(deleted)", startedAt: new Date(now).toISOString(), durationMs: 0, total: 0, passed: 0, failed: 0, errored: 0, skipped: 0, assertions: { passed: 0, failed: 0 }, results: [] };
  } else {
    const collection: ApiCollection = { name: col.name, description: col.description, auth: (col.auth as ApiAuth) ?? { type: "none" }, variables: arr<ApiVariable>(col.variables), folders: arr<ApiFolder>(col.folders), requests: arr<ApiRequest>(col.requests) };
    const environment = env ? arr<ApiVariable>(env.variables).map((v) => (v.secret ? { ...v, value: decryptSecret(v.value) } : v)) : undefined;
    report = await runCollection({
      collection,
      environment,
      environmentName: env?.name,
      folderId: m.folderId ?? undefined,
      deadlineMs: RUN_DEADLINE_MS,
      send: (built) => guardedSend(built, { timeoutMs: API_CLIENT_BOUNDS.timeoutMs, maxBytes: 1_000_000, followRedirects: 0 }),
    });
  }
  const ok = report.total > 0 && report.failed === 0 && report.errored === 0;
  const problem = col ? firstProblem(report) : "The collection was deleted";
  // Failure reports keep what explains the failure; response previews are cut.
  const stored = ok ? null : { ...report, results: report.results.map((r) => ({ ...r, responsePreview: r.responsePreview?.slice(0, 1000) })) };
  await db.apiMonitorResult.create({ data: { monitorId: m.id, accountId: m.accountId, at: new Date(now), ok, total: report.total, passed: report.passed, failed: report.failed, errored: report.errored, durationMs: report.durationMs, report: stored as never } });
  const failures = ok ? 0 : m.consecutiveFailures + 1;
  await db.apiMonitor.update({
    where: { id: m.id },
    data: { status: ok ? "UP" : "DOWN", consecutiveFailures: failures, lastRunAt: new Date(now), nextRunAt: nextMonitorRun(m.intervalMinutes, Math.max(now, Date.now())), lastDurationMs: report.durationMs, lastError: ok ? null : (problem ?? "failed").slice(0, 500) },
  });
  return { ok, report, failures };
}

let lastCleanup = 0;

/** The job: runs due monitors; hourly, drops old results and reaps stuck load tests. */
export async function runDueMonitors(prisma: PrismaClient, now = Date.now()): Promise<{ ran: number; failed: number }> {
  const db = prisma as unknown as { apiMonitor: any; apiMonitorResult: any; loadTest: any; customDomain: any; account: any };
  if (now - lastCleanup > 3_600_000) {
    lastCleanup = now;
    await db.apiMonitorResult.deleteMany({ where: { at: { lt: new Date(now - RESULT_RETENTION_DAYS * 86_400_000) } } }).catch(() => undefined);
  }
  await reapStaleLoadTests(db, now).catch(() => 0);
  if (!(await readSetting("features.performance"))) return { ran: 0, failed: 0 };
  const due: Monitor[] = await db.apiMonitor.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date(now) }, account: { status: { notIn: ["DELETED", "SUSPENDED"] } } },
    orderBy: { nextRunAt: "asc" },
    take: PER_TICK,
  });
  let ran = 0;
  let failed = 0;
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((m) => runMonitor(prisma, m, Date.now())));
    for (const [j, r] of results.entries()) {
      ran++;
      if (r.status === "rejected") {
        failed++;
        console.error({ err: (r.reason as Error)?.message, monitorId: batch[j].id }, "[monitors] run failed");
        // Don't retry a broken monitor every minute.
        await db.apiMonitor.update({ where: { id: batch[j].id }, data: { nextRunAt: nextMonitorRun(batch[j].intervalMinutes, Date.now()) } }).catch(() => undefined);
      } else if (!r.value.ok) failed++;
    }
  }
  return { ran, failed };
}
