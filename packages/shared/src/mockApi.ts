// packages/shared/src/mockApi.ts
//
// Hosted mock APIs (internal-tools/shared/api-platform-plan.md, phase 1).
// A mock API is bound to a tunnel label and answers at that label's URL. This
// module is the whole engine, shared by the hub (serving), the API (validation,
// dry runs, OpenAPI import/export) and the dashboard (try-it panel):
//
//   - endpoints: method + path pattern (":id" / "{id}" params, "*" wildcard),
//     matched in the order the user arranged them;
//   - responses: chosen by rules (query/header/param/cookie/body), in
//     sequence, or at random, falling back to the default response;
//   - templating: a small, non-Turing-complete language ({{request.query.x}},
//     {{uuid}}, {{#repeat 3}}…{{/repeat}}), opt-in per response, bounded output.
//
// Nothing here evaluates user code.

import type { MockResource } from "./mockResources";

export const MOCK_METHODS = ["ANY", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type MockMethod = (typeof MOCK_METHODS)[number];

export const MOCK_MODES = ["ALWAYS", "OFFLINE"] as const;
/** ALWAYS: matched routes answer from the mock, the rest go to the agent if connected. OFFLINE: only while no agent is connected. */
export type MockMode = (typeof MOCK_MODES)[number];

export const MOCK_RULE_SOURCES = ["query", "header", "param", "cookie", "body", "method", "path"] as const;
export type MockRuleSource = (typeof MOCK_RULE_SOURCES)[number];
export const MOCK_RULE_OPS = ["equals", "not_equals", "contains", "exists", "not_exists", "regex"] as const;
export type MockRuleOp = (typeof MOCK_RULE_OPS)[number];

export interface MockRule {
  source: MockRuleSource;
  /** Query/header/param/cookie name, or a dotted JSON path for body ("user.id", "items.0.sku"). Ignored for method/path. */
  key?: string;
  op: MockRuleOp;
  value?: string;
}

export interface MockResponse {
  id: string;
  name?: string;
  status: number;
  headers?: Record<string, string>;
  body?: string;
  /** Render {{…}} in the body and header values. */
  templating?: boolean;
  /** Extra delay for this response, added to the API's latency. */
  latencyMs?: number;
  rules?: MockRule[];
  rulesMatch?: "all" | "any";
  /** Chosen when no response's rules match. At most one per endpoint. */
  isDefault?: boolean;
}

export interface MockEndpoint {
  id: string;
  name?: string;
  enabled: boolean;
  method: MockMethod;
  path: string;
  /** rules: first response whose rules match, else the default. sequential / random ignore rules. */
  selection?: "rules" | "sequential" | "random";
  responses: MockResponse[];
}

export interface MockApiDefinition {
  /** The mock's id; keys its resource data. */
  id?: string;
  mode: MockMode;
  cors: boolean;
  latencyMs: number;
  endpoints: MockEndpoint[];
  /** Stateful REST collections (mockResources.ts). Endpoints win over them. */
  resources?: MockResource[];
}

export const MOCK_BOUNDS = {
  endpointsHardCap: 1000,
  responsesPerEndpoint: 20,
  rulesPerResponse: 10,
  headersPerResponse: 30,
  bodyBytes: 256 * 1024,
  /** Rendered output cap (templating can expand with repeat). */
  renderedBytes: 2 * 1024 * 1024,
  latencyMs: 30_000,
  pathLength: 500,
  repeatMax: 1000,
  repeatDepth: 3,
  /** Whole definition as JSON, a guard against pathological input. */
  definitionBytes: 4 * 1024 * 1024,
} as const;

/** Framing headers belong to the hub. */
const PROTECTED_HEADERS = new Set(["content-length", "transfer-encoding", "connection", "upgrade", "keep-alive", "te", "trailer"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// ── Path patterns ─────────────────────────────────────────────────────────────

interface CompiledPath {
  re: RegExp;
  params: string[];
}

const pathCache = new Map<string, CompiledPath>();

/**
 * "/users/:id" and "/users/{id}" capture one segment; "*" matches the rest
 * (including "/") and is available as param "*"; trailing slashes are ignored.
 */
export function compileMockPath(pattern: string): CompiledPath {
  let c = pathCache.get(pattern);
  if (c) return c;
  const params: string[] = [];
  const trimmed = pattern.length > 1 ? pattern.replace(/\/+$/, "") : pattern;
  let re = "^";
  for (const seg of trimmed.split("/").slice(1)) {
    re += "\\/";
    if (seg === "*") {
      params.push("*");
      re += "(.*)";
      continue;
    }
    const m = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(seg) ?? /^\{([A-Za-z_][A-Za-z0-9_.-]*)\}$/.exec(seg);
    if (m) {
      params.push(m[1]);
      re += "([^/]+)";
    } else {
      re += seg.replace(/[.+?^${}()|[\]\\*]/g, "\\$&");
    }
  }
  if (trimmed === "/") re = "^";
  c = { re: new RegExp(`${re}\\/?$`), params };
  if (pathCache.size > 10_000) pathCache.clear();
  pathCache.set(pattern, c);
  return c;
}

export function matchMockPath(pattern: string, path: string): Record<string, string> | null {
  const { re, params } = compileMockPath(pattern);
  const m = re.exec(path);
  if (!m) return null;
  const out: Record<string, string> = {};
  params.forEach((p, i) => {
    try {
      out[p] = decodeURIComponent(m[i + 1] ?? "");
    } catch {
      out[p] = m[i + 1] ?? "";
    }
  });
  return out;
}

// ── Requests ──────────────────────────────────────────────────────────────────

export interface MockRequest {
  method: string;
  /** Path with query string, as the hub received it. */
  url: string;
  headers: Record<string, string | string[] | undefined>;
  /** Raw body text (UTF-8), if any. */
  body?: string;
}

interface RequestView {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  params: Record<string, string>;
  body: unknown;
  rawBody: string;
}

function parseQuery(q: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!q) return out;
  for (const [k, v] of new URLSearchParams(q)) if (!(k in out)) out[k] = v;
  return out;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function view(req: MockRequest, params: Record<string, string>): RequestView {
  const qi = req.url.indexOf("?");
  const path = qi === -1 ? req.url : req.url.slice(0, qi);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  const rawBody = req.body ?? "";
  let body: unknown = undefined;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      const ct = headers["content-type"] ?? "";
      body = ct.includes("application/x-www-form-urlencoded") ? parseQuery(rawBody) : rawBody;
    }
  }
  return { method: req.method.toUpperCase(), path, query: parseQuery(qi === -1 ? "" : req.url.slice(qi + 1)), headers, cookies: parseCookies(headers.cookie), params, body, rawBody };
}

/** "a.b.0.c" into an object; undefined when any step is missing. */
export function getPath(obj: unknown, dotted: string): unknown {
  if (!dotted) return obj;
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function ruleValue(r: MockRule, v: RequestView): string | undefined {
  switch (r.source) {
    case "method":
      return v.method;
    case "path":
      return v.path;
    case "query":
      return v.query[r.key ?? ""];
    case "header":
      return v.headers[(r.key ?? "").toLowerCase()];
    case "param":
      return v.params[r.key ?? ""];
    case "cookie":
      return v.cookies[r.key ?? ""];
    case "body": {
      const x = r.key ? getPath(v.body, r.key) : v.rawBody;
      if (x === undefined || x === null) return undefined;
      return typeof x === "object" ? JSON.stringify(x) : String(x);
    }
  }
}

const regexCache = new Map<string, RegExp | null>();
function safeRegex(src: string): RegExp | null {
  if (!regexCache.has(src)) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(src);
    } catch {
      re = null;
    }
    if (regexCache.size > 5_000) regexCache.clear();
    regexCache.set(src, re);
  }
  return regexCache.get(src)!;
}

