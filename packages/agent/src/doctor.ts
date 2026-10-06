// `vhyxvoid doctor`: checks everything a tunnel needs, in the order a user
// would fix it, and says what to do about each problem. Exit code 1 when a
// check fails (warnings alone exit 0), so it also works in CI.
//
//   1. Node.js version          4. hub DNS + TLS + health
//   2. key, secret, label       5. sign-in (optional --connect, temporary label)
//   3. local server on --port   6. proxy variables, custom domain DNS (--domain)
//
// Every network step has its own timeout; nothing here writes files.

import * as dns from "dns/promises";
import * as net from "net";
import * as http from "http";
import * as https from "https";
import { labelProblem } from "@vhyxvoid/protocol";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it (warn/fail). */
  fix?: string;
}

export interface DoctorOptions {
  key?: string;
  secret?: string;
  label: string;
  port: number;
  hub: string;
  /** Also sign in to the hub with a temporary label. */
  connect?: boolean;
  /** Custom domain to check (CNAME/A records). */
  domain?: string;
  /** Hostname customers point domains at; read from the API when not given. */
  domainTarget?: string;
  timeoutMs?: number;
}

/** Network and runtime seams, so the checks are testable without a network. */
export interface DoctorDeps {
  nodeVersion: string;
  env: NodeJS.ProcessEnv;
  tcpConnect(host: string, port: number, timeoutMs: number): Promise<void>;
  httpStatus(url: string, timeoutMs: number): Promise<number>;
  resolve(host: string): Promise<string[]>;
  resolveCname(host: string): Promise<string[]>;
  fetchJson(url: string, timeoutMs: number): Promise<unknown>;
  /** Signs in with the key; resolves "ok" or the hub's error code. */
  signIn(opts: { hub: string; key: string; secret: string; label: string; timeoutMs: number }): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
}

const KEY_ID = /^vhyxvoid_(dev|live)_[a-f0-9]{16,64}$/i;

export function checkNode(version: string): CheckResult {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  if (major >= 18) return { name: "Node.js", status: "ok", detail: version };
  return { name: "Node.js", status: "fail", detail: `${version} is too old`, fix: "Install Node.js 18 or newer (20 LTS recommended)." };
}

export function checkCredentials(o: Pick<DoctorOptions, "key" | "secret" | "label">): CheckResult[] {
  const out: CheckResult[] = [];
  if (!o.key) out.push({ name: "API key", status: "fail", detail: "not set", fix: "Run `npx @vhyxvoid/agent init`, or set VHYXVOID_API_KEY." });
  else if (!KEY_ID.test(o.key)) out.push({ name: "API key", status: "fail", detail: `"${o.key}" does not look like a key ID`, fix: "Copy the key ID (vhyxvoid_dev_… or vhyxvoid_live_…) from the dashboard's API keys page." });
  else out.push({ name: "API key", status: "ok", detail: o.key });

  if (!o.secret) out.push({ name: "Secret", status: "fail", detail: "not set", fix: "Set VHYXVOID_SECRET (shown once when the key was created; rotate the key if it is lost)." });
  else if (o.secret.length < 20) out.push({ name: "Secret", status: "warn", detail: "shorter than a generated secret", fix: "Check for a truncated copy-paste." });
  else out.push({ name: "Secret", status: "ok", detail: `set (${o.secret.length} characters)` });

  const problem = labelProblem(o.label);
  out.push(problem ? { name: "Tunnel label", status: "fail", detail: `"${o.label}": ${problem}`, fix: "Use lowercase letters, digits and hyphens." } : { name: "Tunnel label", status: "ok", detail: o.label });
  return out;
}

/** https origin of the hub, from its WebSocket URL. */
export function hubOrigin(hubUrl: string): URL | null {
  try {
    const u = new URL(hubUrl);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return null;
    return new URL(`${u.protocol === "wss:" ? "https:" : "http:"}//${u.host}`);
  } catch {
    return null;
  }
}

/** api.<domain> next to hub.<domain>, unless VHYXVOID_API_URL says otherwise. */
export function apiOrigin(hub: URL, env: NodeJS.ProcessEnv): string {
  if (env.VHYXVOID_API_URL) return env.VHYXVOID_API_URL.replace(/\/$/, "");
  const host = hub.hostname.startsWith("hub.") ? `api.${hub.hostname.slice(4)}` : hub.hostname;
  return `${hub.protocol}//${host}`;
}

