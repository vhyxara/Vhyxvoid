// Runs load tests (phase 4) inside the API process, with hard caps.
//
// Safety: a load test can only target the workspace's own tunnels, mock APIs
// and verified custom domains (targetFor), and every request goes to OUR hub
// (HUB_INTERNAL_URL) with the target's Host header, never to the URL's DNS
// answer, so the platform can't be pointed at anyone else. The hub lets it
// past the per-minute abuse limit only because it carries the internal secret
// and the load-test marker; the plan's maxLoadTestRps paces it instead.
//
// Progress (timeline + running summary) is written every second for the live
// chart; cancel is read from the row every 2 s; at most
// LOAD_TEST_MAX_CONCURRENT run per API instance.
import http from "node:http";
import https from "node:https";
import os from "node:os";

import { readSetting, runLoadTest, type LoadSample, type LoadTestConfig, type LoadTimelinePoint } from "@vhyxvoid/shared";

type Db = { loadTest: any; customDomain: any; account: any };

export const LOAD_TEST_HEADER = "x-vhyxvoid-load-test";
const instance = `${os.hostname()}:${process.pid}`;
const running = new Map<string, { stop: (why: string) => void }>();

export const maxConcurrent = () => Math.max(1, Number(process.env.LOAD_TEST_MAX_CONCURRENT ?? 3) || 3);
export const runningHere = () => running.size;

export interface LoadTarget {
  host: string;
  path: string;
  kind: "tunnel" | "domain";
  label: string;
}