export function mockRuleMatches(r: MockRule, v: RequestView): boolean {
  const actual = ruleValue(r, v);
  switch (r.op) {
    case "exists":
      return actual !== undefined && actual !== "";
    case "not_exists":
      return actual === undefined || actual === "";
    case "equals":
      return actual !== undefined && actual === (r.value ?? "");
    case "not_equals":
      return actual !== (r.value ?? "");
    case "contains":
      return actual !== undefined && actual.includes(r.value ?? "");
    case "regex": {
      const re = safeRegex(r.value ?? "");
      // Inputs are bounded (headers, a capped body); patterns are validated on save.
      return actual !== undefined && !!re && re.test(actual.slice(0, 64 * 1024));
    }
  }
}

// ── Templating ────────────────────────────────────────────────────────────────

const FIRST = ["Ada", "Alan", "Grace", "Linus", "Margaret", "Ken", "Barbara", "Dennis", "Radia", "Tim", "Katherine", "Guido", "Anita", "Bjarne", "Frances", "James", "Hedy", "Donald", "Sophie", "Yukihiro"];
const LAST = ["Lovelace", "Turing", "Hopper", "Torvalds", "Hamilton", "Thompson", "Liskov", "Ritchie", "Perlman", "Berners-Lee", "Johnson", "van Rossum", "Borg", "Stroustrup", "Allen", "Gosling", "Lamarr", "Knuth", "Wilson", "Matsumoto"];
const COMPANIES = ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Stark Industries", "Wayne Enterprises", "Soylent", "Tyrell", "Cyberdyne"];
const CITIES = ["Bengaluru", "Berlin", "Lisbon", "Toronto", "Singapore", "Austin", "Nairobi", "Tokyo", "São Paulo", "Sydney"];
const COUNTRIES = ["India", "Germany", "Portugal", "Canada", "Singapore", "United States", "Kenya", "Japan", "Brazil", "Australia"];
const WORDS = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(" ");

export interface RenderContext {
  request: RequestView;
  random: () => number;
  now: () => number;
}

class RenderBudget {
  used = 0;
  constructor(readonly max: number) {}
  add(n: number) {
    this.used += n;
    if (this.used > this.max) throw new MockTemplateError(`Rendered response is larger than ${Math.round(this.max / 1024)} KB`);
  }
}

export class MockTemplateError extends Error {}

type Node = { t: "text"; v: string } | { t: "tag"; v: string } | { t: "repeat"; arg: string; children: Node[] };

const parseCache = new Map<string, Node[]>();

