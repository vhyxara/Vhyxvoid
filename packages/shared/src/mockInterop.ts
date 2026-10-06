// packages/shared/src/mockInterop.ts
//
// Getting mocks in and out (internal-tools/shared/api-platform-plan.md, phase 2):
//
//   - endpointsFromCaptures: real traffic (inspector captures, HAR) -> endpoints,
//     with ids in paths turned into parameters;
//   - exports: Mock Service Worker handlers (TypeScript), Postman collection
//     v2.1, Mockoon environment, and VhyxVoid's own JSON (for `vhyxvoid mock`);
//   - imports: VhyxVoid JSON, Postman, Mockoon, HAR (OpenAPI lives in mockApi.ts),
//     with the format detected from the document.

import {
  MOCK_BOUNDS,
  importOpenApi,
  mockId,
  type MockApiDefinition,
  type MockEndpoint,
  type MockMethod,
  type MockMode,
  type MockResponse,
  type MockRule,
} from "./mockApi";
import { RESOURCE_BOUNDS, resourceId, type MockResource } from "./mockResources";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

// ── Captures -> endpoints ─────────────────────────────────────────────────────

export interface CapturedExchange {
  method: string;
  /** Path with query string, as requested. */
  path: string;
  status: number;
  responseHeaders?: Record<string, string>;
  /** Response body as text; null for binary or missing. */
  responseBody?: string | null;
  /** True when the body was cut (the inspector keeps 16 KB). */
  truncated?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a path segment looks like an id (number, UUID, long token with digits). */
export function isIdSegment(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (UUID_RE.test(seg)) return true;
  if (/^[0-9a-f]{16,}$/i.test(seg)) return true;
  // Stripe/Slack-style ids: prefix_ followed by a long mixed token.
  if (/^[A-Za-z]{1,8}_[A-Za-z0-9]{10,}$/.test(seg)) return true;
  return seg.length >= 20 && /\d/.test(seg) && /^[A-Za-z0-9_-]+$/.test(seg);
}

/** "/users/42/orders/abc-uuid" -> "/users/:id/orders/:id2", plus the concrete values. */
export function generalizePath(path: string): { pattern: string; values: Record<string, string> } {
  const clean = path.split("?")[0] || "/";
  const values: Record<string, string> = {};
  let n = 0;
  const segs = clean.split("/").map((seg, i) => {
    if (i === 0 || !seg || !isIdSegment(seg)) return seg;
    const name = n === 0 ? "id" : `id${n + 1}`;
    n++;
    values[name] = decodeURIComponent(seg);
    return `:${name}`;
  });
  return { pattern: segs.join("/") || "/", values };
}

const KEEP_HEADERS = new Set(["content-type", "location", "cache-control", "retry-after", "www-authenticate"]);

/**
 * Endpoints from real exchanges. One endpoint per method + generalized path;
 * one response per distinct status (the first body seen). The most frequent
 * 2xx is the default; other statuses get a rule on the id they were seen
 * with, so the mock reproduces "404 for that id" style behaviour.
 */
export function endpointsFromCaptures(captures: readonly CapturedExchange[]): { endpoints: MockEndpoint[]; warnings: string[] } {
  const warnings: string[] = [];
  const groups = new Map<string, { method: MockMethod; pattern: string; byStatus: Map<number, { c: CapturedExchange; values: Record<string, string>; count: number }> }>();
  for (const c of captures) {
    const method = c.method.toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) continue;
    if (!Number.isInteger(c.status) || c.status < 100 || c.status > 599) continue;
    const { pattern, values } = generalizePath(c.path);
    const key = `${method} ${pattern}`;
    let g = groups.get(key);
    if (!g) {
      g = { method: method as MockMethod, pattern, byStatus: new Map() };
      groups.set(key, g);
    }
    const prev = g.byStatus.get(c.status);
    if (prev) prev.count++;
    else g.byStatus.set(c.status, { c, values, count: 1 });
  }
  const endpoints: MockEndpoint[] = [];
  for (const g of groups.values()) {
    const entries = [...g.byStatus.entries()].sort((a, b) => {
      const ok = (s: number) => (s >= 200 && s < 300 ? 0 : 1);
      return ok(a[0]) - ok(b[0]) || b[1].count - a[1].count || a[0] - b[0];
    });
    const responses: MockResponse[] = entries.slice(0, MOCK_BOUNDS.responsesPerEndpoint).map(([status, { c, values }], i) => {
      const headers = Object.fromEntries(Object.entries(c.responseHeaders ?? {}).filter(([k]) => KEEP_HEADERS.has(k.toLowerCase())).map(([k, v]) => [k.toLowerCase(), v]));
      let body = c.responseBody ?? "";
      if (c.truncated) warnings.push(`${g.method} ${g.pattern} ${status}: the captured body was cut at 16 KB; check it before relying on it`);
      if (body.length > MOCK_BOUNDS.bodyBytes) {
        warnings.push(`${g.method} ${g.pattern} ${status}: body too large, left empty`);
        body = "";
      }
      const firstParam = Object.keys(values)[0];
      const rules: MockRule[] | undefined = i > 0 && firstParam ? [{ source: "param", key: firstParam, op: "equals", value: values[firstParam] }] : undefined;
      return { id: mockId("r"), name: statusName(status), status, headers, body, ...(rules ? { rules } : {}), ...(i === 0 ? { isDefault: true } : {}) };
    });
    endpoints.push({ id: mockId("e"), name: "", enabled: true, method: g.method, path: g.pattern.slice(0, MOCK_BOUNDS.pathLength), selection: "rules", responses });
  }
  // Static paths before parameterised ones, so /users/me wins over /users/:id.
  endpoints.sort((a, b) => Number(a.path.includes(":")) - Number(b.path.includes(":")) || a.path.localeCompare(b.path));
  return { endpoints, warnings };
}