const SIGN_IN_HINTS: Record<string, string> = {
  INVALID_SIGNATURE: "The secret does not match the key. Copy it again, or rotate the key in the dashboard.",
  AUTH_FAILED: "The key was not accepted. Check the key ID, or create a new key.",
  KEY_REVOKED: "This key was revoked. Create a new one in the dashboard.",
  KEY_EXPIRED: "This key expired. Create a new one, or extend it in the dashboard.",
  SCOPE_MISSING: "Give the key the tunnel:connect scope in the dashboard.",
  VERSION_UNSUPPORTED: "Update the agent: npm i -D @vhyxvoid/agent@latest",
  TIMEOUT: "The hub did not answer. Check your network, proxy or firewall (outbound 443).",
};

export async function runDoctor(o: DoctorOptions, d: DoctorDeps): Promise<CheckResult[]> {
  const t = o.timeoutMs ?? 5_000;
  const results: CheckResult[] = [checkNode(d.nodeVersion), ...checkCredentials(o)];

  // Local server.
  try {
    await d.tcpConnect("127.0.0.1", o.port, t);
    try {
      const status = await d.httpStatus(`http://127.0.0.1:${o.port}/`, t);
      results.push({ name: "Local server", status: "ok", detail: `http://localhost:${o.port} answered ${status}` });
    } catch (err) {
      results.push({ name: "Local server", status: "warn", detail: `port ${o.port} is open but did not answer HTTP (${(err as Error).message})`, fix: "Is it an HTTPS-only or non-HTTP server? The agent forwards plain HTTP." });
    }
  } catch {
    results.push({ name: "Local server", status: "fail", detail: `nothing is listening on port ${o.port}`, fix: `Start your app first, or pass the port it uses: vhyxvoid --port <port>.` });
  }

  // Hub.
  const origin = hubOrigin(o.hub);
  if (!origin) {
    results.push({ name: "Hub", status: "fail", detail: `"${o.hub}" is not a ws:// or wss:// URL`, fix: "Use the default (wss://hub.vhyxvoid.com/agent) or your hub's /agent URL." });
  } else {
    let reachable = false;
    try {
      const addrs = await d.resolve(origin.hostname);
      results.push({ name: "Hub DNS", status: "ok", detail: `${origin.hostname} → ${addrs.slice(0, 3).join(", ")}` });
      try {
        const status = await d.httpStatus(`${origin.origin}/health`, t);
        reachable = status < 500;
        results.push(
          reachable
            ? { name: "Hub", status: "ok", detail: `${origin.origin} is reachable (${status})` }
            : { name: "Hub", status: "warn", detail: `${origin.origin}/health answered ${status}`, fix: "The hub may be restarting; try again in a minute." },
        );
      } catch (err) {
        results.push({ name: "Hub", status: "fail", detail: `could not reach ${origin.origin}: ${(err as Error).message}`, fix: "Check your network, VPN or firewall (outbound HTTPS on port 443)." });
      }
    } catch {
      results.push({ name: "Hub DNS", status: "fail", detail: `${origin.hostname} does not resolve`, fix: "Check the hub URL and your DNS/network." });
    }

    if (o.connect) {
      if (!reachable || !o.key || !o.secret) {
        results.push({ name: "Sign-in", status: "skip", detail: "needs a reachable hub, a key and a secret" });
      } else {
        const label = `doctor-${Math.random().toString(16).slice(2, 8)}`;
        const r = await d.signIn({ hub: o.hub, key: o.key, secret: o.secret, label, timeoutMs: Math.max(t, 15_000) });
        if (r.ok) results.push({ name: "Sign-in", status: "ok", detail: `the hub accepted the key (test tunnel ${label}, closed again)` });
        else if (r.code === "AGENT_LIMIT_REACHED") results.push({ name: "Sign-in", status: "warn", detail: "the key works, but your plan's agent limit is reached", fix: "Stop another running agent, or upgrade for more agents." });
        else results.push({ name: "Sign-in", status: "fail", detail: `${r.code}: ${r.message}`, fix: SIGN_IN_HINTS[r.code] ?? "See https://docs.vhyxvoid.com/troubleshooting" });
      }
    } else {
      results.push({ name: "Sign-in", status: "skip", detail: "run with --connect to sign in with a temporary tunnel" });
    }

    // Custom domain.
    if (o.domain) {
      let target = o.domainTarget;
      if (!target) {
        try {
          const body = (await d.fetchJson(`${apiOrigin(origin, d.env)}/api/v1/public/settings`, t)) as { data?: Record<string, unknown> } | null;
          const v = body?.data?.["tunnels.customDomainTarget"];
          if (typeof v === "string" && v) target = v;
        } catch {
          // fall through: compare nothing, just show records
        }
      }
      results.push(await checkDomain(o.domain, target, d));
    }
  }

  // Proxies: the agent connects directly today.
  const proxy = d.env.HTTPS_PROXY ?? d.env.https_proxy ?? d.env.HTTP_PROXY ?? d.env.http_proxy;
  if (proxy) results.push({ name: "Proxy", status: "warn", detail: `a proxy is set (${proxy.replace(/\/\/[^@/]*@/, "//***@")}) but the agent connects directly`, fix: "If outbound 443 is blocked without the proxy, run the agent where it is allowed." });

  return results;
}