function parseTemplate(src: string): Node[] {
  const cached = parseCache.get(src);
  if (cached) return cached;
  const root: Node[] = [];
  const stack: { children: Node[]; arg?: string }[] = [{ children: root }];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{{", i);
    if (open === -1) {
      stack[stack.length - 1].children.push({ t: "text", v: src.slice(i) });
      break;
    }
    if (open > i) stack[stack.length - 1].children.push({ t: "text", v: src.slice(i, open) });
    const close = src.indexOf("}}", open + 2);
    if (close === -1) {
      stack[stack.length - 1].children.push({ t: "text", v: src.slice(open) });
      break;
    }
    const inner = src.slice(open + 2, close).trim();
    i = close + 2;
    if (inner.startsWith("#repeat")) {
      if (stack.length > MOCK_BOUNDS.repeatDepth) throw new MockTemplateError(`repeat can be nested at most ${MOCK_BOUNDS.repeatDepth} deep`);
      const node: Node = { t: "repeat", arg: inner.slice(7).trim(), children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push({ children: (node as { children: Node[] }).children });
    } else if (inner === "/repeat") {
      if (stack.length === 1) throw new MockTemplateError("{{/repeat}} without {{#repeat}}");
      stack.pop();
    } else {
      stack[stack.length - 1].children.push({ t: "tag", v: inner });
    }
  }
  if (stack.length !== 1) throw new MockTemplateError("{{#repeat}} is not closed with {{/repeat}}");
  if (parseCache.size > 2_000) parseCache.clear();
  parseCache.set(src, root);
  return root;
}

/** Splits helper arguments: words, 'single' or "double" quoted strings. */
function args(s: string): string[] {
  const out: string[] = [];
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function intBetween(ctx: RenderContext, a: number, b: number) {
  const lo = Math.ceil(Math.min(a, b));
  const hi = Math.floor(Math.max(a, b));
  return lo + Math.floor(ctx.random() * (hi - lo + 1));
}

function uuid(ctx: RenderContext): string {
  const h = Array.from({ length: 32 }, () => Math.floor(ctx.random() * 16).toString(16));
  h[12] = "4";
  h[16] = "89ab"[Math.floor(ctx.random() * 4)];
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const pick = <T>(ctx: RenderContext, list: readonly T[]) => list[Math.floor(ctx.random() * list.length)];

function stringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function evalTag(tag: string, ctx: RenderContext, index: number | undefined): string {
  const [name, ...rest] = args(tag);
  const a = rest;
  switch (name) {
    case "@index":
      return index === undefined ? "" : String(index);
    case "uuid":
      return uuid(ctx);
    case "now":
      return new Date(ctx.now()).toISOString();
    case "timestamp":
      return String(Math.floor(ctx.now() / 1000));
    case "int":
      return String(intBetween(ctx, Number(a[0] ?? 0), Number(a[1] ?? 100)));
    case "float": {
      const lo = Number(a[0] ?? 0);
      const hi = Number(a[1] ?? 1);
      const digits = Math.min(10, Math.max(0, Number(a[2] ?? 2)));
      return (lo + ctx.random() * (hi - lo)).toFixed(digits);
    }
    case "bool":
      return ctx.random() < 0.5 ? "true" : "false";
    case "pick":
      return a.length ? pick(ctx, a) : "";
    case "firstName":
      return pick(ctx, FIRST);
    case "lastName":
      return pick(ctx, LAST);
    case "fullName":
      return `${pick(ctx, FIRST)} ${pick(ctx, LAST)}`;
    case "email":
      return `${pick(ctx, FIRST).toLowerCase()}.${pick(ctx, LAST).toLowerCase().replace(/[^a-z]/g, "")}@example.com`;
    case "company":
      return pick(ctx, COMPANIES);
    case "city":
      return pick(ctx, CITIES);
    case "country":
      return pick(ctx, COUNTRIES);
    case "lorem": {
      const n = Math.min(200, Math.max(1, Number(a[0] ?? 8)));
      return Array.from({ length: n }, () => pick(ctx, WORDS)).join(" ");
    }
    case "json":
      return JSON.stringify(lookup(a[0] ?? "request.body", ctx) ?? null);
    default:
      if (name?.startsWith("request.")) return stringify(lookup(name, ctx));
      throw new MockTemplateError(`Unknown template tag {{${tag}}}`);
  }
}

function lookup(ref: string, ctx: RenderContext): unknown {
  const r = ctx.request;
  const [, area, ...restParts] = ref.split(".");
  const rest = restParts.join(".");
  switch (area) {
    case "method":
      return r.method;
    case "path":
      return r.path;
    case "query":
      return rest ? r.query[rest] : r.query;
    case "headers":
      return rest ? r.headers[rest.toLowerCase()] : r.headers;
    case "params":
      return rest ? r.params[rest] : r.params;
    case "cookies":
      return rest ? r.cookies[rest] : r.cookies;
    case "body":
      return rest ? getPath(r.body, rest) : r.body;
    case "rawBody":
      return r.rawBody;
    default:
      throw new MockTemplateError(`Unknown template value {{${ref}}}`);
  }
}

function renderNodes(nodes: Node[], ctx: RenderContext, budget: RenderBudget, index: number | undefined): string {
  let out = "";
  for (const n of nodes) {
    let piece: string;
    if (n.t === "text") piece = n.v;
    else if (n.t === "tag") piece = evalTag(n.v, ctx, index);
    else {
      const [countArg, maxArg] = args(n.arg);
      const count = maxArg !== undefined ? intBetween(ctx, Number(countArg), Number(maxArg)) : Number(countArg);
      if (!Number.isFinite(count) || count < 0) throw new MockTemplateError(`{{#repeat ${n.arg}}} needs a number`);
      const times = Math.min(MOCK_BOUNDS.repeatMax, Math.floor(count));
      const parts: string[] = [];
      for (let i = 0; i < times; i++) parts.push(renderNodes(n.children, ctx, budget, i));
      // JSON lists: the element template usually ends with "," so callers can
      // write {{#repeat 3}}{...},{{/repeat}}; drop the trailing comma.
      piece = parts.join("").replace(/,\s*$/, "");
    }
    budget.add(piece.length);
    out += piece;
  }
  return out;
}

export function renderTemplate(src: string, ctx: RenderContext, maxBytes: number = MOCK_BOUNDS.renderedBytes): string {
  return renderNodes(parseTemplate(src), ctx, new RenderBudget(maxBytes), undefined);
}

/** Problems a template would hit at render time, for validation on save. */
export function templateProblem(src: string): string | null {
  try {
    const nodes = parseTemplate(src);
    const walk = (ns: Node[]): string | null => {
      for (const n of ns) {
        if (n.t === "tag") {
          const [name] = args(n.v);
          const known = ["@index", "uuid", "now", "timestamp", "int", "float", "bool", "pick", "firstName", "lastName", "fullName", "email", "company", "city", "country", "lorem", "json"];
          if (!known.includes(name ?? "") && !/^request\.(method|path|rawBody|query|headers|params|cookies|body)(\.|$)/.test(name ?? "")) return `Unknown template tag {{${n.v}}}`;
        } else if (n.t === "repeat") {
          const r = walk(n.children);
          if (r) return r;
        }
      }
      return null;
    };
    return walk(nodes);
  } catch (err) {
    return (err as Error).message;
  }
}

// ── Resolution ────────────────────────────────────────────────────────────────

export interface MockAnswer {
  endpointId: string;
  responseId: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  latencyMs: number;
}

export interface ResolveOptions {
  random?: () => number;
  now?: () => number;
  /** Per-endpoint counters for "sequential"; the hub keeps one map per mock. */
  sequence?: Map<string, number>;
}

const CORS_HEADERS = (origin: string | undefined, reqHeaders: string | undefined): Record<string, string> => ({
  "access-control-allow-origin": origin || "*",
  ...(origin ? { "access-control-allow-credentials": "true", vary: "Origin" } : {}),
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
  "access-control-allow-headers": reqHeaders || "*",
  "access-control-max-age": "600",
});

function chooseResponse(ep: MockEndpoint, v: RequestView, opts: ResolveOptions): MockResponse | undefined {
  const rs = ep.responses;
  if (!rs.length) return undefined;
  const sel = ep.selection ?? "rules";
  if (sel === "random") return rs[Math.floor((opts.random ?? Math.random)() * rs.length)];
  if (sel === "sequential") {
    const seq = opts.sequence;
    const n = seq?.get(ep.id) ?? 0;
    seq?.set(ep.id, n + 1);
    return rs[n % rs.length];
  }
  for (const r of rs) {
    if (!r.rules?.length) continue;
    const hit = r.rulesMatch === "any" ? r.rules.some((x) => mockRuleMatches(x, v)) : r.rules.every((x) => mockRuleMatches(x, v));
    if (hit) return r;
  }
  return rs.find((r) => r.isDefault) ?? rs.find((r) => !r.rules?.length) ?? rs[0];
}

/**
 * Whether the mock answers this method and path (or a CORS preflight), without
 * reading the body. The hub calls this first, so a request the mock won't
 * answer reaches the agent with its body stream untouched; when it is true,
 * resolveMock() always returns an answer.
 */
export function mockHandles(def: MockApiDefinition, req: Pick<MockRequest, "method" | "url" | "headers">): boolean {
  const method = req.method.toUpperCase();
  if (def.cors && method === "OPTIONS" && req.headers["access-control-request-method"]) return true;
  const qi = req.url.indexOf("?");
  const path = qi === -1 ? req.url : req.url.slice(0, qi);
  return def.endpoints.some(
    (ep) => ep.enabled && ep.responses.length > 0 && (ep.method === "ANY" || ep.method === method || (ep.method === "GET" && method === "HEAD")) && matchMockPath(ep.path, path) !== null,
  );
}

/**
 * What the mock answers for a request, or null when no endpoint matches
 * (the hub then forwards to the agent, or answers 404).
 * A CORS preflight is answered for any path when CORS is on.
 */
export function resolveMock(def: MockApiDefinition, req: MockRequest, opts: ResolveOptions = {}): MockAnswer | null {
  const method = req.method.toUpperCase();
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const acrh = req.headers["access-control-request-headers"];
  const cors = def.cors ? CORS_HEADERS(origin, typeof acrh === "string" ? acrh : undefined) : {};

  if (def.cors && method === "OPTIONS" && req.headers["access-control-request-method"]) {
    return { endpointId: "cors", responseId: "preflight", status: 204, headers: cors, body: "", latencyMs: 0 };
  }

  const qi = req.url.indexOf("?");
  const path = qi === -1 ? req.url : req.url.slice(0, qi);
  for (const ep of def.endpoints) {
    if (!ep.enabled) continue;
    if (ep.method !== "ANY" && ep.method !== method && !(ep.method === "GET" && method === "HEAD")) continue;
    const params = matchMockPath(ep.path, path);
    if (!params) continue;
    const v = view(req, params);
    const r = chooseResponse(ep, v, opts);
    if (!r) continue;
    const ctx: RenderContext = { request: v, random: opts.random ?? Math.random, now: opts.now ?? Date.now };
    const headers: Record<string, string> = {};
    let body = r.body ?? "";
    try {
      for (const [k, val] of Object.entries(r.headers ?? {})) headers[k.toLowerCase()] = r.templating ? renderTemplate(val, ctx, 8 * 1024) : val;
      if (r.templating) body = renderTemplate(body, ctx);
    } catch (err) {
      return {
        endpointId: ep.id,
        responseId: r.id,
        status: 500,
        headers: { "content-type": "application/json", ...cors },
        body: JSON.stringify({ error: `Mock template error: ${(err as Error).message}`, mock: true }),
        latencyMs: 0,
      };
    }
    if (!Object.keys(headers).some((k) => k === "content-type") && body) {
      const t = body.trimStart();
      headers["content-type"] = t.startsWith("{") || t.startsWith("[") ? "application/json" : "text/plain; charset=utf-8";
    }
    if (method === "HEAD") body = "";
    return {
      endpointId: ep.id,
      responseId: r.id,
      status: r.status,
      headers: { ...cors, ...headers },
      body,
      latencyMs: Math.min(MOCK_BOUNDS.latencyMs, Math.max(0, def.latencyMs) + Math.max(0, r.latencyMs ?? 0)),
    };
  }
  return null;
}

// ── Validation ────────────────────────────────────────────────────────────────

/** First problem with a definition, or null. `maxEndpoints` comes from the plan. */
export function mockDefinitionProblem(def: unknown, maxEndpoints: number): string | null {
  if (!def || typeof def !== "object") return "Definition must be an object";
  const d = def as Partial<MockApiDefinition>;
  if (!MOCK_MODES.includes(d.mode as MockMode)) return "mode must be ALWAYS or OFFLINE";
  if (typeof d.cors !== "boolean") return "cors must be true or false";
  if (typeof d.latencyMs !== "number" || d.latencyMs < 0 || d.latencyMs > MOCK_BOUNDS.latencyMs) return `latencyMs must be 0-${MOCK_BOUNDS.latencyMs}`;
  if (!Array.isArray(d.endpoints)) return "endpoints must be a list";
  if (d.endpoints.length > Math.min(maxEndpoints, MOCK_BOUNDS.endpointsHardCap)) return `At most ${Math.min(maxEndpoints, MOCK_BOUNDS.endpointsHardCap)} endpoints on your plan`;
  if (JSON.stringify(d).length > MOCK_BOUNDS.definitionBytes) return "The mock is too large";
  const ids = new Set<string>();
  for (const [i, ep] of d.endpoints.entries()) {
    const where = `Endpoint ${i + 1}${ep?.name ? ` (${ep.name})` : ""}`;
    if (!ep || typeof ep !== "object") return `${where}: must be an object`;
    if (typeof ep.id !== "string" || !ep.id || ids.has(ep.id)) return `${where}: needs a unique id`;
    ids.add(ep.id);
    if (!MOCK_METHODS.includes(ep.method)) return `${where}: unknown method ${String(ep.method)}`;
    if (typeof ep.path !== "string" || !ep.path.startsWith("/") || ep.path.length > MOCK_BOUNDS.pathLength || /[\s?#]/.test(ep.path))
      return `${where}: path must start with / and contain no spaces, ? or #`;
    if (ep.selection && !["rules", "sequential", "random"].includes(ep.selection)) return `${where}: unknown selection ${ep.selection}`;
    if (!Array.isArray(ep.responses) || ep.responses.length === 0) return `${where}: needs at least one response`;
    if (ep.responses.length > MOCK_BOUNDS.responsesPerEndpoint) return `${where}: at most ${MOCK_BOUNDS.responsesPerEndpoint} responses`;
    if (ep.responses.filter((r) => r?.isDefault).length > 1) return `${where}: only one default response`;
    const rids = new Set<string>();
    for (const [j, r] of ep.responses.entries()) {
      const rw = `${where}, response ${j + 1}`;
      if (!r || typeof r !== "object") return `${rw}: must be an object`;
      if (typeof r.id !== "string" || !r.id || rids.has(r.id)) return `${rw}: needs a unique id`;
      rids.add(r.id);
      if (!Number.isInteger(r.status) || r.status < 100 || r.status > 599) return `${rw}: status must be 100-599`;
      if (r.body !== undefined && typeof r.body !== "string") return `${rw}: body must be text`;
      if ((r.body ?? "").length > MOCK_BOUNDS.bodyBytes) return `${rw}: body is over ${MOCK_BOUNDS.bodyBytes / 1024} KB`;
      if (r.latencyMs !== undefined && (!Number.isFinite(r.latencyMs) || r.latencyMs < 0 || r.latencyMs > MOCK_BOUNDS.latencyMs)) return `${rw}: latency must be 0-${MOCK_BOUNDS.latencyMs} ms`;
      const hs = Object.entries(r.headers ?? {});
      if (hs.length > MOCK_BOUNDS.headersPerResponse) return `${rw}: at most ${MOCK_BOUNDS.headersPerResponse} headers`;
      for (const [k, val] of hs) {
        if (!HEADER_NAME.test(k)) return `${rw}: invalid header name "${k}"`;
        if (PROTECTED_HEADERS.has(k.toLowerCase())) return `${rw}: header ${k} is set by VhyxVoid`;
        if (typeof val !== "string" || /[\r\n]/.test(val) || val.length > 4000) return `${rw}: invalid value for header ${k}`;
      }
      if ((r.rules?.length ?? 0) > MOCK_BOUNDS.rulesPerResponse) return `${rw}: at most ${MOCK_BOUNDS.rulesPerResponse} rules`;
      for (const rule of r.rules ?? []) {
        if (!MOCK_RULE_SOURCES.includes(rule.source)) return `${rw}: unknown rule source ${String(rule.source)}`;
        if (!MOCK_RULE_OPS.includes(rule.op)) return `${rw}: unknown rule operator ${String(rule.op)}`;
        if (["query", "header", "param", "cookie"].includes(rule.source) && !rule.key) return `${rw}: a ${rule.source} rule needs a name`;
        if (rule.op === "regex") {
          if (!rule.value || rule.value.length > 300) return `${rw}: a regex rule needs a pattern (up to 300 characters)`;
          try {
            new RegExp(rule.value);
          } catch {
            return `${rw}: invalid regex ${rule.value}`;
          }
        }
      }
      if (r.templating) {
        const p = templateProblem(r.body ?? "") ?? hs.map(([, val]) => templateProblem(val)).find(Boolean) ?? null;
        if (p) return `${rw}: ${p}`;
      }
    }
  }
  return null;
}

// ── OpenAPI import / export ───────────────────────────────────────────────────

type Json = Record<string, unknown>;

let idSeq = 0;
/** Short ids, unique within a definition; random enough across saves. */
export function mockId(prefix: "e" | "r"): string {
  idSeq = (idSeq + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function resolveRef(spec: Json, node: unknown, seen: Set<string>): Json | undefined {
  if (!node || typeof node !== "object") return undefined;
  const ref = (node as Json).$ref;
  if (typeof ref !== "string") return node as Json;
  if (!ref.startsWith("#/") || seen.has(ref)) return undefined;
  seen.add(ref);
  const target = ref
    .slice(2)
    .split("/")
    .reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Json)[k.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), spec);
  return resolveRef(spec, target, seen);
}

/** An example value for a JSON schema: example > default > enum > by type/format. */
export function sampleFromSchema(spec: Json, schemaIn: unknown, depth = 0, seen: Set<string> = new Set()): unknown {
  const schema = resolveRef(spec, schemaIn, new Set(seen));
  if (!schema || depth > 8) return null;
  if ("example" in schema) return schema.example;
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  for (const k of ["allOf", "oneOf", "anyOf"] as const) {
    const list = schema[k];
    if (Array.isArray(list) && list.length) {
      if (k === "allOf") {
        const merged: Json = {};
        for (const part of list) {
          const s = sampleFromSchema(spec, part, depth + 1, seen);
          if (s && typeof s === "object" && !Array.isArray(s)) Object.assign(merged, s);
        }
        return merged;
      }
      return sampleFromSchema(spec, list[0], depth + 1, seen);
    }
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "object" || (!type && schema.properties)) {
    const out: Json = {};
    for (const [k, v] of Object.entries((schema.properties as Json) ?? {})) out[k] = sampleFromSchema(spec, v, depth + 1, seen);
    return out;
  }
  if (type === "array") {
    const item = sampleFromSchema(spec, schema.items, depth + 1, seen);
    return item === null ? [] : [item];
  }
  if (type === "integer") return typeof schema.minimum === "number" ? schema.minimum : 1;
  if (type === "number") return typeof schema.minimum === "number" ? schema.minimum : 1.5;
  if (type === "boolean") return true;
  if (type === "string") {
    switch (schema.format) {
      case "date-time":
        return "2026-01-01T00:00:00.000Z";
      case "date":
        return "2026-01-01";
      case "email":
        return "ada@example.com";
      case "uuid":
        return "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
      case "uri":
      case "url":
        return "https://example.com";
      case "ipv4":
        return "203.0.113.7";
      default:
        return "string";
    }
  }
  return null;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export interface OpenApiImport {
  title: string;
  description: string;
  endpoints: MockEndpoint[];
  warnings: string[];
}

/** Endpoints with example responses from an OpenAPI 3.x (or Swagger 2.0) document. */
export function importOpenApi(doc: unknown): OpenApiImport {
  if (!doc || typeof doc !== "object") throw new Error("Not an OpenAPI document");
  const spec = doc as Json;
  const isV3 = typeof spec.openapi === "string" && spec.openapi.startsWith("3");
  const isV2 = spec.swagger === "2.0";
  if (!isV3 && !isV2) throw new Error('Not an OpenAPI 3.x or Swagger 2.0 document (no "openapi: 3.x" or "swagger: 2.0")');
  const info = (spec.info as Json) ?? {};
  const basePath = isV2 && typeof spec.basePath === "string" && spec.basePath !== "/" ? spec.basePath.replace(/\/$/, "") : "";
  const warnings: string[] = [];
  const endpoints: MockEndpoint[] = [];
  for (const [rawPath, item] of Object.entries((spec.paths as Json) ?? {})) {
    if (!item || typeof item !== "object") continue;
    for (const m of HTTP_METHODS) {
      const op = (item as Json)[m] as Json | undefined;
      if (!op) continue;
      const responses: MockResponse[] = [];
      for (const [code, respIn] of Object.entries((op.responses as Json) ?? {})) {
        const resp = resolveRef(spec, respIn, new Set());
        const status = code === "default" ? 500 : Number(code.replace(/X/gi, "0"));
        if (!Number.isInteger(status) || status < 100 || status > 599) continue;
        let body = "";
        let contentType = "application/json";
        if (isV3) {
          const content = (resp?.content as Json) ?? {};
          const ct = Object.keys(content).find((c) => c.includes("json")) ?? Object.keys(content)[0];
          if (ct) {
            contentType = ct;
            const media = content[ct] as Json;
            const ex = media.example ?? (media.examples ? (resolveRef(spec, Object.values(media.examples as Json)[0], new Set())?.value ?? undefined) : undefined);
            const value = ex !== undefined ? ex : sampleFromSchema(spec, media.schema);
            body = value === undefined || value === null ? "" : typeof value === "string" && !ct.includes("json") ? value : JSON.stringify(value, null, 2);
          }
        } else {
          const ex = (resp?.examples as Json | undefined)?.["application/json"];
          const value = ex !== undefined ? ex : resp?.schema ? sampleFromSchema(spec, resp.schema) : undefined;
          if (value !== undefined && value !== null) body = JSON.stringify(value, null, 2);
        }
        if (body.length > MOCK_BOUNDS.bodyBytes) {
          warnings.push(`${m.toUpperCase()} ${rawPath} ${code}: example too large, left empty`);
          body = "";
        }
        responses.push({
          id: mockId("r"),
          name: String(resp?.description ?? code).slice(0, 80),
          status,
          headers: body ? { "content-type": contentType } : {},
          body,
        });
      }
      if (!responses.length) responses.push({ id: mockId("r"), name: "OK", status: 200, headers: {}, body: "" });
      // The first 2xx is the default; others are kept for rules or manual switching.
      responses.sort((a, b) => Number(!(a.status >= 200 && a.status < 300)) - Number(!(b.status >= 200 && b.status < 300)) || a.status - b.status);
      responses[0].isDefault = true;
      endpoints.push({
        id: mockId("e"),
        name: String(op.summary ?? op.operationId ?? `${m.toUpperCase()} ${rawPath}`).slice(0, 120),
        enabled: true,
        method: m.toUpperCase() as MockMethod,
        path: (basePath + rawPath).slice(0, MOCK_BOUNDS.pathLength),
        selection: "rules",
        responses: responses.slice(0, MOCK_BOUNDS.responsesPerEndpoint),
      });
    }
  }
  if (!endpoints.length) warnings.push("The document has no paths with operations");
  return { title: String(info.title ?? "Imported API").slice(0, 80), description: String(info.description ?? "").slice(0, 500), endpoints, warnings };
}

/** An OpenAPI 3.0 document describing a mock (examples = the mock's bodies). */
export function exportOpenApi(def: MockApiDefinition, meta: { title: string; description?: string; serverUrl?: string }): Json {
  const paths: Json = {};
  for (const ep of def.endpoints) {
    const path = ep.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}").replace(/\/\*$/, "/{wildcard}");
    const methods = ep.method === "ANY" ? ["get", "post", "put", "patch", "delete"] : [ep.method.toLowerCase()];
    const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const responses: Json = {};
    for (const r of ep.responses) {
      if (String(r.status) in responses) continue;
      const ct = r.headers?.["content-type"] ?? r.headers?.["Content-Type"] ?? "application/json";
      let example: unknown = r.body ?? "";
      if (ct.includes("json") && !r.templating) {
        try {
          example = JSON.parse(r.body ?? "");
        } catch {
          // keep text
        }
      }
      responses[String(r.status)] = { description: r.name || String(r.status), ...(r.body ? { content: { [ct]: { example } } } : {}) };
    }
    const target = (paths[path] ??= {}) as Json;
    for (const m of methods) target[m] = { summary: ep.name || `${ep.method} ${ep.path}`, ...(params.length ? { parameters: params } : {}), responses };
  }
  return {
    openapi: "3.0.3",
    info: { title: meta.title, version: "1.0.0", ...(meta.description ? { description: meta.description } : {}) },
    ...(meta.serverUrl ? { servers: [{ url: meta.serverUrl }] } : {}),
    paths,
  };
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface MockTemplate {
  key: string;
  name: string;
  description: string;
  endpoints: () => MockEndpoint[];
}

const ep = (method: MockMethod, path: string, name: string, responses: Omit<MockResponse, "id">[], selection: MockEndpoint["selection"] = "rules"): MockEndpoint => ({
  id: mockId("e"),
  name,
  enabled: true,
  method,
  path,
  selection,
  responses: responses.map((r) => ({ id: mockId("r"), ...r })),
});

const json = { "content-type": "application/json" };

export const MOCK_TEMPLATES: MockTemplate[] = [
  {
    key: "blank",
    name: "Blank",
    description: "One health endpoint to start from.",
    endpoints: () => [ep("GET", "/health", "Health", [{ name: "OK", status: 200, headers: json, body: '{ "ok": true }' }])],
  },
  {
    key: "rest-crud",
    name: "REST resource",
    description: "List, read, create, update and delete users, with realistic fake data and a 404 for unknown ids.",
    endpoints: () => [
      ep("GET", "/users", "List users", [
        {
          name: "Page of users",
          status: 200,
          headers: json,
          templating: true,
          body: '{\n  "data": [{{#repeat 5}}\n    { "id": "{{uuid}}", "name": "{{fullName}}", "email": "{{email}}", "company": "{{company}}" },{{/repeat}}\n  ]\n}',
        },
      ]),
      ep("GET", "/users/:id", "Get a user", [
        { name: "Not found", status: 404, headers: json, templating: true, body: '{ "error": "User {{request.params.id}} not found" }', rules: [{ source: "param", key: "id", op: "equals", value: "0" }] },
        { name: "Found", status: 200, headers: json, templating: true, isDefault: true, body: '{ "id": "{{request.params.id}}", "name": "{{fullName}}", "email": "{{email}}", "city": "{{city}}" }' },
      ]),
      ep("POST", "/users", "Create a user", [
        { name: "Missing email", status: 422, headers: json, body: '{ "error": "email is required" }', rules: [{ source: "body", key: "email", op: "not_exists" }] },
        { name: "Created", status: 201, headers: json, templating: true, isDefault: true, body: '{ "id": "{{uuid}}", "name": "{{request.body.name}}", "email": "{{request.body.email}}", "createdAt": "{{now}}" }' },
      ]),
      ep("PATCH", "/users/:id", "Update a user", [{ name: "Updated", status: 200, headers: json, templating: true, body: '{ "id": "{{request.params.id}}", "updated": {{json request.body}} }' }]),
      ep("DELETE", "/users/:id", "Delete a user", [{ name: "Deleted", status: 204, headers: {}, body: "" }]),
    ],
  },
  {
    key: "auth",
    name: "Auth",
    description: "Login that accepts one password, and a profile that needs a bearer token.",
    endpoints: () => [
      ep("POST", "/auth/login", "Log in", [
        { name: "Wrong password", status: 401, headers: json, body: '{ "error": "Invalid email or password" }', rules: [{ source: "body", key: "password", op: "not_equals", value: "secret" }] },
        { name: "Token", status: 200, headers: json, templating: true, isDefault: true, body: '{ "accessToken": "{{uuid}}", "expiresIn": 3600, "user": { "email": "{{request.body.email}}" } }' },
      ]),
      ep("GET", "/me", "Current user", [
        { name: "No token", status: 401, headers: { ...json, "www-authenticate": "Bearer" }, body: '{ "error": "Missing bearer token" }', rules: [{ source: "header", key: "authorization", op: "not_exists" }] },
        { name: "Profile", status: 200, headers: json, templating: true, isDefault: true, body: '{ "id": "{{uuid}}", "name": "{{fullName}}", "email": "{{email}}" }' },
      ]),
    ],
  },
  {
    key: "flaky",
    name: "Errors and slowness",
    description: "Endpoints that time out, rate limit and fail in turn, to test how your client copes.",
    endpoints: () => [
      ep("GET", "/slow", "Slow", [{ name: "Slow", status: 200, headers: json, latencyMs: 3000, body: '{ "ok": true, "tookMs": 3000 }' }]),
      ep(
        "GET",
        "/flaky",
        "Fails every other call",
        [
          { name: "OK", status: 200, headers: json, body: '{ "ok": true }' },
          { name: "Server error", status: 503, headers: { ...json, "retry-after": "1" }, body: '{ "error": "Temporarily unavailable" }' },
        ],
        "sequential",
      ),
      ep("GET", "/limited", "Rate limited", [{ name: "Too many", status: 429, headers: { ...json, "retry-after": "30" }, body: '{ "error": "Rate limit exceeded" }' }]),
    ],
  },
];

// ── Labels ────────────────────────────────────────────────────────────────────

/**
 * A mock's label is part of its hostname (<slug>--<label>), so it follows the
 * same rule as an agent's label (packages/protocol/src/label.ts): lowercase
 * letters, digits and single hyphens, 1-63 characters, no "--".
 */
export function mockLabelProblem(label: string): string | null {
  if (!label) return "Label is required";
  if (label.length > 63) return "Label must be at most 63 characters";
  if (label.includes("--")) return 'Label must not contain "--"';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return "Label may contain only lowercase letters, digits and hyphens, and must start and end with a letter or digit";
  return null;
}