const STATUS_NAMES: Record<number, string> = { 200: "OK", 201: "Created", 202: "Accepted", 204: "No content", 301: "Moved", 302: "Found", 304: "Not modified", 400: "Bad request", 401: "Unauthorized", 403: "Forbidden", 404: "Not found", 409: "Conflict", 422: "Invalid", 429: "Too many requests", 500: "Server error", 502: "Bad gateway", 503: "Unavailable", 504: "Timeout" };
const statusName = (s: number) => STATUS_NAMES[s] ?? String(s);

// ── Native format ─────────────────────────────────────────────────────────────

export interface NativeMockFile {
  vhyxvoid: "mock-api";
  version: 1;
  name: string;
  description?: string;
  mode: MockMode;
  cors: boolean;
  latencyMs: number;
  endpoints: MockEndpoint[];
  resources: MockResource[];
}

export function exportNative(def: MockApiDefinition, meta: { name: string; description?: string }): NativeMockFile {
  return { vhyxvoid: "mock-api", version: 1, name: meta.name, ...(meta.description ? { description: meta.description } : {}), mode: def.mode, cors: def.cors, latencyMs: def.latencyMs, endpoints: def.endpoints, resources: def.resources ?? [] };
}

// ── Mock Service Worker ───────────────────────────────────────────────────────

const q = (s: string) => JSON.stringify(s);
const mswPath = (p: string) => p.replace(/\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g, ":$1");

function mswRule(r: MockRule): string {
  const val = (() => {
    switch (r.source) {
      case "query":
        return `url.searchParams.get(${q(r.key ?? "")}) ?? undefined`;
      case "header":
        return `request.headers.get(${q(r.key ?? "")}) ?? undefined`;
      case "param":
        return `(params[${q(r.key ?? "")}] as string | undefined)`;
      case "cookie":
        return `cookies[${q(r.key ?? "")}]`;
      case "method":
        return "request.method";
      case "path":
        return "url.pathname";
      case "body":
        return r.key ? `str(at(body, ${q(r.key)}))` : "rawBody";
    }
  })();
  // Parenthesised: the values use ??, which can't be mixed with && / || bare.
  const v = `(${val})`;
  switch (r.op) {
    case "equals":
      return `${v} === ${q(r.value ?? "")}`;
    case "not_equals":
      return `${v} !== ${q(r.value ?? "")}`;
    case "contains":
      return `(${v} ?? '').includes(${q(r.value ?? "")})`;
    case "exists":
      return `!!${v}`;
    case "not_exists":
      return `!${v}`;
    case "regex":
      return `new RegExp(${q(r.value ?? "")}).test(${v} ?? '')`;
  }
}

function mswReturn(r: MockResponse, indent: string): string {
  const headers = { ...(r.headers ?? {}) };
  const init = `{ status: ${r.status}${Object.keys(headers).length ? `, headers: ${JSON.stringify(headers)}` : ""} }`;
  const delay = r.latencyMs ? `${indent}await delay(${r.latencyMs})\n` : "";
  const note = r.templating ? `${indent}// Templated in VhyxVoid: {{…}} tags are sent as written here.\n` : "";
  const body = r.body ? q(r.body) : "null";
  return `${note}${delay}${indent}return new HttpResponse(${body}, ${init})`;
}