/** The target if the URL is one of the account's tunnels/mocks or verified custom domains; else a refusal. */
export async function targetFor(db: Db, accountId: string, raw: string, hubDomain: string): Promise<LoadTarget | { problem: string }> {
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { problem: "Not a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { problem: "Use an http(s) URL" };
  if (u.username || u.password) return { problem: "Leave credentials out of the URL; add a header instead" };
  const host = u.hostname.toLowerCase();
  const path = (u.pathname || "/") + u.search;
  const suffix = `.${hubDomain.toLowerCase()}`;
  const refusal = { problem: "Load tests can target only this workspace's tunnels, mock APIs and verified custom domains" };
  if (host.endsWith(suffix)) {
    const sub = host.slice(0, -suffix.length);
    const account = await db.account.findUnique({ where: { id: accountId }, select: { slug: true } });
    const m = /^([a-z0-9-]+?)--([a-z0-9-]+)$/.exec(sub);
    if (!account?.slug || !m || m[1] !== account.slug) return refusal;
    return { host, path, kind: "tunnel", label: m[2] };
  }
  const domain = await db.customDomain.findFirst({ where: { accountId, hostname: host, verifiedAt: { not: null } }, select: { label: true } });
  if (!domain) return refusal;
  return { host, path, kind: "domain", label: domain.label };
}

/** One request to the hub with the target's Host; never rejects. */
function sender(hubUrl: string, target: LoadTarget, config: LoadTestConfig, testId: string, secret: string) {
  const hub = new URL(hubUrl);
  const mod = hub.protocol === "https:" ? https : http;
  const agent = new mod.Agent({ keepAlive: true, maxSockets: config.vus, maxFreeSockets: config.vus });
  const body = config.request.body ? Buffer.from(config.request.body) : undefined;
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of config.request.headers) {
    const name = k.toLowerCase();
    if (["host", "content-length", "connection", "transfer-encoding", "x-vhyxvoid-internal", LOAD_TEST_HEADER].includes(name)) continue;
    headers[k] = v;
  }
  Object.assign(headers, { host: target.host, "x-vhyxvoid-internal": secret, [LOAD_TEST_HEADER]: testId, "user-agent": headers["user-agent"] ?? "VhyxVoid-LoadTest/1" });
  if (body) headers["content-length"] = String(body.length);
  const send = (): Promise<LoadSample> =>
    new Promise((resolve) => {
      const t0 = performance.now();
      let done = false;
      const finish = (s: LoadSample) => {
        if (done) return;
        done = true;
        resolve(s);
      };
      const req = mod.request({ host: hub.hostname, port: hub.port || (hub.protocol === "https:" ? 443 : 80), method: config.request.method, path: target.path, headers, agent, timeout: 30_000 }, (res) => {
        let bytes = 0;
        res.on("data", (c: Buffer) => (bytes += c.length));
        res.on("end", () => finish({ status: res.statusCode ?? 0, ms: performance.now() - t0, bytes }));
        res.on("error", () => finish({ status: 0, ms: performance.now() - t0, error: "connection reset" }));
      });
      req.on("timeout", () => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
      req.on("error", (e: NodeJS.ErrnoException) => finish({ status: 0, ms: performance.now() - t0, error: e.code === "ETIMEDOUT" ? "timeout (30 s)" : e.code === "ECONNREFUSED" ? "connection refused" : e.code === "ECONNRESET" ? "connection reset" : (e.code ?? e.message).slice(0, 60) }));
      req.end(body);
    });
  return { send, close: () => agent.destroy() };
}

/** Starts a load test in the background; the row must exist with status RUNNING. */
export function startLoadTest(db: Db, row: { id: string; accountId: string }, target: LoadTarget, config: LoadTestConfig): void {
  const hubUrl = process.env.HUB_INTERNAL_URL ?? "";
  const secret = process.env.HUB_INTERNAL_SECRET ?? "";
  let stopReason: string | null = null;
  running.set(row.id, { stop: (why) => (stopReason ??= why) });
  const s = sender(hubUrl, target, config, row.id, secret);
  let lastCheck = 0;
  let lastWrite = 0;

  const run = async () => {
    try {
      if (!hubUrl || !secret) throw new Error("The hub is not configured on this API (HUB_INTERNAL_URL and HUB_INTERNAL_SECRET)");
      const result = await runLoadTest({
        config,
        send: s.send,
        onTick: async (_p: LoadTimelinePoint, rec) => {
          const now = Date.now();
          if (now - lastWrite < 900) return;
          lastWrite = now;
          await db.loadTest.update({ where: { id: row.id }, data: { timeline: rec.timeline as never, summary: rec.summary(rec.timeline.length) as never } }).catch(() => undefined);
        },
        shouldStop: async () => {
          if (stopReason) return stopReason;
          const now = Date.now();
          if (now - lastCheck < 2000) return null;
          lastCheck = now;
          const cur = await db.loadTest.findUnique({ where: { id: row.id }, select: { cancelRequested: true } }).catch(() => null);
          if (!cur || cur.cancelRequested) return "Cancelled";
          if (!(await readSetting("features.performance"))) return "Load tests were switched off on the platform";
          return null;
        },
      });
      const status = result.summary.stoppedEarly ? (result.summary.stoppedEarly === "Cancelled" ? "CANCELLED" : "ERROR") : result.summary.passed ? "PASSED" : "FAILED";
      await db.loadTest.update({
        where: { id: row.id },
        data: { status, summary: result.summary as never, timeline: result.timeline as never, finishedAt: new Date(), error: status === "ERROR" ? result.summary.stoppedEarly : null },
      });
    } catch (err) {
      await db.loadTest.update({ where: { id: row.id }, data: { status: "ERROR", error: (err as Error).message.slice(0, 500), finishedAt: new Date() } }).catch(() => undefined);
    } finally {
      s.close();
      running.delete(row.id);
    }
  };
  void run();
}

/** On shutdown: stop what runs here (each finishes as ERROR "API restarting"). */
export function stopAllLoadTests(why = "The API restarted during the test"): void {
  for (const r of running.values()) r.stop(why);
}

/** Tests left RUNNING by a crashed instance: marked ERROR once well past their end. */
export async function reapStaleLoadTests(db: Db, now = Date.now()): Promise<number> {
  const stale = await db.loadTest.findMany({ where: { status: "RUNNING" }, select: { id: true, startedAt: true, config: true } });
  let n = 0;
  for (const t of stale) {
    if (running.has(t.id)) continue;
    const dur = Number((t.config as LoadTestConfig)?.durationSec ?? 3600);
    if (now - new Date(t.startedAt).getTime() > (dur + 120) * 1000) {
      await db.loadTest.update({ where: { id: t.id }, data: { status: "ERROR", error: "The test stopped unexpectedly (the API instance running it went away)", finishedAt: new Date(now) } });
      n++;
    }
  }
  return n;
}

export { instance as loadTestInstance };
