// packages/shared/src/trafficRules.ts
//
// Traffic rules: an ordered list per tunnel (account + label) that the hub
// applies to public requests before they reach the agent. Pure (no I/O) so
// the API validates with exactly what the hub evaluates.
//
//   match   method(s), path pattern ("/api/users", "/api/*", "*"), optional header
//   when    "always", or "offline" (only while no agent is connected)
//   action  mock | fail (with a probability) | redirect   -> answer, stop
//           delay | rewrite | requestHeaders | responseHeaders -> change, go on
//
// Rules run top to bottom; changes add up until the first answering rule.

export const TRAFFIC_RULE_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export type TrafficRuleMethod = (typeof TRAFFIC_RULE_METHODS)[number];

export const TRAFFIC_RULE_BOUNDS = {
  nameLength: 80,
  pathLength: 500,
  mockBodyBytes: 64 * 1024,
  headers: 20,
  headerValueLength: 2000,
  delayMs: 30_000,
  /** Hard cap regardless of plan (the plan limit maxTrafficRules applies first). */
  rulesPerTunnel: 200,
} as const;

/** Headers a rule may not set or remove: framing and routing belong to the hub. */
export const PROTECTED_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "keep-alive", "te", "trailer"]);

export interface TrafficRuleMatch {
  /** Empty or missing = any method. */
  methods?: TrafficRuleMethod[];
  /** Exact ("/health"), prefix ("/api/" then a star), glob with stars, or a lone star for any path. Matched without the query string. */
  path: string;
  /** Header that must be present; with `value`, must equal it (case-insensitive). */
  header?: { name: string; value?: string };
}

export type TrafficRuleAction =
  | { type: "mock"; status: number; headers?: Record<string, string>; body?: string }
  | { type: "fail"; status: number; percent: number; body?: string }
  | { type: "redirect"; status: 301 | 302 | 307 | 308; location: string }
  | { type: "delay"; ms: number }
  | { type: "rewrite"; to: string }
  | { type: "requestHeaders"; set?: Record<string, string>; remove?: string[] }
  | { type: "responseHeaders"; set?: Record<string, string>; remove?: string[] };

export type TrafficRuleActionType = TrafficRuleAction["type"];

export interface TrafficRule {
  id: string;
  name: string;
  enabled: boolean;
  when: "always" | "offline";
  match: TrafficRuleMatch;
  action: TrafficRuleAction;
}

/** What the hub does with one request after evaluating the rules. */
export interface TrafficPlan {
  /** Rules that took part, in order. */
  matched: string[];
  /** Answer now with this instead of forwarding. */
  respond: { ruleId: string; kind: "mock" | "fail" | "redirect"; status: number; headers: Record<string, string>; body: string } | null;
  delayMs: number;
  /** Path (with query) to forward; the original when no rewrite applied. */
  path: string;
  setRequestHeaders: Record<string, string>;
  removeRequestHeaders: string[];
  setResponseHeaders: Record<string, string>;
  removeResponseHeaders: string[];
}

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// ── Matching ──────────────────────────────────────────────────────────────────

const patternCache = new Map<string, RegExp>();

/** "*" matches anything (including "/"); everything else is literal. */
export function pathPatternRegex(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    re = pattern === "*" ? /^.*$/ : new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    if (patternCache.size > 5_000) patternCache.clear();
    patternCache.set(pattern, re);
  }
  return re;
}

export function splitPath(url: string): { path: string; query: string } {
  const i = url.indexOf("?");
  return i === -1 ? { path: url, query: "" } : { path: url.slice(0, i), query: url.slice(i) };
}

export function ruleMatches(rule: TrafficRule, req: { method: string; path: string; headers: Record<string, string | string[] | undefined> }): boolean {
  const m = rule.match;
  if (m.methods?.length && !m.methods.includes(req.method.toUpperCase() as TrafficRuleMethod)) return false;
  if (!pathPatternRegex(m.path).test(splitPath(req.path).path)) return false;
  if (m.header) {
    const raw = req.headers[m.header.name.toLowerCase()];
    if (raw === undefined) return false;
    if (m.header.value !== undefined) {
      const values = Array.isArray(raw) ? raw : [raw];
      if (!values.some((v) => v.toLowerCase() === m.header!.value!.toLowerCase())) return false;
    }
  }
  return true;
}