export async function checkDomain(domain: string, target: string | undefined, d: Pick<DoctorDeps, "resolve" | "resolveCname">): Promise<CheckResult> {
  const host = domain.trim().toLowerCase().replace(/\.$/, "");
  const cname = await d.resolveCname(host).catch(() => [] as string[]);
  const addrs = await d.resolve(host).catch(() => [] as string[]);
  if (!cname.length && !addrs.length) return { name: `Domain ${host}`, status: "fail", detail: "no DNS records found", fix: target ? `Add a CNAME record: ${host} → ${target}` : "Add the CNAME record shown on the dashboard's Domains page." };
  if (!target) return { name: `Domain ${host}`, status: "warn", detail: `CNAME ${cname.join(", ") || "—"}, A ${addrs.join(", ") || "—"}`, fix: "Compare with the record on the dashboard's Domains page." };
  const t = target.toLowerCase().replace(/\.$/, "");
  if (cname.some((c) => c.toLowerCase().replace(/\.$/, "") === t)) return { name: `Domain ${host}`, status: "ok", detail: `CNAME → ${t}` };
  const targetAddrs = await d.resolve(t).catch(() => [] as string[]);
  if (addrs.length && addrs.every((a) => targetAddrs.includes(a))) return { name: `Domain ${host}`, status: "ok", detail: `A ${addrs.join(", ")} (same as ${t})` };
  return { name: `Domain ${host}`, status: "fail", detail: `points at ${cname[0] ?? addrs.join(", ")}, not ${t}`, fix: `Change the record to CNAME ${host} → ${t}. DNS changes can take a few minutes.` };
}

export function formatResults(results: CheckResult[]): string {
  const icon: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗", skip: "-" };
  const lines = results.map((r) => {
    const head = `  ${icon[r.status]} ${r.name.padEnd(16)} ${r.detail}`;
    return r.fix && (r.status === "fail" || r.status === "warn") ? `${head}\n      → ${r.fix}` : head;
  });
  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const summary = failed ? `${failed} problem${failed === 1 ? "" : "s"} to fix${warned ? `, ${warned} warning${warned === 1 ? "" : "s"}` : ""}.` : warned ? `Ready, with ${warned} warning${warned === 1 ? "" : "s"}.` : "Everything looks good.";
  return `\n${lines.join("\n")}\n\n  ${summary}\n`;
}

// ── Real implementations ──────────────────────────────────────────────────────

function request(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { timeout: timeoutMs, headers: { "user-agent": "vhyxvoid-doctor" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        if (body.length < 65_536) body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`timed out after ${timeoutMs} ms`)));
    req.on("error", reject);
  });
}

export function realDeps(signIn: DoctorDeps["signIn"]): DoctorDeps {
  return {
    nodeVersion: process.version,
    env: process.env,
    tcpConnect: (host, port, timeoutMs) =>
      new Promise((resolve, reject) => {
        const s = net.connect({ host, port });
        const done = (err?: Error) => {
          s.destroy();
          if (err) reject(err);
          else resolve();
        };
        s.setTimeout(timeoutMs, () => done(new Error("timeout")));
        s.once("connect", () => done());
        s.once("error", (e) => done(e));
      }),
    httpStatus: async (url, timeoutMs) => (await request(url, timeoutMs)).status,
    resolve: async (host) => {
      const r = await dns.lookup(host, { all: true });
      return r.map((a) => a.address);
    },
    resolveCname: (host) => dns.resolveCname(host),
    fetchJson: async (url, timeoutMs) => JSON.parse((await request(url, timeoutMs)).body),
    signIn,
  };
}
