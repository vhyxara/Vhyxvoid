// packages/shared/src/apiClient.ts
//
// The API client and test engine (internal-tools/shared/api-platform-plan.md,
// phase 3). Pure code, no I/O: the platform's server-side runner
// (apps/api/src/modules/platform/apiclient) and the agent's `vhyxvoid test`
// command both build requests, check responses and run collections with it,
// so a collection passes or fails the same way in the dashboard and in CI.
//
//   - request model: method, URL, query params, headers, auth (bearer, basic,
//     API key, HMAC, inherited from the collection), body (JSON, GraphQL, form,
//     multipart with files, raw text, a file);
//   - variables: {{name}} from run captures > overrides > environment >
//     collection, plus {{$uuid}} {{$timestamp}} {{$isoTimestamp}}
//     {{$randomInt}}; secrets can be kept as {{name}} (code snippets, history);
//   - assertions with no code: status, header, JSON path, body, time, size,
//     with equals / contains / matches / type / JSON schema and friends;
//   - captures: response values saved as variables for the next request;
//   - code snippets: curl, fetch, axios, Python requests, Go net/http;
//   - runCollection: one request after another with a report (and JUnit XML).

import { createHmac, randomUUID } from "crypto";

// ── Model ────────────────────────────────────────────────────────────────────

export const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type ApiMethod = (typeof API_METHODS)[number];

export interface ApiKeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export type ApiAuth =
  | { type: "none" }
  | { type: "inherit" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; name: string; value: string; in: "header" | "query" }
  | {
      type: "hmac";
      secret: string;
      algorithm: "sha256" | "sha1" | "sha512";
      encoding: "hex" | "base64";
      header: string;
      /** Put in front of the signature, e.g. "sha256=". */
      prefix?: string;
      /** Sign "<unix seconds>.<body>" and send the time in timestampHeader (Stripe style). */
      timestampHeader?: string;
    };

export interface MultipartField {
  key: string;
  value: string;
  enabled: boolean;
  /** Set for a file part: base64 content. */
  file?: { name: string; contentType: string; base64: string };
}

export type ApiBody =
  | { type: "none" }
  | { type: "json"; text: string }
  | { type: "graphql"; query: string; variables: string }
  | { type: "form"; fields: ApiKeyValue[] }
  | { type: "multipart"; fields: MultipartField[] }
  | { type: "raw"; text: string; contentType: string }
  | { type: "file"; name: string; contentType: string; base64: string };

export const ASSERTION_SOURCES = ["status", "header", "json", "body", "time", "size"] as const;
export type AssertionSource = (typeof ASSERTION_SOURCES)[number];
export const ASSERTION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains", "exists", "notExists", "matches", "type", "schema"] as const;
export type AssertionOp = (typeof ASSERTION_OPS)[number];

export interface ApiAssertion {
  id: string;
  enabled: boolean;
  source: AssertionSource;
  /** Header name for "header", JSON path for "json" ($.items[0].id). */
  path?: string;
  op: AssertionOp;
  /** Expected value as text: a number, JSON, a regex, a type name or a JSON schema. */
  value?: string;
}

export interface ApiCapture {
  id: string;
  enabled: boolean;
  variable: string;
  source: "json" | "header" | "status" | "body";
  /** JSON path, header name, or for "body" a regex whose first group is kept. */
  path?: string;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: ApiMethod;
  url: string;
  params: ApiKeyValue[];
  headers: ApiKeyValue[];
  auth: ApiAuth;
  body: ApiBody;
  assertions: ApiAssertion[];
  captures: ApiCapture[];
  folderId?: string | null;
  description?: string;
}

export interface ApiVariable {
  key: string;
  value: string;
  enabled: boolean;
  /** Kept out of snippets, history and API responses. */
  secret?: boolean;
}