/** Replaces the part of the path the pattern's prefix covered ("/old/*" -> "/new/..."), keeping the query. */
export function rewritePath(pattern: string, to: string, url: string): string {
  const { path, query } = splitPath(url);
  const star = pattern.indexOf("*");
  if (star === -1) return to + query;
  const prefix = pattern.slice(0, star);
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path.replace(/^\//, "");
  const base = to.endsWith("/") || rest === "" ? to : `${to}/`;
  return `${base}${rest}`.replace(/\/{2,}/g, "/") + query;
}

// ── Evaluation ────────────────────────────────────────────────────────────────

export function evaluateTrafficRules(
  rules: readonly TrafficRule[] | null | undefined,
  req: { method: string; path: string; headers: Record<string, string | string[] | undefined> },
  ctx: { online: boolean; random?: () => number },
): TrafficPlan {
  const plan: TrafficPlan = {
    matched: [],
    respond: null,
    delayMs: 0,
    path: req.path,
    setRequestHeaders: {},
    removeRequestHeaders: [],
    setResponseHeaders: {},
    removeResponseHeaders: [],
  };
  if (!rules?.length) return plan;
  const random = ctx.random ?? Math.random;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.when === "offline" && ctx.online) continue;
    // Matching sees the path as rewritten by earlier rules, like the app will.
    if (!ruleMatches(rule, { ...req, path: plan.path })) continue;
    const a = rule.action;
    switch (a.type) {
      case "mock":
        plan.matched.push(rule.id);
        plan.respond = { ruleId: rule.id, kind: "mock", status: a.status, headers: { ...(a.headers ?? {}) }, body: a.body ?? "" };
        return plan;
      case "fail":
        if (random() * 100 >= a.percent) continue;
        plan.matched.push(rule.id);
        plan.respond = {
          ruleId: rule.id,
          kind: "fail",
          status: a.status,
          headers: { "content-type": "text/plain; charset=utf-8" },
          body: a.body ?? `Injected ${a.status} by traffic rule "${rule.name}"`,
        };
        return plan;
      case "redirect": {
        plan.matched.push(rule.id);
        const location = a.location.replace("{path}", plan.path);
        plan.respond = { ruleId: rule.id, kind: "redirect", status: a.status, headers: { location }, body: "" };
        return plan;
      }
      case "delay":
        plan.delayMs = Math.min(TRAFFIC_RULE_BOUNDS.delayMs, plan.delayMs + a.ms);
        break;
      case "rewrite":
        plan.path = rewritePath(rule.match.path, a.to, plan.path);
        break;
      case "requestHeaders":
        for (const [k, v] of Object.entries(a.set ?? {})) plan.setRequestHeaders[k.toLowerCase()] = v;
        for (const k of a.remove ?? []) plan.removeRequestHeaders.push(k.toLowerCase());
        break;
      case "responseHeaders":
        for (const [k, v] of Object.entries(a.set ?? {})) plan.setResponseHeaders[k.toLowerCase()] = v;
        for (const k of a.remove ?? []) plan.removeResponseHeaders.push(k.toLowerCase());
        break;
    }
    plan.matched.push(rule.id);
  }
  return plan;
}