/** A TypeScript module of MSW v2 handlers that behaves like the mock (rules, sequence, resources). */
export function exportMsw(def: MockApiDefinition, meta: { name: string; baseUrl?: string }): string {
  const base = meta.baseUrl ?? "";
  const lines: string[] = [];
  lines.push(`// Mock Service Worker handlers for the VhyxVoid mock API ${q(meta.name)}.`);
  lines.push(`// Generated ${new Date().toISOString().slice(0, 10)}. Use with msw v2: setupWorker(...handlers) or setupServer(...handlers).`);
  lines.push(`import { http, HttpResponse, delay } from 'msw'`);
  lines.push("");
  lines.push(`/** Where requests go; '' matches any origin (relative URLs). */`);
  lines.push(`export const BASE_URL = ${q(base)}`);
  lines.push("");
  lines.push(`const at = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o)`);
  lines.push(`const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : typeof v === 'object' ? JSON.stringify(v) : String(v))`);
  lines.push(`const sequence = new Map<string, number>()`);
  lines.push(`const next = (id: string, n: number) => { const i = sequence.get(id) ?? 0; sequence.set(id, i + 1); return i % n }`);
  if (def.latencyMs) lines.push(`const LATENCY_MS = ${def.latencyMs}`);
  // Resource seed data first: the handlers array below uses it.
  const enabledResources = (def.resources ?? []).filter((x) => x.enabled);
  const dataVar = (i: number) => `data_${i}_${enabledResources[i].name.replace(/[^A-Za-z0-9]/g, "_")}`;
  enabledResources.forEach((r, i) => lines.push(`const ${dataVar(i)}: Array<Record<string, unknown>> = ${JSON.stringify(r.seed, null, 2)}`));
  lines.push("");
  lines.push(`export const handlers = [`);
  for (const ep of def.endpoints.filter((e) => e.enabled)) {
    const fn = ep.method === "ANY" ? "all" : ep.method.toLowerCase();
    const needsBody = ep.responses.some((r) => r.rules?.some((x) => x.source === "body"));
    lines.push(`  // ${ep.name || `${ep.method} ${ep.path}`}`);
    lines.push(`  http.${fn}(\`\${BASE_URL}${mswPath(ep.path).replace(/`/g, "\\`")}\`, async ({ request, params, cookies }) => {`);
    lines.push(`    void params; void cookies`);
    lines.push(`    const url = new URL(request.url)`);
    lines.push(`    void url`);
    if (needsBody) {
      lines.push(`    const rawBody = await request.clone().text()`);
      lines.push(`    let body: unknown = undefined`);
      lines.push(`    try { body = JSON.parse(rawBody) } catch { body = undefined }`);
    }
    if (def.latencyMs) lines.push(`    await delay(LATENCY_MS)`);
    const sel = ep.selection ?? "rules";
    if (sel === "sequential" || sel === "random") {
      lines.push(`    const pick = ${sel === "sequential" ? `next(${q(ep.id)}, ${ep.responses.length})` : `Math.floor(Math.random() * ${ep.responses.length})`}`);
      ep.responses.forEach((r, i) => {
        lines.push(`    if (pick === ${i}) {`);
        lines.push(mswReturn(r, "      "));
        lines.push(`    }`);
      });
      lines.push(`    return new HttpResponse(null, { status: 500 })`);
    } else {
      const fallback = ep.responses.find((r) => r.isDefault) ?? ep.responses.find((r) => !r.rules?.length) ?? ep.responses[0];
      for (const r of ep.responses) {
        if (!r.rules?.length || r === fallback) continue;
        const cond = r.rules.map(mswRule).join(r.rulesMatch === "any" ? " || " : " && ");
        lines.push(`    if (${cond}) {`);
        lines.push(mswReturn(r, "      "));
        lines.push(`    }`);
      }
      lines.push(mswReturn(fallback, "    "));
    }
    lines.push(`  }),`);
  }
  for (const [i, r] of enabledResources.entries()) {
    const field = r.idField || "id";
    const v = dataVar(i);
    lines.push(`  // Resource ${r.name}: an in-memory collection like the hosted one.`);
    lines.push(`  ...resource(\`\${BASE_URL}${r.path}\`, ${q(field)}, ${v}),`);
  }
  lines.push(`]`);
  if ((def.resources ?? []).some((x) => x.enabled)) {
    lines.push("");
    lines.push(`function resource(path: string, idField: string, items: Array<Record<string, unknown>>) {`);
    lines.push(`  const find = (id: unknown) => items.findIndex((x) => String(x[idField]) === String(id))`);
    lines.push(`  return [`);
    lines.push(`    http.get(path, ({ request }) => {`);
    lines.push(`      const url = new URL(request.url)`);
    lines.push(`      let out = items.filter((x) => [...url.searchParams].every(([k, v]) => k.startsWith('_') || k === 'q' || String(x[k]) === v))`);
    lines.push(`      const q = url.searchParams.get('q')`);
    lines.push(`      if (q) out = out.filter((x) => JSON.stringify(x).toLowerCase().includes(q.toLowerCase()))`);
    lines.push(`      return HttpResponse.json(out, { headers: { 'x-total-count': String(out.length) } })`);
    lines.push(`    }),`);
    lines.push(`    http.post(path, async ({ request }) => {`);
    lines.push(`      const item = (await request.json()) as Record<string, unknown>`);
    lines.push(`      if (item[idField] === undefined) item[idField] = items.length ? Math.max(...items.map((x) => Number(x[idField]) || 0)) + 1 : 1`);
    lines.push(`      if (find(item[idField]) !== -1) return HttpResponse.json({ error: 'already exists' }, { status: 409 })`);
    lines.push(`      items.push(item)`);
    lines.push(`      return HttpResponse.json(item, { status: 201 })`);
    lines.push(`    }),`);
    lines.push(`    http.get(\`\${path}/:id\`, ({ params }) => { const i = find(params.id); return i === -1 ? HttpResponse.json({ error: 'not found' }, { status: 404 }) : HttpResponse.json(items[i]) }),`);
    lines.push(`    http.put(\`\${path}/:id\`, async ({ params, request }) => { const i = find(params.id); if (i === -1) return HttpResponse.json({ error: 'not found' }, { status: 404 }); items[i] = { ...((await request.json()) as object), [idField]: items[i][idField] }; return HttpResponse.json(items[i]) }),`);
    lines.push(`    http.patch(\`\${path}/:id\`, async ({ params, request }) => { const i = find(params.id); if (i === -1) return HttpResponse.json({ error: 'not found' }, { status: 404 }); items[i] = { ...items[i], ...((await request.json()) as object), [idField]: items[i][idField] }; return HttpResponse.json(items[i]) }),`);
    lines.push(`    http.delete(\`\${path}/:id\`, ({ params }) => { const i = find(params.id); if (i === -1) return HttpResponse.json({ error: 'not found' }, { status: 404 }); items.splice(i, 1); return new HttpResponse(null, { status: 204 }) }),`);
    lines.push(`  ]`);
    lines.push(`}`);
  }
  return lines.join("\n") + "\n";
}