export interface ApiFolder {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface ApiCollection {
  name: string;
  description?: string;
  /** Used by requests whose auth is "inherit". */
  auth: ApiAuth;
  variables: ApiVariable[];
  folders: ApiFolder[];
  requests: ApiRequest[];
}

export const API_CLIENT_BOUNDS = {
  urlLength: 8_192,
  nameLength: 120,
  keyValues: 100,
  keyLength: 256,
  valueLength: 16_384,
  bodyBytes: 1_000_000,
  fileBytes: 5_000_000,
  assertions: 50,
  captures: 20,
  variables: 200,
  folders: 100,
  folderDepth: 5,
  environments: 50,
  /** Responses larger than this are cut (the rest is not read). */
  responseBytes: 5_000_000,
  timeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  redirects: 5,
} as const;

let idSeq = 0;
export function apiId(prefix: "q" | "a" | "c" | "f"): string {
  idSeq = (idSeq + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newApiRequest(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: apiId("q"),
    name: "New request",
    method: "GET",
    url: "",
    params: [],
    headers: [],
    auth: { type: "inherit" },
    body: { type: "none" },
    assertions: [],
    captures: [],
    folderId: null,
    ...over,
  };
}

// ── Variables ────────────────────────────────────────────────────────────────

export interface VariableScope {
  /** Later layers win: collection, environment, overrides, captures. */
  values: Map<string, string>;
  secrets: Set<string>;
  /** "mask": secrets stay as {{name}} (snippets, history). */
  mode?: "value" | "mask";
}

export function makeScope(layers: ReadonlyArray<ReadonlyArray<ApiVariable> | Record<string, string> | undefined>, mode: "value" | "mask" = "value"): VariableScope {
  const values = new Map<string, string>();
  const secrets = new Set<string>();
  for (const layer of layers) {
    if (!layer) continue;
    if (Array.isArray(layer)) {
      for (const v of layer as ApiVariable[]) {
        if (!v.enabled || !v.key) continue;
        values.set(v.key, v.value);
        if (v.secret) secrets.add(v.key);
        else secrets.delete(v.key);
      }
    } else {
      for (const [k, v] of Object.entries(layer)) {
        values.set(k, v);
      }
    }
  }
  return { values, secrets, mode };
}

const VAR_RE = /\{\{\s*(\$?[A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;

export interface Interpolated {
  text: string;
  missing: string[];
}

function dynamicVar(name: string): string | undefined {
  switch (name) {
    case "$uuid":
    case "$guid":
      return randomUUID();
    case "$timestamp":
      return String(Math.floor(Date.now() / 1000));
    case "$isoTimestamp":
      return new Date().toISOString();
    case "$randomInt":
      return String(Math.floor(Math.random() * 1001));
    default:
      return undefined;
  }
}

/** {{name}} replaced from the scope; unknown names are left as they are and listed. */
export function interpolate(text: string, scope: VariableScope, missing: Set<string> = new Set()): string {
  if (!text || !text.includes("{{")) return text ?? "";
  return text.replace(VAR_RE, (whole, name: string) => {
    if (name.startsWith("$")) return dynamicVar(name) ?? (missing.add(name), whole);
    if (!scope.values.has(name)) {
      missing.add(name);
      return whole;
    }
    if (scope.mode === "mask" && scope.secrets.has(name)) return `{{${name}}}`;
    return scope.values.get(name)!;
  });
}

/** Variable names a request uses (to tell the user which are undefined). */
export function variablesUsed(req: ApiRequest): string[] {
  const names = new Set<string>();
  const scan = (s: string | undefined) => {
    if (!s) return;
    for (const m of s.matchAll(VAR_RE)) if (!m[1].startsWith("$")) names.add(m[1]);
  };
  scan(req.url);
  for (const kv of [...req.params, ...req.headers]) (scan(kv.key), scan(kv.value));
  const a = req.auth;
  if (a.type === "bearer") scan(a.token);
  if (a.type === "basic") (scan(a.username), scan(a.password));
  if (a.type === "apiKey") (scan(a.name), scan(a.value));
  if (a.type === "hmac") scan(a.secret);
  const b = req.body;
  if (b.type === "json" || b.type === "raw") scan(b.text);
  if (b.type === "graphql") (scan(b.query), scan(b.variables));
  if (b.type === "form" || b.type === "multipart") for (const f of b.fields) (scan(f.key), scan(f.value));
  for (const x of req.assertions) scan(x.value);
  return [...names];
}

// ── Building a request ───────────────────────────────────────────────────────

export interface BuiltRequest {
  method: ApiMethod;
  url: string;
  headers: [string, string][];
  body?: Buffer;
  /** The body as text for display (files and binary shown as a note). */
  bodyPreview?: string;
  missing: string[];
  /** Blocking: the request can't be sent. */
  problems: string[];
  /** Sent anyway (e.g. JSON that doesn't parse). */
  warnings: string[];
}

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DROPPED_HEADERS = new Set(["content-length", "transfer-encoding", "connection", "keep-alive", "upgrade", "te", "trailer", "proxy-connection", "proxy-authorization", "proxy-authenticate"]);

function hasHeader(headers: [string, string][], name: string) {
  const n = name.toLowerCase();
  return headers.some(([k]) => k.toLowerCase() === n);
}

function setHeader(headers: [string, string][], name: string, value: string) {
  const n = name.toLowerCase();
  const i = headers.findIndex(([k]) => k.toLowerCase() === n);
  if (i === -1) headers.push([name, value]);
  else headers[i] = [headers[i][0], value];
}

export function effectiveAuth(req: ApiRequest, collectionAuth?: ApiAuth): ApiAuth {
  if (req.auth.type !== "inherit") return req.auth;
  return collectionAuth && collectionAuth.type !== "inherit" ? collectionAuth : { type: "none" };
}

export interface BuildOptions {
  collectionAuth?: ApiAuth;
  /** Seconds since the epoch for HMAC timestamps (tests). */
  now?: number;
}

export function buildRequest(req: ApiRequest, scope: VariableScope, opts: BuildOptions = {}): BuiltRequest {
  const missing = new Set<string>();
  const problems: string[] = [];
  const warnings: string[] = [];
  const v = (s: string) => interpolate(s ?? "", scope, missing);
  const method = (API_METHODS as readonly string[]).includes(req.method) ? req.method : "GET";

  // URL and query
  const urlMissing = new Set<string>();
  let raw = interpolate(req.url ?? "", scope, urlMissing).trim();
  for (const p of req.params) if (p.enabled && p.key) (interpolate(p.key, scope, urlMissing), interpolate(p.value, scope, urlMissing));
  urlMissing.forEach((n) => missing.add(n));
  const undefinedInUrl = [...urlMissing].filter((n) => !n.startsWith("$"));
  if (undefinedInUrl.length) problems.push(`Define ${undefinedInUrl.map((n) => `{{${n}}}`).join(", ")} (in the collection or the environment) before sending`);
  if (!raw) problems.push("Enter a URL");
  if (raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL | null = null;
  if (raw) {
    try {
      url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        problems.push("Only http:// and https:// URLs can be sent");
        url = null;
      }
    } catch {
      if (!undefinedInUrl.length) problems.push("Not a valid URL");
    }
  }
  if (url && (url.username || url.password)) {
    problems.push("Put credentials in the Auth tab (Basic), not in the URL");
  }
  for (const p of req.params) if (p.enabled && p.key && url) url.searchParams.append(v(p.key), v(p.value));

  // Headers
  const headers: [string, string][] = [];
  for (const h of req.headers) {
    if (!h.enabled || !h.key.trim()) continue;
    const name = v(h.key).trim();
    if (!HEADER_NAME_RE.test(name)) {
      problems.push(`"${name}" is not a valid header name`);
      continue;
    }
    if (DROPPED_HEADERS.has(name.toLowerCase())) {
      warnings.push(`${name} is set by the client and was left out`);
      continue;
    }
    const value = v(h.value);
    if (/[\r\n]/.test(value)) {
      problems.push(`The ${name} header value contains a line break`);
      continue;
    }
    headers.push([name, value]);
  }

  // Body
  let body: Buffer | undefined;
  let bodyPreview: string | undefined;
  let contentType: string | undefined;
  const b = req.body;
  switch (b.type) {
    case "json": {
      const text = v(b.text);
      try {
        if (text.trim()) JSON.parse(text);
      } catch (e) {
        warnings.push(`The JSON body doesn't parse: ${(e as Error).message}`);
      }
      body = Buffer.from(text, "utf8");
      bodyPreview = text;
      contentType = "application/json";
      break;
    }
    case "graphql": {
      let variables: unknown = undefined;
      const vt = v(b.variables).trim();
      if (vt) {
        try {
          variables = JSON.parse(vt);
        } catch (e) {
          problems.push(`GraphQL variables are not JSON: ${(e as Error).message}`);
        }
      }
      const text = JSON.stringify(variables === undefined ? { query: v(b.query) } : { query: v(b.query), variables });
      body = Buffer.from(text, "utf8");
      bodyPreview = text;
      contentType = "application/json";
      break;
    }
    case "form": {
      const form = new URLSearchParams();
      for (const f of b.fields) if (f.enabled && f.key) form.append(v(f.key), v(f.value));
      bodyPreview = form.toString();
      body = Buffer.from(bodyPreview, "utf8");
      contentType = "application/x-www-form-urlencoded";
      break;
    }
    case "multipart": {
      const boundary = `----VhyxVoidBoundary${Math.random().toString(36).slice(2, 14)}`;
      const parts: Buffer[] = [];
      const preview: string[] = [];
      for (const f of b.fields) {
        if (!f.enabled || !f.key) continue;
        const key = v(f.key).replace(/"/g, "%22").replace(/[\r\n]/g, "");
        if (f.file) {
          const fname = f.file.name.replace(/"/g, "%22").replace(/[\r\n]/g, "");
          const data = Buffer.from(f.file.base64, "base64");
          parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${fname}"\r\nContent-Type: ${f.file.contentType || "application/octet-stream"}\r\n\r\n`, "utf8"), data, Buffer.from("\r\n"));
          preview.push(`${key}: <file ${fname}, ${data.length} bytes>`);
        } else {
          const value = v(f.value);
          parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`, "utf8"));
          preview.push(`${key}: ${value}`);
        }
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      body = Buffer.concat(parts);
      bodyPreview = preview.join("\n");
      contentType = `multipart/form-data; boundary=${boundary}`;
      break;
    }
    case "raw": {
      const text = v(b.text);
      body = Buffer.from(text, "utf8");
      bodyPreview = text;
      contentType = b.contentType || "text/plain";
      break;
    }
    case "file": {
      body = Buffer.from(b.base64 ?? "", "base64");
      bodyPreview = `<file ${b.name}, ${body.length} bytes>`;
      contentType = b.contentType || "application/octet-stream";
      if (body.length > API_CLIENT_BOUNDS.fileBytes) problems.push(`The file is larger than ${API_CLIENT_BOUNDS.fileBytes / 1_000_000} MB`);
      break;
    }
  }
  if (body && b.type !== "file" && b.type !== "multipart" && body.length > API_CLIENT_BOUNDS.bodyBytes) problems.push(`The body is larger than ${API_CLIENT_BOUNDS.bodyBytes / 1_000_000} MB`);
  if (body && b.type === "multipart" && body.length > API_CLIENT_BOUNDS.fileBytes) problems.push(`The form is larger than ${API_CLIENT_BOUNDS.fileBytes / 1_000_000} MB`);
  if (body && (method === "GET" || method === "HEAD") && body.length) warnings.push(`${method} requests usually have no body; many servers ignore it`);
  if (contentType && body && !hasHeader(headers, "content-type")) headers.push(["Content-Type", contentType]);

  // Auth (after the body: HMAC signs it)
  const auth = effectiveAuth(req, opts.collectionAuth);
  switch (auth.type) {
    case "bearer":
      if (v(auth.token)) setHeader(headers, "Authorization", `Bearer ${v(auth.token)}`);
      break;
    case "basic":
      setHeader(headers, "Authorization", `Basic ${Buffer.from(`${v(auth.username)}:${v(auth.password)}`, "utf8").toString("base64")}`);
      break;
    case "apiKey": {
      const name = v(auth.name).trim();
      if (!name) break;
      if (auth.in === "query") url?.searchParams.set(name, v(auth.value));
      else if (HEADER_NAME_RE.test(name)) setHeader(headers, name, v(auth.value));
      else problems.push(`"${name}" is not a valid header name`);
      break;
    }
    case "hmac": {
      const header = (auth.header || "X-Signature").trim();
      if (!HEADER_NAME_RE.test(header)) {
        problems.push(`"${header}" is not a valid header name`);
        break;
      }
      const secret = v(auth.secret);
      if (scope.mode === "mask" && /\{\{/.test(secret)) {
        setHeader(headers, header, `${auth.prefix ?? ""}<signature>`);
        break;
      }
      const payload = body ?? Buffer.alloc(0);
      let message: Buffer = payload;
      if (auth.timestampHeader) {
        const ts = String(opts.now ?? Math.floor(Date.now() / 1000));
        message = Buffer.concat([Buffer.from(`${ts}.`), payload]);
        setHeader(headers, auth.timestampHeader, ts);
      }
      const sig = createHmac(auth.algorithm || "sha256", secret).update(message).digest(auth.encoding || "hex");
      setHeader(headers, header, `${auth.prefix ?? ""}${sig}`);
      break;
    }
  }

  if (url && url.toString().length > API_CLIENT_BOUNDS.urlLength) problems.push("The URL is too long");
  const elsewhere = [...missing].filter((n) => !urlMissing.has(n) && !n.startsWith("$"));
  if (elsewhere.length) warnings.push(`Not defined, sent as written: ${elsewhere.map((n) => `{{${n}}}`).join(", ")}`);
  return { method: method as ApiMethod, url: url ? url.toString() : raw, headers, body: body && (body.length || (method !== "GET" && method !== "HEAD")) ? body : undefined, bodyPreview, missing: [...missing], problems, warnings };
}

// ── Responses ────────────────────────────────────────────────────────────────

export interface ApiTimings {
  /** Milliseconds; 0 when the step didn't happen (reused connection, plain HTTP). */
  dns: number;
  connect: number;
  tls: number;
  /** From sending the request to the first byte of the response. */
  firstByte: number;
  download: number;
  total: number;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  /** utf8 text, or base64 when bodyEncoding is "base64". */
  body: string;
  bodyEncoding: "utf8" | "base64";
  /** Bytes received (after decompression). */
  size: number;
  truncated: boolean;
  timings: ApiTimings;
  httpVersion?: string;
  remoteAddress?: string;
  /** URLs followed before the final answer. */
  redirects?: string[];
}

export function responseHeader(res: Pick<ApiResponse, "headers">, name: string): string | undefined {
  const n = name.toLowerCase();
  const found = res.headers.filter(([k]) => k.toLowerCase() === n).map(([, val]) => val);
  return found.length ? found.join(", ") : undefined;
}

function responseText(res: ApiResponse): string {
  return res.bodyEncoding === "base64" ? Buffer.from(res.body, "base64").toString("utf8") : res.body;
}

const jsonCache = new WeakMap<ApiResponse, { ok: boolean; value: unknown }>();
export function responseJson(res: ApiResponse): { ok: boolean; value: unknown } {
  let c = jsonCache.get(res);
  if (!c) {
    try {
      c = { ok: true, value: JSON.parse(responseText(res)) };
    } catch {
      c = { ok: false, value: undefined };
    }
    jsonCache.set(res, c);
  }
  return c;
}

// ── JSON path ────────────────────────────────────────────────────────────────

type PathStep = { key: string } | { index: number } | { all: true } | { length: true };

/** $.a.b[0]["x y"][*].id, a.b.0, items.length; null when the path is malformed. */
export function parseJsonPath(path: string): PathStep[] | null {
  let s = path.trim();
  if (s.startsWith("$")) s = s.slice(1);
  const steps: PathStep[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ".") {
      i++;
      continue;
    }
    if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end === -1) return null;
      const inner = s.slice(i + 1, end).trim();
      i = end + 1;
      if (inner === "*") steps.push({ all: true });
      else if (/^-?\d+$/.test(inner)) steps.push({ index: Number(inner) });
      else if (/^(["']).*\1$/.test(inner)) steps.push({ key: inner.slice(1, -1) });
      else return null;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
    const key = s.slice(i, j);
    i = j;
    if (key === "*") steps.push({ all: true });
    else if (key === "length") steps.push({ length: true });
    else if (/^\d+$/.test(key)) steps.push({ index: Number(key) });
    else steps.push({ key });
  }
  return steps;
}

export function selectJsonPath(value: unknown, path: string): { found: boolean; value: unknown } {
  const steps = parseJsonPath(path);
  if (!steps) return { found: false, value: undefined };
  const walk = (cur: unknown, k: number): { found: boolean; value: unknown } => {
    if (k === steps.length) return { found: cur !== undefined, value: cur };
    const step = steps[k];
    if ("all" in step) {
      if (Array.isArray(cur)) return { found: true, value: cur.map((x) => walk(x, k + 1)).filter((r) => r.found).map((r) => r.value) };
      if (cur && typeof cur === "object") return { found: true, value: Object.values(cur).map((x) => walk(x, k + 1)).filter((r) => r.found).map((r) => r.value) };
      return { found: false, value: undefined };
    }
    if ("length" in step) {
      if (Array.isArray(cur) || typeof cur === "string") return walk(cur.length, k + 1);
      if (cur && typeof cur === "object" && "length" in cur) return walk((cur as Record<string, unknown>).length, k + 1);
      if (cur && typeof cur === "object") return walk(Object.keys(cur).length, k + 1);
      return { found: false, value: undefined };
    }
    if ("index" in step) {
      if (!Array.isArray(cur)) {
        if (cur && typeof cur === "object" && String(step.index) in cur) return walk((cur as Record<string, unknown>)[String(step.index)], k + 1);
        return { found: false, value: undefined };
      }
      const idx = step.index < 0 ? cur.length + step.index : step.index;
      return idx >= 0 && idx < cur.length ? walk(cur[idx], k + 1) : { found: false, value: undefined };
    }
    if (cur && typeof cur === "object" && !Array.isArray(cur) && Object.prototype.hasOwnProperty.call(cur, step.key)) return walk((cur as Record<string, unknown>)[step.key], k + 1);
    return { found: false, value: undefined };
  };
  return walk(value, 0);
}

// ── JSON schema (the parts people use in API tests) ──────────────────────────

type Schema = Record<string, unknown>;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeMatches(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return t === actual || (t === "number" && actual === "integer");
}

/**
 * type, enum, const, properties, required, additionalProperties, items,
 * minItems/maxItems, uniqueItems, minLength/maxLength, pattern, format (email,
 * uuid, date-time, date, uri), minimum/maximum, exclusiveMinimum/Maximum,
 * multipleOf, allOf/anyOf/oneOf/not, nullable, local $ref (#/definitions,
 * #/$defs). Returns the first errors with their JSON path.
 */
export function validateJsonSchema(value: unknown, schema: unknown, max = 10): string[] {
  const errors: string[] = [];
  const root = schema;
  const resolve = (s: unknown, depth: number): Schema | null => {
    if (!s || typeof s !== "object") return null;
    const ref = (s as Schema).$ref;
    if (typeof ref === "string" && ref.startsWith("#/") && depth < 20) {
      const target = ref
        .slice(2)
        .split("/")
        .reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Schema)[k.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), root);
      return resolve(target, depth + 1);
    }
    return s as Schema;
  };
  const FORMATS: Record<string, RegExp> = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "date-time": /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i,
    date: /^\d{4}-\d{2}-\d{2}$/,
    uri: /^[a-z][a-z0-9+.-]*:\S+$/i,
  };
  const check = (v: unknown, sIn: unknown, at: string, depth: number, out: string[]) => {
    if (out.length >= max || depth > 40) return;
    if (sIn === true || sIn === undefined) return;
    if (sIn === false) return void out.push(`${at}: not allowed`);
    const s = resolve(sIn, 0);
    if (!s) return;
    if (s.nullable === true && v === null) return;
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
      if (!types.some((t) => typeMatches(v, t))) return void out.push(`${at}: expected ${types.join(" or ")}, got ${typeOf(v)}`);
    }
    if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) out.push(`${at}: must be one of ${JSON.stringify(s.enum).slice(0, 120)}`);
    if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(v)) out.push(`${at}: must be ${JSON.stringify(s.const)}`);
    if (typeof v === "number") {
      if (typeof s.minimum === "number" && v < s.minimum) out.push(`${at}: ${v} is below the minimum ${s.minimum}`);
      if (typeof s.maximum === "number" && v > s.maximum) out.push(`${at}: ${v} is above the maximum ${s.maximum}`);
      if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) out.push(`${at}: must be above ${s.exclusiveMinimum}`);
      if (typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum) out.push(`${at}: must be below ${s.exclusiveMaximum}`);
      if (typeof s.multipleOf === "number" && s.multipleOf > 0 && Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-9) out.push(`${at}: must be a multiple of ${s.multipleOf}`);
    }
    if (typeof v === "string") {
      if (typeof s.minLength === "number" && [...v].length < s.minLength) out.push(`${at}: shorter than ${s.minLength}`);
      if (typeof s.maxLength === "number" && [...v].length > s.maxLength) out.push(`${at}: longer than ${s.maxLength}`);
      if (typeof s.pattern === "string") {
        const re = safeRegex(s.pattern);
        if (re && !re.test(v)) out.push(`${at}: doesn't match ${s.pattern}`);
      }
      if (typeof s.format === "string" && FORMATS[s.format] && !FORMATS[s.format].test(v)) out.push(`${at}: not a valid ${s.format}`);
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === "number" && v.length < s.minItems) out.push(`${at}: fewer than ${s.minItems} items`);
      if (typeof s.maxItems === "number" && v.length > s.maxItems) out.push(`${at}: more than ${s.maxItems} items`);
      if (s.uniqueItems === true && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) out.push(`${at}: items are not unique`);
      if (s.items !== undefined && !Array.isArray(s.items)) v.forEach((item, i) => check(item, s.items, `${at}[${i}]`, depth + 1, out));
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      const props = (s.properties as Schema | undefined) ?? {};
      if (Array.isArray(s.required)) for (const r of s.required as string[]) if (!(r in obj)) out.push(`${at}: missing required property "${r}"`);
      for (const [k, sub] of Object.entries(props)) if (k in obj) check(obj[k], sub, `${at}.${k}`, depth + 1, out);
      if (s.additionalProperties !== undefined && s.additionalProperties !== true) {
        for (const k of Object.keys(obj)) {
          if (k in props) continue;
          if (s.additionalProperties === false) out.push(`${at}: unexpected property "${k}"`);
          else check(obj[k], s.additionalProperties, `${at}.${k}`, depth + 1, out);
        }
      }
    }
    if (Array.isArray(s.allOf)) for (const sub of s.allOf) check(v, sub, at, depth + 1, out);
    if (Array.isArray(s.anyOf) && !s.anyOf.some((sub) => passes(v, sub, at, depth + 1))) out.push(`${at}: matches none of anyOf`);
    if (Array.isArray(s.oneOf)) {
      const n = s.oneOf.filter((sub) => passes(v, sub, at, depth + 1)).length;
      if (n !== 1) out.push(`${at}: matches ${n} of oneOf (exactly 1 expected)`);
    }
    if (s.not !== undefined && passes(v, s.not, at, depth + 1)) out.push(`${at}: must not match "not"`);
  };
  const passes = (v: unknown, sub: unknown, at: string, depth: number) => {
    const tmp: string[] = [];
    check(v, sub, at, depth, tmp);
    return tmp.length === 0;
  };
  check(value, schema, "$", 0, errors);
  return errors;
}

function safeRegex(src: string): RegExp | null {
  if (src.length > 500) return null;
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}

// ── Assertions ───────────────────────────────────────────────────────────────

export interface AssertionResult {
  id: string;
  pass: boolean;
  /** "status equals 200" */
  label: string;
  /** Why it failed, or what was seen. */
  message: string;
  actual?: string;
}

function show(v: unknown): string {
  if (v === undefined) return "nothing";
  if (typeof v === "string") return JSON.stringify(v.length > 200 ? `${v.slice(0, 200)}…` : v);
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/** Expected text as a value: JSON when it parses (numbers, true, null, objects), else the string. */
function parseExpected(text: string): unknown {
  const t = text.trim();
  if (t === "") return "";
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

function looselyEqual(actual: unknown, expectedText: string): boolean {
  const expected = parseExpected(expectedText);
  if (typeof actual === "string") return actual === expectedText || (typeof expected !== "string" && actual === JSON.stringify(expected)) || actual === expected;
  if (typeof actual === "number" && typeof expected === "string" && expected.trim() !== "" && !isNaN(Number(expected))) return actual === Number(expected);
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  if (Array.isArray(v)) return null;
  return null;
}

const OP_LABEL: Record<AssertionOp, string> = {
  eq: "equals",
  neq: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  notContains: "doesn't contain",
  exists: "exists",
  notExists: "doesn't exist",
  matches: "matches",
  type: "is of type",
  schema: "matches schema",
};

export function assertionLabel(a: ApiAssertion): string {
  const subject = a.source === "status" ? "status" : a.source === "time" ? "response time (ms)" : a.source === "size" ? "size (bytes)" : a.source === "body" ? "body" : a.source === "header" ? `header ${a.path ?? ""}` : `${a.path || "$"}`;
  const needsValue = !["exists", "notExists"].includes(a.op);
  const value = a.op === "schema" ? "" : needsValue ? ` ${(a.value ?? "").length > 60 ? `${a.value!.slice(0, 60)}…` : a.value ?? ""}` : "";
  return `${subject} ${OP_LABEL[a.op]}${value}`.trim();
}

function assertionSubject(a: ApiAssertion, res: ApiResponse): { found: boolean; value: unknown; problem?: string } {
  switch (a.source) {
    case "status":
      return { found: true, value: res.status };
    case "time":
      return { found: true, value: Math.round(res.timings.total) };
    case "size":
      return { found: true, value: res.size };
    case "body":
      return { found: true, value: responseText(res) };
    case "header": {
      const h = responseHeader(res, a.path ?? "");
      return { found: h !== undefined, value: h };
    }
    case "json": {
      const parsed = responseJson(res);
      if (!parsed.ok) return { found: false, value: undefined, problem: "the body is not JSON" };
      if (!parseJsonPath(a.path || "$")) return { found: false, value: undefined, problem: `"${a.path}" is not a valid JSON path` };
      return selectJsonPath(parsed.value, a.path || "$");
    }
  }
}

export function evaluateAssertion(a: ApiAssertion, res: ApiResponse, scope?: VariableScope): AssertionResult {
  const expectedText = scope ? interpolate(a.value ?? "", scope) : a.value ?? "";
  const label = assertionLabel({ ...a, value: a.op === "schema" ? a.value : expectedText });
  const subj = assertionSubject(a, res);
  const actual = show(subj.value);
  const done = (pass: boolean, why: string): AssertionResult => ({ id: a.id, pass, label, message: pass ? `got ${actual}` : why, actual });
  if (subj.problem) return done(false, subj.problem);
  const v = subj.value;
  switch (a.op) {
    case "exists":
      return done(subj.found, "it isn't there");
    case "notExists":
      return done(!subj.found, `it's there: ${actual}`);
  }
  if (!subj.found) return done(false, a.source === "header" ? `no ${a.path} header` : `nothing at ${a.path || "$"}`);
  switch (a.op) {
    case "eq":
      return done(looselyEqual(v, expectedText), `expected ${show(parseExpected(expectedText))}, got ${actual}`);
    case "neq":
      return done(!looselyEqual(v, expectedText), `got ${actual}`);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const n = toNumber(v);
      const e = toNumber(expectedText);
      if (n === null) return done(false, `${actual} is not a number`);
      if (e === null) return done(false, `"${expectedText}" is not a number`);
      const ok = a.op === "gt" ? n > e : a.op === "gte" ? n >= e : a.op === "lt" ? n < e : n <= e;
      return done(ok, `got ${n}`);
    }
    case "contains":
    case "notContains": {
      let has: boolean;
      if (typeof v === "string") has = v.includes(expectedText);
      else if (Array.isArray(v)) {
        const e = parseExpected(expectedText);
        has = v.some((x) => JSON.stringify(x) === JSON.stringify(e) || x === expectedText);
      } else if (v && typeof v === "object") has = expectedText in (v as object);
      else has = String(v).includes(expectedText);
      return done(a.op === "contains" ? has : !has, a.op === "contains" ? `${actual} doesn't contain ${JSON.stringify(expectedText)}` : `${actual} contains ${JSON.stringify(expectedText)}`);
    }
    case "matches": {
      const re = safeRegex(expectedText);
      if (!re) return done(false, `"${expectedText}" is not a valid regular expression`);
      return done(re.test(typeof v === "string" ? v : JSON.stringify(v)), `${actual} doesn't match /${expectedText}/`);
    }
    case "type": {
      const want = expectedText.trim().toLowerCase();
      return done(typeMatches(v, want), `it's ${typeOf(v)}`);
    }
    case "schema": {
      let schema: unknown;
      try {
        schema = JSON.parse(a.value ?? "");
      } catch {
        return done(false, "the schema is not valid JSON");
      }
      let target = v;
      if (a.source !== "json" && typeof v === "string") {
        try {
          target = JSON.parse(v);
        } catch {
          return done(false, "the body is not JSON");
        }
      }
      const errs = validateJsonSchema(target, schema, 5);
      return { id: a.id, pass: errs.length === 0, label, message: errs.length ? errs.join("; ") : "valid", actual: errs.length ? undefined : "valid" };
    }
  }
  return done(false, "unknown check");
}

export function evaluateAssertions(list: readonly ApiAssertion[], res: ApiResponse, scope?: VariableScope): AssertionResult[] {
  return list.filter((a) => a.enabled).map((a) => evaluateAssertion(a, res, scope));
}

// ── Captures ─────────────────────────────────────────────────────────────────

export interface CaptureResult {
  variable: string;
  ok: boolean;
  value?: string;
  message?: string;
}

export function applyCaptures(list: readonly ApiCapture[], res: ApiResponse): CaptureResult[] {
  const out: CaptureResult[] = [];
  for (const c of list) {
    if (!c.enabled || !c.variable) continue;
    let value: unknown;
    let found = true;
    if (c.source === "status") value = res.status;
    else if (c.source === "header") {
      value = responseHeader(res, c.path ?? "");
      found = value !== undefined;
    } else if (c.source === "body") {
      const text = responseText(res);
      if (c.path) {
        const re = safeRegex(c.path);
        const m = re ? re.exec(text) : null;
        found = !!m;
        value = m ? (m[1] ?? m[0]) : undefined;
      } else value = text;
    } else {
      const parsed = responseJson(res);
      if (!parsed.ok) {
        out.push({ variable: c.variable, ok: false, message: "the body is not JSON" });
        continue;
      }
      const r = selectJsonPath(parsed.value, c.path || "$");
      found = r.found;
      value = r.value;
    }
    if (!found) out.push({ variable: c.variable, ok: false, message: `nothing at ${c.path || c.source}` });
    else out.push({ variable: c.variable, ok: true, value: typeof value === "string" ? value : JSON.stringify(value) });
  }
  return out;
}

// ── Code snippets ────────────────────────────────────────────────────────────

export const SNIPPET_LANGUAGES = [
  { id: "curl", label: "curl" },
  { id: "fetch", label: "JavaScript (fetch)" },
  { id: "axios", label: "Node.js (axios)" },
  { id: "python", label: "Python (requests)" },
  { id: "go", label: "Go (net/http)" },
] as const;
export type SnippetLanguage = (typeof SNIPPET_LANGUAGES)[number]["id"];

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const jsq = (s: string) => JSON.stringify(s);
const pyq = (s: string) => JSON.stringify(s);
const goq = (s: string) => (s.includes("`") || /[\r]/.test(s) ? JSON.stringify(s) : `\`${s}\``);

function isTextual(b: ApiBody) {
  return b.type === "json" || b.type === "graphql" || b.type === "form" || b.type === "raw";
}

/**
 * A snippet for a built request (build it with a "mask" scope so secrets stay
 * {{name}}). Multipart and file bodies are written in each language's own way.
 */
export function codeSnippet(built: BuiltRequest, lang: SnippetLanguage, source?: ApiRequest): string {
  const { method, url } = built;
  const body = source?.body;
  const multipart = body?.type === "multipart" ? body : undefined;
  const file = body?.type === "file" ? body : undefined;
  const headers = built.headers.filter(([k]) => !(multipart && k.toLowerCase() === "content-type"));
  const text = built.body && body && isTextual(body) ? built.body.toString("utf8") : undefined;
  const isJson = body?.type === "json" || body?.type === "graphql";
  switch (lang) {
    case "curl": {
      const lines = [`curl -X ${method} ${shq(url)}`];
      for (const [k, val] of headers) lines.push(`  -H ${shq(`${k}: ${val}`)}`);
      if (text !== undefined) lines.push(`  --data-raw ${shq(text)}`);
      if (multipart) for (const f of multipart.fields) if (f.enabled && f.key) lines.push(`  -F ${shq(f.file ? `${f.key}=@${f.file.name}` : `${f.key}=${f.value}`)}`);
      if (file) lines.push(`  --data-binary ${shq(`@${file.name}`)}`);
      return lines.join(" \\\n");
    }
    case "fetch": {
      const lines: string[] = [];
      if (multipart) {
        lines.push("const form = new FormData();");
        for (const f of multipart.fields) if (f.enabled && f.key) lines.push(f.file ? `form.append(${jsq(f.key)}, fileInput.files[0], ${jsq(f.file.name)}); // ${f.file.name}` : `form.append(${jsq(f.key)}, ${jsq(f.value)});`);
        lines.push("");
      }
      const opts: string[] = [`  method: ${jsq(method)},`];
      if (headers.length) opts.push(`  headers: {\n${headers.map(([k, val]) => `    ${jsq(k)}: ${jsq(val)},`).join("\n")}\n  },`);
      if (text !== undefined) opts.push(isJson && safeJson(text) !== undefined ? `  body: JSON.stringify(${indent(JSON.stringify(safeJson(text), null, 2), "  ")}),` : `  body: ${jsq(text)},`);
      if (multipart) opts.push("  body: form,");
      if (file) opts.push(`  body: fileBlob, // ${file.name}`);
      lines.push(`const res = await fetch(${jsq(url)}, {\n${opts.join("\n")}\n});`);
      lines.push("const data = await res.text();");
      lines.push("console.log(res.status, data);");
      return lines.join("\n");
    }
    case "axios": {
      const lines = ['import axios from "axios";'];
      if (multipart || file) lines.push('import fs from "node:fs";');
      if (multipart) {
        lines.push("", "const form = new FormData();");
        for (const f of multipart.fields) if (f.enabled && f.key) lines.push(f.file ? `form.append(${jsq(f.key)}, new Blob([fs.readFileSync(${jsq(f.file.name)})]), ${jsq(f.file.name)});` : `form.append(${jsq(f.key)}, ${jsq(f.value)});`);
      }
      const opts: string[] = [`  method: ${jsq(method.toLowerCase())},`, `  url: ${jsq(url)},`];
      if (headers.length) opts.push(`  headers: {\n${headers.map(([k, val]) => `    ${jsq(k)}: ${jsq(val)},`).join("\n")}\n  },`);
      if (text !== undefined) opts.push(isJson && safeJson(text) !== undefined ? `  data: ${indent(JSON.stringify(safeJson(text), null, 2), "  ")},` : `  data: ${jsq(text)},`);
      if (multipart) opts.push("  data: form,");
      if (file) opts.push(`  data: fs.readFileSync(${jsq(file.name)}),`);
      opts.push("  validateStatus: () => true,");
      lines.push("", `const res = await axios({\n${opts.join("\n")}\n});`, "console.log(res.status, res.data);");
      return lines.join("\n");
    }
    case "python": {
      const lines = ["import requests", ""];
      if (headers.length) lines.push(`headers = {\n${headers.map(([k, val]) => `    ${pyq(k)}: ${pyq(val)},`).join("\n")}\n}`);
      const args = [pyq(method), pyq(url)];
      if (headers.length) args.push("headers=headers");
      if (text !== undefined) {
        lines.push(`data = ${pyq(text)}`);
        args.push("data=data.encode()");
      }
      if (multipart) {
        const fields = multipart.fields.filter((f) => f.enabled && f.key);
        const plain = fields.filter((f) => !f.file);
        const files = fields.filter((f) => f.file);
        if (plain.length) (lines.push(`form = {\n${plain.map((f) => `    ${pyq(f.key)}: ${pyq(f.value)},`).join("\n")}\n}`), args.push("data=form"));
        if (files.length) (lines.push(`files = {\n${files.map((f) => `    ${pyq(f.key)}: open(${pyq(f.file!.name)}, "rb"),`).join("\n")}\n}`), args.push("files=files"));
      }
      if (file) args.push(`data=open(${pyq(file.name)}, "rb")`);
      lines.push("", `res = requests.request(${args.join(", ")})`, "print(res.status_code, res.text)");
      return lines.join("\n");
    }
    case "go": {
      const lines = ["package main", "", "import (", '\t"fmt"', '\t"io"', '\t"net/http"'];
      if (text !== undefined) lines.push('\t"strings"');
      if (multipart || file) lines.push('\t"bytes"', '\t"os"');
      if (multipart) lines.push('\t"mime/multipart"');
      lines.push(")", "", "func main() {");
      let bodyVar = "nil";
      if (text !== undefined) {
        lines.push(`\tbody := strings.NewReader(${goq(text)})`);
        bodyVar = "body";
      }
      if (file) {
        lines.push(`\tdata, _ := os.ReadFile(${goq(file.name)})`, "\tbody := bytes.NewReader(data)");
        bodyVar = "body";
      }
      if (multipart) {
        lines.push("\tvar buf bytes.Buffer", "\tw := multipart.NewWriter(&buf)");
        for (const f of multipart.fields) {
          if (!f.enabled || !f.key) continue;
          if (f.file) lines.push(`\tpart, _ := w.CreateFormFile(${goq(f.key)}, ${goq(f.file.name)})`, `\tdata, _ := os.ReadFile(${goq(f.file.name)})`, "\tpart.Write(data)");
          else lines.push(`\tw.WriteField(${goq(f.key)}, ${goq(f.value)})`);
        }
        lines.push("\tw.Close()");
        bodyVar = "&buf";
      }
      lines.push(`\treq, err := http.NewRequest(${goq(method)}, ${goq(url)}, ${bodyVar})`, "\tif err != nil {", "\t\tpanic(err)", "\t}");
      for (const [k, val] of headers) lines.push(`\treq.Header.Set(${goq(k)}, ${goq(val)})`);
      if (multipart) lines.push('\treq.Header.Set("Content-Type", w.FormDataContentType())');
      lines.push("\tres, err := http.DefaultClient.Do(req)", "\tif err != nil {", "\t\tpanic(err)", "\t}", "\tdefer res.Body.Close()", "\tout, _ := io.ReadAll(res.Body)", "\tfmt.Println(res.StatusCode, string(out))", "}");
      return lines.join("\n");
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function indent(s: string, pad: string) {
  return s.split("\n").join(`\n${pad}`);
}

// ── Validation ───────────────────────────────────────────────────────────────

const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function kvProblem(list: unknown, what: string): string | null {
  if (!Array.isArray(list)) return `${what} must be a list`;
  if (list.length > API_CLIENT_BOUNDS.keyValues) return `At most ${API_CLIENT_BOUNDS.keyValues} ${what}`;
  for (const kv of list) {
    if (!kv || typeof kv !== "object") return `${what}: each entry needs a key and a value`;
    const { key, value } = kv as ApiKeyValue;
    if (typeof key !== "string" || typeof value !== "string") return `${what}: each entry needs a key and a value`;
    if (key.length > API_CLIENT_BOUNDS.keyLength || value.length > API_CLIENT_BOUNDS.valueLength) return `${what}: "${key.slice(0, 40)}" is too long`;
  }
  return null;
}

function authProblem(a: unknown): string | null {
  if (!a || typeof a !== "object") return "auth is missing";
  const auth = a as ApiAuth;
  switch (auth.type) {
    case "none":
    case "inherit":
      return null;
    case "bearer":
      return typeof auth.token === "string" && auth.token.length <= API_CLIENT_BOUNDS.valueLength ? null : "Bearer auth needs a token";
    case "basic":
      return typeof auth.username === "string" && typeof auth.password === "string" ? null : "Basic auth needs a username and a password";
    case "apiKey":
      return typeof auth.name === "string" && typeof auth.value === "string" && (auth.in === "header" || auth.in === "query") ? null : "API key auth needs a name, a value and where to send it";
    case "hmac":
      if (typeof auth.secret !== "string" || typeof auth.header !== "string") return "HMAC auth needs a secret and a header";
      if (!["sha256", "sha1", "sha512"].includes(auth.algorithm)) return "HMAC algorithm must be sha256, sha1 or sha512";
      if (!["hex", "base64"].includes(auth.encoding)) return "HMAC encoding must be hex or base64";
      return null;
    default:
      return `Unknown auth type "${(auth as { type: string }).type}"`;
  }
}

function bodyProblem(b: unknown): string | null {
  if (!b || typeof b !== "object") return "body is missing";
  const body = b as ApiBody;
  switch (body.type) {
    case "none":
      return null;
    case "json":
    case "raw":
      return typeof body.text === "string" && body.text.length <= API_CLIENT_BOUNDS.bodyBytes ? null : "The body is too large";
    case "graphql":
      return typeof body.query === "string" && typeof body.variables === "string" && body.query.length + body.variables.length <= API_CLIENT_BOUNDS.bodyBytes ? null : "The GraphQL body is too large";
    case "form":
      return kvProblem(body.fields, "form fields");
    case "multipart": {
      const p = kvProblem(body.fields, "form fields");
      if (p) return p;
      const bytes = body.fields.reduce((n, f) => n + (f.file?.base64.length ?? 0), 0);
      return bytes * 0.75 > API_CLIENT_BOUNDS.fileBytes ? `Files may add up to ${API_CLIENT_BOUNDS.fileBytes / 1_000_000} MB` : null;
    }
    case "file":
      return typeof body.base64 === "string" && body.base64.length * 0.75 <= API_CLIENT_BOUNDS.fileBytes ? null : `The file is larger than ${API_CLIENT_BOUNDS.fileBytes / 1_000_000} MB`;
    default:
      return `Unknown body type "${(body as { type: string }).type}"`;
  }
}

export function apiRequestProblem(r: unknown): string | null {
  if (!r || typeof r !== "object") return "A request must be an object";
  const req = r as ApiRequest;
  const name = typeof req.name === "string" ? req.name : "";
  const where = name ? `"${name.slice(0, 40)}"` : "A request";
  if (typeof req.id !== "string" || !req.id || req.id.length > 64) return `${where}: missing id`;
  if (!name.trim() || name.length > API_CLIENT_BOUNDS.nameLength) return `${where}: give it a name (up to ${API_CLIENT_BOUNDS.nameLength} characters)`;
  if (!(API_METHODS as readonly string[]).includes(req.method)) return `${where}: unknown method "${req.method}"`;
  if (typeof req.url !== "string" || req.url.length > API_CLIENT_BOUNDS.urlLength) return `${where}: the URL is too long`;
  const p = kvProblem(req.params, "query params") ?? kvProblem(req.headers, "headers") ?? authProblem(req.auth) ?? bodyProblem(req.body);
  if (p) return `${where}: ${p}`;
  if (!Array.isArray(req.assertions) || req.assertions.length > API_CLIENT_BOUNDS.assertions) return `${where}: at most ${API_CLIENT_BOUNDS.assertions} checks`;
  for (const a of req.assertions) {
    if (!a || !(ASSERTION_SOURCES as readonly string[]).includes(a.source) || !(ASSERTION_OPS as readonly string[]).includes(a.op)) return `${where}: a check has an unknown source or operator`;
    if (a.value !== undefined && (typeof a.value !== "string" || a.value.length > API_CLIENT_BOUNDS.valueLength)) return `${where}: a check's value is too long`;
    if (a.source === "json" && a.path && !parseJsonPath(a.path)) return `${where}: "${a.path}" is not a valid JSON path`;
    if (a.op === "schema") {
      try {
        JSON.parse(a.value ?? "");
      } catch {
        return `${where}: the JSON schema of a check is not valid JSON`;
      }
    }
  }
  if (!Array.isArray(req.captures) || req.captures.length > API_CLIENT_BOUNDS.captures) return `${where}: at most ${API_CLIENT_BOUNDS.captures} captures`;
  for (const c of req.captures) {
    if (!c || !["json", "header", "status", "body"].includes(c.source)) return `${where}: a capture has an unknown source`;
    if (c.enabled && !VAR_NAME_RE.test(c.variable ?? "")) return `${where}: "${c.variable}" is not a variable name (letters, digits, _ . -)`;
  }
  return null;
}

export function apiVariablesProblem(list: unknown): string | null {
  if (!Array.isArray(list)) return "variables must be a list";
  if (list.length > API_CLIENT_BOUNDS.variables) return `At most ${API_CLIENT_BOUNDS.variables} variables`;
  const seen = new Set<string>();
  for (const v of list as ApiVariable[]) {
    if (!v || typeof v.key !== "string" || typeof v.value !== "string") return "Each variable needs a name and a value";
    if (!VAR_NAME_RE.test(v.key)) return `"${v.key.slice(0, 40)}" is not a variable name (letters, digits, _ . -; not starting with a digit)`;
    if (v.value.length > API_CLIENT_BOUNDS.valueLength) return `The value of ${v.key} is too long`;
    if (seen.has(v.key)) return `${v.key} is defined twice`;
    seen.add(v.key);
  }
  return null;
}

export function apiCollectionProblem(c: unknown, maxRequests: number): string | null {
  if (!c || typeof c !== "object") return "A collection must be an object";
  const col = c as ApiCollection;
  if (typeof col.name !== "string" || !col.name.trim() || col.name.length > 80) return "Give the collection a name (up to 80 characters)";
  const ap = authProblem(col.auth);
  if (ap) return `Collection auth: ${ap}`;
  if ((col.auth as ApiAuth).type === "inherit") return "Collection auth can't inherit";
  const vp = apiVariablesProblem(col.variables);
  if (vp) return vp;
  if (!Array.isArray(col.folders) || col.folders.length > API_CLIENT_BOUNDS.folders) return `At most ${API_CLIENT_BOUNDS.folders} folders`;
  const folderIds = new Set<string>();
  for (const f of col.folders) {
    if (!f || typeof f.id !== "string" || !f.id || typeof f.name !== "string" || !f.name.trim() || f.name.length > 80) return "Each folder needs a name (up to 80 characters)";
    if (folderIds.has(f.id)) return `Folder id ${f.id} is used twice`;
    folderIds.add(f.id);
  }
  for (const f of col.folders) {
    let depth = 0;
    let cur: ApiFolder | undefined = f;
    const seen = new Set<string>();
    while (cur?.parentId) {
      if (seen.has(cur.id) || !folderIds.has(cur.parentId)) return `Folder "${f.name}" has a missing or circular parent`;
      seen.add(cur.id);
      cur = col.folders.find((x) => x.id === cur!.parentId);
      if (++depth > API_CLIENT_BOUNDS.folderDepth) return `Folders nest at most ${API_CLIENT_BOUNDS.folderDepth} deep`;
    }
  }
  if (!Array.isArray(col.requests)) return "requests must be a list";
  if (col.requests.length > maxRequests) return `At most ${maxRequests} requests in a collection on your plan`;
  const ids = new Set<string>();
  for (const r of col.requests) {
    const p = apiRequestProblem(r);
    if (p) return p;
    if (ids.has(r.id)) return `Request id ${r.id} is used twice`;
    ids.add(r.id);
    if (r.folderId && !folderIds.has(r.folderId)) return `"${r.name}" is in a folder that doesn't exist`;
  }
  return null;
}

// ── Running a collection ─────────────────────────────────────────────────────

/** Sends a built request; throws an Error (with an optional code) when nothing came back. */
export type ApiSender = (built: BuiltRequest) => Promise<ApiResponse>;

/** Requests in the order a run takes them: folder tree depth first, then the collection's own order. */
export function orderedRequests(col: Pick<ApiCollection, "folders" | "requests">, folderId?: string | null): ApiRequest[] {
  const out: ApiRequest[] = [];
  const visit = (parent: string | null) => {
    for (const r of col.requests) if ((r.folderId ?? null) === parent) out.push(r);
    for (const f of col.folders) if ((f.parentId ?? null) === parent) visit(f.id);
  };
  if (folderId) {
    if (!col.folders.some((f) => f.id === folderId)) return [];
    visit(folderId);
  } else visit(null);
  // Requests whose folder vanished still run, last.
  for (const r of col.requests) if (!out.includes(r) && !folderId) out.push(r);
  return out;
}

export function folderPath(col: Pick<ApiCollection, "folders">, folderId?: string | null): string[] {
  const names: string[] = [];
  let cur = folderId ? col.folders.find((f) => f.id === folderId) : undefined;
  let guard = 0;
  while (cur && guard++ < 20) {
    names.unshift(cur.name);
    cur = cur.parentId ? col.folders.find((f) => f.id === cur!.parentId) : undefined;
  }
  return names;
}

export interface RunRequestResult {
  requestId: string;
  name: string;
  folder: string[];
  method: ApiMethod;
  url: string;
  status?: number;
  timeMs?: number;
  size?: number;
  outcome: "passed" | "failed" | "errored" | "skipped";
  error?: string;
  assertions: AssertionResult[];
  captures: CaptureResult[];
  /** Kept when the request failed, to show what came back (cut to 4 KB). */
  responsePreview?: string;
}

export interface RunReport {
  collection: string;
  environment?: string;
  startedAt: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  assertions: { passed: number; failed: number };
  results: RunRequestResult[];
}

export interface RunOptions {
  collection: ApiCollection;
  /** Environment variables (secrets already decrypted). */
  environment?: ApiVariable[];
  environmentName?: string;
  /** --var NAME=value, highest before captures. */
  overrides?: Record<string, string>;
  send: ApiSender;
  folderId?: string | null;
  requestIds?: string[];
  /** Stop at the first request that fails or errors. */
  bail?: boolean;
  delayMs?: number;
  /** Stop starting new requests after this many ms (the rest are "skipped"). */
  deadlineMs?: number;
  onResult?: (r: RunRequestResult, index: number, total: number) => void;
  /** Ask before each request (e.g. a rate limit); a string skips it with that reason. */
  beforeEach?: (r: ApiRequest) => Promise<string | null> | string | null;
}

export async function runCollection(opts: RunOptions): Promise<RunReport> {
  const started = Date.now();
  const { collection } = opts;
  let list = orderedRequests(collection, opts.folderId);
  if (opts.requestIds?.length) {
    const want = new Set(opts.requestIds);
    list = list.filter((r) => want.has(r.id));
  }
  const captured: Record<string, string> = {};
  const results: RunRequestResult[] = [];
  let stop: string | null = null;
  for (let i = 0; i < list.length; i++) {
    const req = list[i];
    const base = { requestId: req.id, name: req.name, folder: folderPath(collection, req.folderId), method: req.method, url: req.url, assertions: [] as AssertionResult[], captures: [] as CaptureResult[] };
    const push = (r: RunRequestResult) => {
      results.push(r);
      opts.onResult?.(r, i, list.length);
    };
    if (stop) {
      push({ ...base, outcome: "skipped", error: stop });
      continue;
    }
    if (opts.deadlineMs && Date.now() - started > opts.deadlineMs) {
      stop = `The run reached its ${Math.round(opts.deadlineMs / 1000)} s limit`;
      push({ ...base, outcome: "skipped", error: stop });
      continue;
    }
    const scope = makeScope([collection.variables, opts.environment, opts.overrides, captured]);
    const built = buildRequest(req, scope, { collectionAuth: collection.auth });
    const masked = buildRequest(req, { ...scope, mode: "mask" }, { collectionAuth: collection.auth });
    base.url = masked.url;
    if (built.problems.length) {
      push({ ...base, outcome: "errored", error: built.problems.join("; ") });
      if (opts.bail) stop = `Stopped after "${req.name}"`;
      continue;
    }
    const skip = opts.beforeEach ? await opts.beforeEach(req) : null;
    if (skip) {
      stop = skip;
      push({ ...base, outcome: "skipped", error: skip });
      continue;
    }
    let res: ApiResponse;
    try {
      res = await opts.send(built);
    } catch (err) {
      push({ ...base, outcome: "errored", error: (err as Error).message });
      if (opts.bail) stop = `Stopped after "${req.name}"`;
      continue;
    }
    const assertions = evaluateAssertions(req.assertions, res, makeScope([collection.variables, opts.environment, opts.overrides, captured]));
    const captures = applyCaptures(req.captures, res);
    for (const c of captures) if (c.ok && c.value !== undefined) captured[c.variable] = c.value;
    const failed = assertions.some((a) => !a.pass);
    push({
      ...base,
      status: res.status,
      timeMs: Math.round(res.timings.total),
      size: res.size,
      outcome: failed ? "failed" : "passed",
      assertions,
      captures: captures.map((c) => (scope.secrets.has(c.variable) ? { ...c, value: "••••" } : c)),
      responsePreview: failed ? (res.bodyEncoding === "utf8" ? res.body.slice(0, 4096) : `<${res.size} bytes of binary>`) : undefined,
    });
    if (failed && opts.bail) stop = `Stopped after "${req.name}"`;
    if (opts.delayMs && i < list.length - 1) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  const count = (o: RunRequestResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  const all = results.flatMap((r) => r.assertions);
  return {
    collection: collection.name,
    environment: opts.environmentName,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    total: results.length,
    passed: count("passed"),
    failed: count("failed"),
    errored: count("errored"),
    skipped: count("skipped"),
    assertions: { passed: all.filter((a) => a.pass).length, failed: all.filter((a) => !a.pass).length },
    results,
  };
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

/** JUnit XML (one testcase per request) for CI systems that show test reports. */
export function reportToJUnit(report: RunReport): string {
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<testsuites name=${JSON.stringify(xml(report.collection))} tests="${report.total}" failures="${report.failed}" errors="${report.errored}" skipped="${report.skipped}" time="${(report.durationMs / 1000).toFixed(3)}">`];
  lines.push(`  <testsuite name="${xml(report.collection)}" tests="${report.total}" failures="${report.failed}" errors="${report.errored}" skipped="${report.skipped}" time="${(report.durationMs / 1000).toFixed(3)}" timestamp="${report.startedAt}">`);
  for (const r of report.results) {
    const cls = xml([report.collection, ...r.folder].join("."));
    lines.push(`    <testcase classname="${cls}" name="${xml(`${r.method} ${r.name}`)}" time="${((r.timeMs ?? 0) / 1000).toFixed(3)}">`);
    if (r.outcome === "failed") {
      const failedChecks = r.assertions.filter((a) => !a.pass);
      lines.push(`      <failure message="${xml(failedChecks.map((a) => a.label).join("; "))}">${xml(failedChecks.map((a) => `${a.label}: ${a.message}`).join("\n"))}</failure>`);
    } else if (r.outcome === "errored") lines.push(`      <error message="${xml(r.error ?? "error")}"/>`);
    else if (r.outcome === "skipped") lines.push(`      <skipped message="${xml(r.error ?? "")}"/>`);
    if (r.assertions.length) lines.push(`      <system-out>${xml(r.assertions.map((a) => `${a.pass ? "✓" : "✗"} ${a.label} (${a.message})`).join("\n"))}</system-out>`);
    lines.push("    </testcase>");
  }
  lines.push("  </testsuite>", "</testsuites>", "");
  return lines.join("\n");
}