/** Applies the response-header part of a plan to a header map, in place. */
export function applyResponseHeaders(headers: Record<string, string | string[]>, plan: Pick<TrafficPlan, "setResponseHeaders" | "removeResponseHeaders">): void {
  for (const name of plan.removeResponseHeaders) {
    for (const k of Object.keys(headers)) if (k.toLowerCase() === name) delete headers[k];
  }
  for (const [name, value] of Object.entries(plan.setResponseHeaders)) {
    for (const k of Object.keys(headers)) if (k.toLowerCase() === name) delete headers[k];
    headers[name] = value;
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

function headerProblem(name: unknown, value?: unknown): string | undefined {
  if (typeof name !== "string" || !TOKEN.test(name) || name.length > 100) return `"${String(name)}" is not a valid header name`;
  if (PROTECTED_HEADERS.has(name.toLowerCase())) return `The ${name.toLowerCase()} header is managed by VhyxVoid and cannot be changed`;
  if (value !== undefined) {
    if (typeof value !== "string") return `Header ${name} must have a text value`;
    if (/[\r\n\0]/.test(value)) return `Header ${name} cannot contain line breaks`;
    if (value.length > TRAFFIC_RULE_BOUNDS.headerValueLength) return `Header ${name} is too long`;
  }
  return undefined;
}

function headerMapProblem(set: unknown, remove: unknown): string | undefined {
  if (set !== undefined) {
    if (typeof set !== "object" || set === null || Array.isArray(set)) return "Headers to set must be name/value pairs";
    const entries = Object.entries(set);
    if (entries.length > TRAFFIC_RULE_BOUNDS.headers) return `At most ${TRAFFIC_RULE_BOUNDS.headers} headers`;
    for (const [k, v] of entries) {
      const p = headerProblem(k, v);
      if (p) return p;
    }
  }
  if (remove !== undefined) {
    if (!Array.isArray(remove) || remove.length > TRAFFIC_RULE_BOUNDS.headers) return "Headers to remove must be a list";
    for (const k of remove) {
      const p = headerProblem(k);
      if (p) return p;
    }
  }
  return undefined;
}

function statusIn(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

/** The problem with one rule, or undefined. Messages are shown to users as they are. */
export function trafficRuleProblem(rule: unknown): string | undefined {
  if (typeof rule !== "object" || rule === null) return "Each rule must be an object";
  const r = rule as Partial<TrafficRule>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  const label = name ? `Rule "${name}"` : "A rule";
  if (typeof r.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(r.id)) return `${label} has no valid id`;
  if (!name || name.length > TRAFFIC_RULE_BOUNDS.nameLength) return `Every rule needs a name of at most ${TRAFFIC_RULE_BOUNDS.nameLength} characters`;
  if (typeof r.enabled !== "boolean") return `${label}: enabled must be true or false`;
  if (r.when !== "always" && r.when !== "offline") return `${label}: "when" must be always or offline`;

  const m = r.match as TrafficRuleMatch | undefined;
  if (!m || typeof m !== "object") return `${label} has no match`;
  if (typeof m.path !== "string" || !(m.path === "*" || m.path.startsWith("/")) || m.path.length > TRAFFIC_RULE_BOUNDS.pathLength || /[\s?#]/.test(m.path))
    return `${label}: the path must start with / (use * for "anything"), without spaces, ? or #`;
  if (m.methods !== undefined && (!Array.isArray(m.methods) || m.methods.some((x) => !TRAFFIC_RULE_METHODS.includes(x)))) return `${label}: unknown method`;
  if (m.header !== undefined) {
    const p = headerProblem(m.header?.name, m.header?.value ?? undefined);
    if (p && !p.includes("managed by")) return `${label}: ${p}`;
  }

  const a = r.action as TrafficRuleAction | undefined;
  if (!a || typeof a !== "object") return `${label} has no action`;
  if (r.when === "offline" && a.type !== "mock" && a.type !== "redirect") return `${label}: rules for an offline tunnel can only answer (mock or redirect)`;
  switch (a.type) {
    case "mock": {
      if (!statusIn(a.status, 200, 599)) return `${label}: status must be between 200 and 599`;
      if (a.body !== undefined && (typeof a.body !== "string" || Buffer.byteLength(a.body) > TRAFFIC_RULE_BOUNDS.mockBodyBytes))
        return `${label}: the body can be at most ${TRAFFIC_RULE_BOUNDS.mockBodyBytes / 1024} KB of text`;
      const p = headerMapProblem(a.headers, undefined);
      return p ? `${label}: ${p}` : undefined;
    }
    case "fail":
      if (!statusIn(a.status, 400, 599)) return `${label}: status must be between 400 and 599`;
      if (typeof a.percent !== "number" || !(a.percent > 0 && a.percent <= 100)) return `${label}: percent must be more than 0 and at most 100`;
      if (a.body !== undefined && (typeof a.body !== "string" || a.body.length > 2000)) return `${label}: the body can be at most 2000 characters`;
      return undefined;
    case "redirect":
      if (![301, 302, 307, 308].includes(a.status)) return `${label}: redirect status must be 301, 302, 307 or 308`;
      if (typeof a.location !== "string" || a.location.length > 2000 || /[\r\n\s]/.test(a.location)) return `${label}: invalid location`;
      if (!a.location.startsWith("/") && !/^https?:\/\/[^/]/i.test(a.location)) return `${label}: location must be a path (/…) or an http(s) URL`;
      return undefined;
    case "delay":
      if (!statusIn(a.ms, 1, TRAFFIC_RULE_BOUNDS.delayMs)) return `${label}: delay must be 1 to ${TRAFFIC_RULE_BOUNDS.delayMs} ms`;
      return undefined;
    case "rewrite":
      if (typeof a.to !== "string" || !a.to.startsWith("/") || a.to.length > TRAFFIC_RULE_BOUNDS.pathLength || /[\s?#*]/.test(a.to))
        return `${label}: rewrite target must be a path starting with /`;
      return undefined;
    case "requestHeaders":
    case "responseHeaders": {
      if (!a.set && !a.remove) return `${label}: set or remove at least one header`;
      const p = headerMapProblem(a.set, a.remove);
      return p ? `${label}: ${p}` : undefined;
    }
    default:
      return `${label}: unknown action`;
  }
}

/** Problem with a whole list (shape, unique ids, plan limit), or undefined. */
export function trafficRulesProblem(rules: unknown, maxRules: number): string | undefined {
  if (!Array.isArray(rules)) return "Rules must be a list";
  const cap = Math.min(maxRules, TRAFFIC_RULE_BOUNDS.rulesPerTunnel);
  if (rules.length > cap) return cap === 0 ? "Traffic rules are not available on this plan" : `At most ${cap} rules per tunnel on this plan`;
  const ids = new Set<string>();
  for (const r of rules) {
    const p = trafficRuleProblem(r);
    if (p) return p;
    const id = (r as TrafficRule).id;
    if (ids.has(id)) return `Two rules share the id ${id}`;
    ids.add(id);
  }
  return undefined;
}

/** Same rules with names trimmed and empty optional parts dropped. */
export function normalizeTrafficRules(rules: TrafficRule[]): TrafficRule[] {
  return rules.map((r) => ({
    id: r.id,
    name: r.name.trim(),
    enabled: r.enabled,
    when: r.when,
    match: {
      path: r.match.path,
      ...(r.match.methods?.length ? { methods: [...new Set(r.match.methods)] } : {}),
      ...(r.match.header?.name ? { header: { name: r.match.header.name, ...(r.match.header.value ? { value: r.match.header.value } : {}) } } : {}),
    },
    action: r.action,
  }));
}

/** One line for lists and the activity feed. */
export function describeTrafficRule(r: TrafficRule): string {
  const where = `${r.match.methods?.length ? r.match.methods.join("/") : "any"} ${r.match.path}${r.when === "offline" ? " while offline" : ""}`;
  const a = r.action;
  switch (a.type) {
    case "mock":
      return `${where} → answer ${a.status}`;
    case "fail":
      return `${where} → ${a.status} for ${a.percent}% of requests`;
    case "redirect":
      return `${where} → ${a.status} to ${a.location}`;
    case "delay":
      return `${where} → wait ${a.ms} ms`;
    case "rewrite":
      return `${where} → forward to ${a.to}`;
    case "requestHeaders":
      return `${where} → change request headers`;
    case "responseHeaders":
      return `${where} → change response headers`;
  }
}