// ── Postman ───────────────────────────────────────────────────────────────────

const POSTMAN_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

function postmanUrl(path: string) {
  const p = mswPath(path);
  return { raw: `{{baseUrl}}${p}`, host: ["{{baseUrl}}"], path: p.split("/").filter(Boolean) };
}

/** A Postman v2.1 collection: one request per endpoint, each response as a saved example. */
export function exportPostman(def: MockApiDefinition, meta: { name: string; description?: string; baseUrl?: string }): Json {
  const items: Json[] = def.endpoints.map((ep) => {
    const method = ep.method === "ANY" ? "GET" : ep.method;
    const request = { method, header: [], url: postmanUrl(ep.path) };
    return {
      name: ep.name || `${ep.method} ${ep.path}`,
      request,
      response: ep.responses.map((r) => ({
        name: r.name || String(r.status),
        originalRequest: request,
        code: r.status,
        status: statusName(r.status),
        header: Object.entries(r.headers ?? {}).map(([key, value]) => ({ key, value })),
        body: r.body ?? "",
        _postman_previewlanguage: (r.headers?.["content-type"] ?? "").includes("json") ? "json" : "text",
      })),
    };
  });
  for (const r of def.resources ?? []) {
    const one = `${r.path}/:id`;
    items.push({
      name: r.name,
      item: [
        { name: `List ${r.name}`, request: { method: "GET", header: [], url: postmanUrl(r.path) } },
        { name: `Create ${r.name}`, request: { method: "POST", header: [{ key: "content-type", value: "application/json" }], url: postmanUrl(r.path), body: { mode: "raw", raw: JSON.stringify(r.seed[0] ?? {}, null, 2) } } },
        { name: `Get ${r.name}`, request: { method: "GET", header: [], url: postmanUrl(one) } },
        { name: `Update ${r.name}`, request: { method: "PATCH", header: [{ key: "content-type", value: "application/json" }], url: postmanUrl(one), body: { mode: "raw", raw: "{}" } } },
        { name: `Delete ${r.name}`, request: { method: "DELETE", header: [], url: postmanUrl(one) } },
      ],
    });
  }
  return {
    info: { name: meta.name, ...(meta.description ? { description: meta.description } : {}), schema: POSTMAN_SCHEMA },
    variable: [{ key: "baseUrl", value: meta.baseUrl ?? "http://localhost:3000" }],
    item: items,
  };
}

// ── Mockoon ───────────────────────────────────────────────────────────────────

/** Our template tags in Mockoon's Handlebars helpers (common ones; others are left as written). */
export function toMockoonTemplate(src: string): string {
  return src
    .replace(/\{\{\s*request\.params\.([^}\s]+)\s*\}\}/g, "{{urlParam '$1'}}")
    .replace(/\{\{\s*request\.query\.([^}\s]+)\s*\}\}/g, "{{queryParam '$1'}}")
    .replace(/\{\{\s*request\.body\.([^}\s]+)\s*\}\}/g, "{{body '$1'}}")
    .replace(/\{\{\s*request\.headers\.([^}\s]+)\s*\}\}/g, "{{header '$1'}}")
    .replace(/\{\{\s*request\.cookies\.([^}\s]+)\s*\}\}/g, "{{cookie '$1'}}")
    .replace(/\{\{\s*request\.method\s*\}\}/g, "{{method}}")
    .replace(/\{\{\s*request\.path\s*\}\}/g, "{{urlParam '*'}}")
    .replace(/\{\{\s*json request\.body\s*\}\}/g, "{{{bodyRaw}}}")
    .replace(/\{\{\s*uuid\s*\}\}/g, "{{faker 'string.uuid'}}")
    .replace(/\{\{\s*now\s*\}\}/g, "{{now}}")
    .replace(/\{\{\s*timestamp\s*\}\}/g, "{{dateTimeShift format='t'}}")
    .replace(/\{\{\s*fullName\s*\}\}/g, "{{faker 'person.fullName'}}")
    .replace(/\{\{\s*firstName\s*\}\}/g, "{{faker 'person.firstName'}}")
    .replace(/\{\{\s*lastName\s*\}\}/g, "{{faker 'person.lastName'}}")
    .replace(/\{\{\s*email\s*\}\}/g, "{{faker 'internet.email'}}")
    .replace(/\{\{\s*company\s*\}\}/g, "{{faker 'company.name'}}")
    .replace(/\{\{\s*city\s*\}\}/g, "{{faker 'location.city'}}")
    .replace(/\{\{\s*country\s*\}\}/g, "{{faker 'location.country'}}")
    .replace(/\{\{\s*bool\s*\}\}/g, "{{boolean}}")
    .replace(/\{\{\s*lorem\s+(\d+)\s*\}\}/g, "{{faker 'lorem.words' $1}}")
    .replace(/\{\{\s*pick\s+([^}]+)\}\}/g, (_m, a: string) => `{{oneOf (array ${a.trim()})}}`)
    .replace(/\{\{\s*#repeat\s+(\d+)\s+(\d+)\s*\}\}/g, "{{#repeat $1 $2 comma=true}}")
    .replace(/\{\{\s*#repeat\s+(\d+)\s*\}\}/g, "{{#repeat $1 comma=true}}");
}

const uuid4 = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID ? g.crypto.randomUUID() : mockId("e");
};

const MOCKOON_TARGET: Record<MockRule["source"], string> = { query: "query", header: "header", param: "params", cookie: "cookie", body: "body", method: "method", path: "path" };

function mockoonRule(r: MockRule): Json {
  const base = { target: MOCKOON_TARGET[r.source], modifier: r.key ?? "" };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  switch (r.op) {
    case "equals":
      return { ...base, value: r.value ?? "", invert: false, operator: "equals" };
    case "not_equals":
      return { ...base, value: r.value ?? "", invert: true, operator: "equals" };
    case "contains":
      return { ...base, value: esc(r.value ?? ""), invert: false, operator: "regex" };
    case "regex":
      return { ...base, value: r.value ?? "", invert: false, operator: "regex" };
    case "exists":
      return { ...base, value: "", invert: true, operator: "null" };
    case "not_exists":
      return { ...base, value: "", invert: false, operator: "null" };
  }
}

/** A Mockoon environment (import it in the Mockoon app or run it with @mockoon/cli). */
export function exportMockoon(def: MockApiDefinition, meta: { name: string; port?: number }): Json {
  const data = (def.resources ?? []).map((r) => ({ uuid: uuid4(), id: r.id.slice(-6).replace(/[^a-z0-9]/gi, "x"), name: r.name, documentation: "", value: JSON.stringify(r.seed, null, 2) }));
  const routes: Json[] = def.endpoints.map((ep) => ({
    uuid: uuid4(),
    type: "http",
    documentation: ep.name ?? "",
    method: ep.method === "ANY" ? "all" : ep.method.toLowerCase(),
    endpoint: mswPath(ep.path).replace(/^\//, ""),
    responses: ep.responses.map((r) => ({
      uuid: uuid4(),
      body: r.templating ? toMockoonTemplate(r.body ?? "") : (r.body ?? ""),
      latency: r.latencyMs ?? 0,
      statusCode: r.status,
      label: r.name ?? "",
      headers: Object.entries(r.headers ?? {}).map(([key, value]) => ({ key, value })),
      bodyType: "INLINE",
      filePath: "",
      databucketID: "",
      sendFileAsBody: false,
      rules: (r.rules ?? []).map(mockoonRule),
      rulesOperator: r.rulesMatch === "any" ? "OR" : "AND",
      disableTemplating: !r.templating,
      fallbackTo404: false,
      default: r === (ep.responses.find((x) => x.isDefault) ?? ep.responses.find((x) => !x.rules?.length) ?? ep.responses[0]),
      crudKey: "id",
      callbacks: [],
    })),
    responseMode: ep.selection === "sequential" ? "SEQUENTIAL" : ep.selection === "random" ? "RANDOM" : null,
    streamingMode: null,
    streamingInterval: 0,
  }));
  (def.resources ?? []).forEach((r, i) => {
    routes.push({
      uuid: uuid4(),
      type: "crud",
      documentation: `Resource ${r.name}`,
      method: "",
      endpoint: r.path.replace(/^\//, ""),
      responses: [
        {
          uuid: uuid4(),
          body: "{}",
          latency: 0,
          statusCode: 200,
          label: "CRUD",
          headers: [],
          bodyType: "DATABUCKET",
          filePath: "",
          databucketID: data[i].id,
          sendFileAsBody: false,
          rules: [],
          rulesOperator: "OR",
          disableTemplating: false,
          fallbackTo404: false,
          default: true,
          crudKey: r.idField || "id",
          callbacks: [],
        },
      ],
      responseMode: null,
      streamingMode: null,
      streamingInterval: 0,
    });
  });
  return {
    uuid: uuid4(),
    lastMigration: 32,
    name: meta.name,
    endpointPrefix: "",
    latency: def.latencyMs,
    port: meta.port ?? 3000,
    hostname: "",
    folders: [],
    routes,
    rootChildren: routes.map((r) => ({ type: "route", uuid: r.uuid })),
    proxyMode: false,
    proxyHost: "",
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, type: "CERT", pfxPath: "", certPath: "", keyPath: "", caPath: "", passphrase: "" },
    cors: def.cors,
    headers: [],
    proxyReqHeaders: [],
    proxyResHeaders: [],
    data,
    callbacks: [],
  };
}

// ── Imports ───────────────────────────────────────────────────────────────────

export type MockImportFormat = "vhyxvoid" | "openapi" | "postman" | "mockoon" | "har";

export interface MockImport {
  format: MockImportFormat;
  title: string;
  description: string;
  endpoints: MockEndpoint[];
  resources: MockResource[];
  warnings: string[];
  /** Settings carried by formats that have them (VhyxVoid, Mockoon). */
  settings?: Partial<Pick<MockApiDefinition, "mode" | "cors" | "latencyMs">>;
}

export function detectMockFormat(doc: unknown): MockImportFormat | null {
  if (!isObj(doc)) return null;
  if (doc.vhyxvoid === "mock-api") return "vhyxvoid";
  if ((typeof doc.openapi === "string" && doc.openapi.startsWith("3")) || doc.swagger === "2.0") return "openapi";
  if (isObj(doc.info) && Array.isArray(doc.item) && (String(doc.info.schema ?? "").includes("postman") || "_postman_id" in doc.info)) return "postman";
  if (Array.isArray(doc.routes) && ("lastMigration" in doc || "endpointPrefix" in doc)) return "mockoon";
  if (isObj(doc.log) && Array.isArray(doc.log.entries)) return "har";
  return null;
}

function importNative(doc: Json): MockImport {
  const endpoints = (Array.isArray(doc.endpoints) ? doc.endpoints : []) as MockEndpoint[];
  const resources = (Array.isArray(doc.resources) ? doc.resources : []) as MockResource[];
  return {
    format: "vhyxvoid",
    title: String(doc.name ?? "Imported mock").slice(0, 80),
    description: String(doc.description ?? "").slice(0, 500),
    // Fresh ids, so importing into a mock that has the same endpoints never collides.
    endpoints: endpoints.map((e) => ({ ...e, id: mockId("e"), responses: (e.responses ?? []).map((r) => ({ ...r, id: mockId("r") })) })),
    resources: resources.map((r) => ({ ...r, id: resourceId() })),
    warnings: [],
    settings: {
      ...(doc.mode === "ALWAYS" || doc.mode === "OFFLINE" ? { mode: doc.mode as MockMode } : {}),
      ...(typeof doc.cors === "boolean" ? { cors: doc.cors } : {}),
      ...(typeof doc.latencyMs === "number" ? { latencyMs: doc.latencyMs } : {}),
    },
  };
}

/** Postman URL (string or object) -> path with :params. */
function postmanPath(url: unknown): string | null {
  let raw: string;
  if (typeof url === "string") raw = url;
  else if (isObj(url)) {
    if (Array.isArray(url.path)) raw = "/" + (url.path as unknown[]).map((p) => (isObj(p) ? String(p.value ?? "") : String(p))).join("/");
    else raw = String(url.raw ?? "");
  } else return null;
  raw = raw.replace(/^\{\{[^}]+\}\}/, "").replace(/^[a-z]+:\/\/[^/]+/i, "");
  raw = raw.split("?")[0];
  raw = raw.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, ":$1");
  if (!raw.startsWith("/")) raw = `/${raw}`;
  return raw.replace(/\/{2,}/g, "/");
}

function importPostman(doc: Json): MockImport {
  const warnings: string[] = [];
  const endpoints: MockEndpoint[] = [];
  const walk = (items: unknown[]) => {
    for (const it of items) {
      if (!isObj(it)) continue;
      if (Array.isArray(it.item)) {
        walk(it.item);
        continue;
      }
      const req = it.request;
      const method = String((isObj(req) ? req.method : "GET") ?? "GET").toUpperCase();
      const path = postmanPath(isObj(req) ? req.url : req);
      if (!path || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) continue;
      const examples = Array.isArray(it.response) ? (it.response as unknown[]).filter(isObj) : [];
      const responses: MockResponse[] = examples.slice(0, MOCK_BOUNDS.responsesPerEndpoint).map((ex) => {
        const headers = Array.isArray(ex.header) ? Object.fromEntries((ex.header as unknown[]).filter(isObj).filter((h) => KEEP_HEADERS.has(String(h.key).toLowerCase())).map((h) => [String(h.key).toLowerCase(), String(h.value ?? "")])) : {};
        let body = typeof ex.body === "string" ? ex.body : "";
        if (body.length > MOCK_BOUNDS.bodyBytes) {
          warnings.push(`${method} ${path}: example "${ex.name}" too large, left empty`);
          body = "";
        }
        if (body.includes("{{")) warnings.push(`${method} ${path}: example "${ex.name}" contains {{…}}; templating is off for it`);
        const code = Number(ex.code);
        return { id: mockId("r"), name: String(ex.name ?? code).slice(0, 80), status: code >= 100 && code <= 599 ? code : 200, headers, body };
      });
      if (!responses.length) {
        responses.push({ id: mockId("r"), name: "OK", status: 200, headers: { "content-type": "application/json" }, body: "{}" });
        warnings.push(`${method} ${path}: no saved example in Postman; answers {} until you edit it`);
      }
      responses.sort((a, b) => Number(!(a.status >= 200 && a.status < 300)) - Number(!(b.status >= 200 && b.status < 300)));
      responses[0].isDefault = true;
      endpoints.push({ id: mockId("e"), name: String(it.name ?? "").slice(0, 120), enabled: true, method: method as MockMethod, path: path.slice(0, MOCK_BOUNDS.pathLength), selection: "rules", responses });
    }
  };
  walk(Array.isArray(doc.item) ? doc.item : []);
  const info = isObj(doc.info) ? doc.info : {};
  return { format: "postman", title: String(info.name ?? "Postman collection").slice(0, 80), description: typeof info.description === "string" ? info.description.slice(0, 500) : "", endpoints, resources: [], warnings };
}

const FROM_MOCKOON_TARGET: Record<string, MockRule["source"]> = { query: "query", header: "header", params: "param", cookie: "cookie", body: "body", method: "method", path: "path" };

function importMockoon(doc: Json): MockImport {
  const warnings: string[] = [];
  const endpoints: MockEndpoint[] = [];
  const resources: MockResource[] = [];
  const buckets = new Map<string, Json>();
  for (const d of Array.isArray(doc.data) ? (doc.data as unknown[]) : []) if (isObj(d)) buckets.set(String(d.id), d);
  for (const route of Array.isArray(doc.routes) ? (doc.routes as unknown[]) : []) {
    if (!isObj(route)) continue;
    const path = `/${String(route.endpoint ?? "").replace(/^\//, "")}`.replace(/\/$/, "") || "/";
    if (route.type === "crud") {
      const first = Array.isArray(route.responses) && isObj(route.responses[0]) ? route.responses[0] : {};
      const bucket = buckets.get(String(first.databucketID ?? ""));
      let seed: unknown = [];
      try {
        seed = bucket ? JSON.parse(String(bucket.value ?? "[]")) : [];
      } catch {
        warnings.push(`CRUD ${path}: its data bucket is not JSON (templated?); starts empty`);
      }
      if (!Array.isArray(seed) || seed.some((x) => !isObj(x))) {
        warnings.push(`CRUD ${path}: data is not a list of objects; starts empty`);
        seed = [];
      }
      resources.push({
        id: resourceId(),
        name: String(bucket?.name ?? path.slice(1) ?? "items").replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 60) || "items",
        path: path === "/" ? "/items" : path,
        enabled: true,
        idField: typeof first.crudKey === "string" && first.crudKey ? first.crudKey : "id",
        seed: (seed as Array<Record<string, unknown>>).slice(0, RESOURCE_BOUNDS.seedItems),
      });
      continue;
    }
    const method = String(route.method ?? "get").toLowerCase();
    const mm = method === "all" ? "ANY" : method.toUpperCase();
    if (!["ANY", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(mm)) continue;
    const responses: MockResponse[] = [];
    for (const resp of Array.isArray(route.responses) ? (route.responses as unknown[]) : []) {
      if (!isObj(resp)) continue;
      if (resp.bodyType && resp.bodyType !== "INLINE") warnings.push(`${mm} ${path}: response "${resp.label ?? resp.statusCode}" sends a file or data bucket; its body is left empty`);
      const body = resp.bodyType && resp.bodyType !== "INLINE" ? "" : String(resp.body ?? "");
      if (body.includes("{{") && resp.disableTemplating !== true) warnings.push(`${mm} ${path}: response "${resp.label || resp.statusCode}" uses Mockoon templating, which is kept as text`);
      const rules: MockRule[] = [];
      for (const rr of Array.isArray(resp.rules) ? (resp.rules as unknown[]) : []) {
        if (!isObj(rr)) continue;
        const source = FROM_MOCKOON_TARGET[String(rr.target)];
        if (!source) {
          warnings.push(`${mm} ${path}: rule on "${rr.target}" isn't supported and was dropped`);
          continue;
        }
        const invert = rr.invert === true;
        const op = rr.operator === "equals" ? (invert ? "not_equals" : "equals") : rr.operator === "regex" && !invert ? "regex" : rr.operator === "null" ? (invert ? "exists" : "not_exists") : null;
        if (!op) {
          warnings.push(`${mm} ${path}: rule operator "${rr.operator}"${invert ? " (inverted)" : ""} isn't supported and was dropped`);
          continue;
        }
        rules.push({ source, ...(rr.modifier ? { key: String(rr.modifier) } : {}), op, ...(op === "exists" || op === "not_exists" ? {} : { value: String(rr.value ?? "") }) });
      }
      const status = Number(resp.statusCode);
      responses.push({
        id: mockId("r"),
        name: String(resp.label ?? "").slice(0, 80) || statusName(status),
        status: status >= 100 && status <= 599 ? status : 200,
        headers: Array.isArray(resp.headers) ? Object.fromEntries((resp.headers as unknown[]).filter(isObj).map((h) => [String(h.key), String(h.value ?? "")])) : {},
        body: body.slice(0, MOCK_BOUNDS.bodyBytes),
        ...(Number(resp.latency) > 0 ? { latencyMs: Math.min(MOCK_BOUNDS.latencyMs, Number(resp.latency)) } : {}),
        ...(rules.length ? { rules: rules.slice(0, MOCK_BOUNDS.rulesPerResponse), rulesMatch: resp.rulesOperator === "OR" ? ("any" as const) : ("all" as const) } : {}),
        ...(resp.default === true ? { isDefault: true } : {}),
      });
    }
    if (!responses.length) continue;
    if (responses.filter((r) => r.isDefault).length !== 1) {
      responses.forEach((r) => delete r.isDefault);
      (responses.find((r) => !r.rules?.length) ?? responses[0]).isDefault = true;
    }
    endpoints.push({
      id: mockId("e"),
      name: String(route.documentation ?? "").slice(0, 120),
      enabled: route.enabled !== false,
      method: mm as MockMethod,
      path: path.slice(0, MOCK_BOUNDS.pathLength),
      selection: route.responseMode === "SEQUENTIAL" ? "sequential" : route.responseMode === "RANDOM" ? "random" : "rules",
      responses: responses.slice(0, MOCK_BOUNDS.responsesPerEndpoint),
    });
  }
  return {
    format: "mockoon",
    title: String(doc.name ?? "Mockoon environment").slice(0, 80),
    description: "",
    endpoints,
    resources: resources.slice(0, RESOURCE_BOUNDS.resourcesPerMock),
    warnings,
    settings: { ...(typeof doc.cors === "boolean" ? { cors: doc.cors } : {}), ...(typeof doc.latency === "number" ? { latencyMs: Math.min(MOCK_BOUNDS.latencyMs, doc.latency) } : {}) },
  };
}

function importHar(doc: Json): MockImport {
  const log = doc.log as Json;
  const captures: CapturedExchange[] = [];
  for (const e of (log.entries as unknown[]).filter(isObj)) {
    const req = isObj(e.request) ? e.request : {};
    const res = isObj(e.response) ? e.response : {};
    let path = "/";
    try {
      const u = new URL(String(req.url ?? ""));
      path = u.pathname + u.search;
    } catch {
      continue;
    }
    const headers = Array.isArray(res.headers) ? Object.fromEntries((res.headers as unknown[]).filter(isObj).map((h) => [String(h.name).toLowerCase(), String(h.value ?? "")])) : {};
    const content = isObj(res.content) ? res.content : {};
    const text = typeof content.text === "string" ? (content.encoding === "base64" ? null : content.text) : null;
    captures.push({ method: String(req.method ?? "GET"), path, status: Number(res.status), responseHeaders: headers, responseBody: text });
  }
  const { endpoints, warnings } = endpointsFromCaptures(captures);
  return { format: "har", title: "Recorded traffic", description: `Imported from a HAR file (${captures.length} requests)`, endpoints, resources: [], warnings };
}

/** Imports any supported document; throws a readable Error for anything else. */
export function importMockDocument(doc: unknown): MockImport {
  const format = detectMockFormat(doc);
  switch (format) {
    case "vhyxvoid":
      return importNative(doc as Json);
    case "openapi": {
      const r = importOpenApi(doc);
      return { format, title: r.title, description: r.description, endpoints: r.endpoints, resources: [], warnings: r.warnings };
    }
    case "postman":
      return importPostman(doc as Json);
    case "mockoon":
      return importMockoon(doc as Json);
    case "har":
      return importHar(doc as Json);
    default:
      throw new Error("Not a supported document: expected OpenAPI 3, Swagger 2, a Postman collection, a Mockoon environment, a HAR file or a VhyxVoid mock export");
  }
}
