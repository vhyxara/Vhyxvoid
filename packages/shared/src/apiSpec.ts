// packages/shared/src/apiSpec.ts
//
// API documentation (internal-tools/shared/api-platform-plan.md, phase 5),
// the pure parts:
//
//   - convertSwagger2: Swagger 2.0 -> OpenAPI 3.0.3 (paths, parameters,
//     bodies, responses, definitions, security, servers);
//   - validateSpec: problems with a location (errors block publishing);
//   - specModel: what the rendered docs show, with $refs resolved, examples
//     and code samples per operation;
//   - diffSpecs: what changed between two versions, each change marked
//     breaking / warning / info (for clients of the API).

import { codeSnippet, buildRequest, makeScope, newApiRequest, type ApiAuth, type ApiMethod, type SnippetLanguage } from "./apiClient";
import { sampleFromSchema } from "./mockApi";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

export const SPEC_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
export const SPEC_BOUNDS = { textBytes: 5_000_000, operations: 2_000, nameLength: 80 } as const;

// ── $ref ─────────────────────────────────────────────────────────────────────

export function pointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((acc, k) => (isObj(acc) || Array.isArray(acc) ? (acc as Json)[k.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined), doc);
}

/** Follows $ref chains (local only); undefined when a ref doesn't resolve. */
export function resolveRef<T = Json>(doc: unknown, node: unknown, depth = 0): T | undefined {
  if (!isObj(node)) return node as T;
  if (typeof node.$ref !== "string") return node as T;
  if (depth > 20) return undefined;
  return resolveRef<T>(doc, pointer(doc, node.$ref), depth + 1);
}

const refName = (ref: string) => ref.split("/").pop() ?? ref;

/**
 * A schema with $refs inlined up to `maxDepth` levels. A ref already being
 * expanded (a cycle) stays `{ $ref, title: Name }` so renderers can link it.
 */
export function derefSchema(doc: unknown, schema: unknown, maxDepth = 8, seen: string[] = []): unknown {
  if (Array.isArray(schema)) return schema.map((s) => derefSchema(doc, s, maxDepth, seen));
  if (!isObj(schema)) return schema;
  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (seen.includes(ref) || seen.length >= maxDepth) return { $ref: ref, title: refName(ref) };
    const target = pointer(doc, ref);
    if (target === undefined) return { $ref: ref, title: refName(ref), "x-unresolved": true };
    const out = derefSchema(doc, target, maxDepth, [...seen, ref]);
    return isObj(out) ? { "x-ref": refName(ref), ...out } : out;
  }
  const out: Json = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "properties" && isObj(v)) out[k] = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, derefSchema(doc, s, maxDepth, seen)]));
    else if (["items", "additionalProperties", "not"].includes(k)) out[k] = derefSchema(doc, v, maxDepth, seen);
    else if (["allOf", "anyOf", "oneOf"].includes(k) && Array.isArray(v)) out[k] = v.map((s) => derefSchema(doc, s, maxDepth, seen));
    else out[k] = v;
  }
  return out;
}

// ── Swagger 2 -> OpenAPI 3 ───────────────────────────────────────────────────

const rewriteRefs = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(rewriteRefs);
  if (!isObj(v)) return v;
  const out: Json = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === "$ref" && typeof x === "string") {
      out[k] = x.replace(/^#\/definitions\//, "#/components/schemas/").replace(/^#\/parameters\//, "#/components/parameters/").replace(/^#\/responses\//, "#/components/responses/");
    } else out[k] = rewriteRefs(x);
  }
  return out;
};

/** Swagger 2.0 to OpenAPI 3.0.3. Throws on anything that isn't Swagger 2. */
export function convertSwagger2(input: unknown): Json {
  if (!isObj(input) || input.swagger !== "2.0") throw new Error("Not a Swagger 2.0 document");
  const doc = rewriteRefs(input) as Json;
  const consumes = Array.isArray(doc.consumes) ? (doc.consumes as string[]) : ["application/json"];
  const produces = Array.isArray(doc.produces) ? (doc.produces as string[]) : ["application/json"];
  const schemes = Array.isArray(doc.schemes) && doc.schemes.length ? (doc.schemes as string[]) : ["https"];
  const out: Json = { openapi: "3.0.3", info: isObj(doc.info) ? doc.info : { title: "API", version: "1.0.0" } };
  if (doc.host) out.servers = schemes.map((s) => ({ url: `${s}://${str(doc.host)}${str(doc.basePath).replace(/\/$/, "")}` }));
  else if (doc.basePath) out.servers = [{ url: str(doc.basePath) }];
  if (Array.isArray(doc.tags)) out.tags = doc.tags;
  if (doc.externalDocs) out.externalDocs = doc.externalDocs;
  if (Array.isArray(doc.security)) out.security = doc.security;

  const toV3Param = (p: Json): Json => {
    const { type, format, items, enum: en, default: def, minimum, maximum, pattern, collectionFormat: _c, ...rest } = p;
    const schema: Json = Object.fromEntries(Object.entries({ type, format, items, enum: en, default: def, minimum, maximum, pattern }).filter(([, v]) => v !== undefined));
    return { ...rest, ...(p.schema ? {} : { schema }) };
  };
  const bodyFrom = (params: Json[], opConsumes: string[]): Json | undefined => {
    const body = params.find((p) => p.in === "body");
    const form = params.filter((p) => p.in === "formData");
    if (body) return { required: body.required === true, ...(body.description ? { description: body.description } : {}), content: Object.fromEntries(opConsumes.map((ct) => [ct, { schema: body.schema ?? {} }])) };
    if (form.length) {
      const hasFile = form.some((f) => f.type === "file");
      const ct = hasFile ? "multipart/form-data" : opConsumes.find((c) => c.includes("form")) ?? "application/x-www-form-urlencoded";
      const properties = Object.fromEntries(form.map((f) => [str(f.name), f.type === "file" ? { type: "string", format: "binary" } : (toV3Param(f).schema as Json)]));
      const required = form.filter((f) => f.required).map((f) => str(f.name));
      return { content: { [ct]: { schema: { type: "object", properties, ...(required.length ? { required } : {}) } } } };
    }
    return undefined;
  };

  const paths: Json = {};
  for (const [path, itemIn] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    if (!isObj(itemIn)) continue;
    const item: Json = {};
    const shared = Array.isArray(itemIn.parameters) ? (itemIn.parameters as Json[]) : [];
    if (shared.length) item.parameters = shared.filter((p) => p.in !== "body" && p.in !== "formData").map((p) => (p.$ref ? p : toV3Param(p)));
    for (const m of SPEC_METHODS) {
      const op = itemIn[m];
      if (!isObj(op)) continue;
      const params = [...shared, ...(Array.isArray(op.parameters) ? (op.parameters as Json[]) : [])].map((p) => (p.$ref ? ((resolveRef(doc, p) as Json) ?? p) : p));
      const { parameters: _p, consumes: oc, produces: op2, responses: rIn, ...rest } = op;
      const opProduces = Array.isArray(op2) ? (op2 as string[]) : produces;
      const v3: Json = { ...rest };
      const own = (Array.isArray(op.parameters) ? (op.parameters as Json[]) : []).filter((p) => p.$ref || (p.in !== "body" && p.in !== "formData"));
      if (own.length) v3.parameters = own.map((p) => (p.$ref ? p : toV3Param(p)));
      const body = bodyFrom(params, Array.isArray(oc) ? (oc as string[]) : consumes);
      if (body) v3.requestBody = body;
      const responses: Json = {};
      for (const [code, rIn2] of Object.entries(isObj(rIn) ? rIn : {})) {
        if (!isObj(rIn2)) continue;
        if (rIn2.$ref) {
          responses[code] = rIn2;
          continue;
        }
        const r: Json = { description: str(rIn2.description, code) };
        if (rIn2.schema) r.content = Object.fromEntries(opProduces.map((ct) => [ct, { schema: rIn2.schema, ...(isObj(rIn2.examples) && rIn2.examples[ct] !== undefined ? { example: rIn2.examples[ct] } : {}) }]));
        if (isObj(rIn2.headers)) r.headers = Object.fromEntries(Object.entries(rIn2.headers).map(([h, s]) => [h, { schema: s }]));
        responses[code] = r;
      }
      v3.responses = Object.keys(responses).length ? responses : { default: { description: "Response" } };
      item[m] = v3;
    }
    paths[path] = item;
  }
  out.paths = paths;

  const components: Json = {};
  if (isObj(doc.definitions)) components.schemas = doc.definitions;
  if (isObj(doc.parameters)) components.parameters = Object.fromEntries(Object.entries(doc.parameters).filter(([, p]) => isObj(p) && p.in !== "body" && p.in !== "formData").map(([k, p]) => [k, toV3Param(p as Json)]));
  if (isObj(doc.securityDefinitions)) {
    components.securitySchemes = Object.fromEntries(
      Object.entries(doc.securityDefinitions).map(([k, s]) => {
        const sd = s as Json;
        if (sd.type === "basic") return [k, { type: "http", scheme: "basic", ...(sd.description ? { description: sd.description } : {}) }];
        if (sd.type === "apiKey") return [k, { type: "apiKey", name: sd.name, in: sd.in, ...(sd.description ? { description: sd.description } : {}) }];
        if (sd.type === "oauth2") {
          const flow = sd.flow === "accessCode" ? "authorizationCode" : sd.flow === "application" ? "clientCredentials" : str(sd.flow, "implicit");
          return [k, { type: "oauth2", flows: { [flow]: Object.fromEntries(Object.entries({ authorizationUrl: sd.authorizationUrl, tokenUrl: sd.tokenUrl, scopes: sd.scopes ?? {} }).filter(([, v]) => v !== undefined)) } }];
        }
        return [k, sd];
      }),
    );
  }
  if (Object.keys(components).length) out.components = components;
  return out;
}

/** OpenAPI 3.x as is; Swagger 2 converted. Throws a readable Error otherwise. */
export function normalizeSpec(doc: unknown): { doc: Json; converted: boolean } {
  if (isObj(doc) && doc.swagger === "2.0") return { doc: convertSwagger2(doc), converted: true };
  if (isObj(doc) && typeof doc.openapi === "string" && /^3\./.test(doc.openapi)) return { doc, converted: false };
  throw new Error('Not an OpenAPI 3.x or Swagger 2.0 document (it needs "openapi: 3.x" or "swagger: 2.0" at the top)');
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface SpecProblem {
  /** Where, e.g. "paths./users/{id}.get.parameters[0]". */
  path: string;
  message: string;
  severity: "error" | "warning";
}

const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object", "null"]);
const PARAM_IN = new Set(["query", "header", "path", "cookie"]);

/** Problems a reader of the docs or a client generator would hit. Errors block publishing. */
export function validateSpec(doc: unknown): SpecProblem[] {
  const out: SpecProblem[] = [];
  const err = (path: string, message: string) => out.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) => out.push({ path, message, severity: "warning" });
  if (!isObj(doc)) return [{ path: "", message: "The document must be an object", severity: "error" }];
  if (typeof doc.openapi !== "string" || !/^3\.[01]\.\d+$/.test(doc.openapi)) err("openapi", 'Set "openapi" to a 3.0.x or 3.1.x version, e.g. 3.0.3');
  const info = doc.info;
  if (!isObj(info)) err("info", "info is required (title and version)");
  else {
    if (!str(info.title).trim()) err("info.title", "Give the API a title");
    if (!str(info.version).trim() && typeof info.version !== "number") err("info.version", "Give the API a version, e.g. 1.0.0");
  }
  if (doc.servers !== undefined) {
    if (!Array.isArray(doc.servers)) err("servers", "servers must be a list");
    else doc.servers.forEach((s, i) => !isObj(s) || !str(s.url) ? err(`servers[${i}]`, "Each server needs a url") : undefined);
  } else warn("servers", "No servers: readers won't know the base URL, and try-it needs one");

  // Refs: every local $ref must resolve.
  const walkRefs = (v: unknown, at: string, depth = 0) => {
    if (depth > 60) return;
    if (Array.isArray(v)) return v.forEach((x, i) => walkRefs(x, `${at}[${i}]`, depth + 1));
    if (!isObj(v)) return;
    if (typeof v.$ref === "string") {
      if (!v.$ref.startsWith("#/")) warn(at, `External reference ${v.$ref} is not followed`);
      else if (pointer(doc, v.$ref) === undefined) err(at, `${v.$ref} doesn't exist`);
    }
    for (const [k, x] of Object.entries(v)) if (k !== "$ref" && k !== "example" && k !== "examples") walkRefs(x, at ? `${at}.${k}` : k, depth + 1);
  };
  walkRefs(doc, "");

  const opIds = new Map<string, string>();
  let ops = 0;
  if (!isObj(doc.paths)) err("paths", "paths is required (it can be empty: {})");
  else
    for (const [path, itemIn] of Object.entries(doc.paths)) {
      const pAt = `paths.${path}`;
      if (!path.startsWith("/")) err(pAt, "A path must start with /");
      const item = resolveRef<Json>(doc, itemIn);
      if (!isObj(item)) continue;
      const template = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      const shared = (Array.isArray(item.parameters) ? item.parameters : []).map((p) => resolveRef<Json>(doc, p)).filter(isObj);
      let methods = 0;
      for (const m of SPEC_METHODS) {
        const op = item[m];
        if (op === undefined) continue;
        methods++;
        ops++;
        const at = `${pAt}.${m}`;
        if (!isObj(op)) {
          err(at, "An operation must be an object");
          continue;
        }
        if (op.operationId !== undefined) {
          const id = str(op.operationId);
          if (opIds.has(id)) err(`${at}.operationId`, `operationId "${id}" is also used by ${opIds.get(id)}`);
          else opIds.set(id, `${m.toUpperCase()} ${path}`);
        }
        if (!op.summary && !op.description) warn(at, "Add a summary so the docs say what it does");
        const own = (Array.isArray(op.parameters) ? op.parameters : []).map((p) => resolveRef<Json>(doc, p));
        const seen = new Set<string>();
        own.forEach((p, i) => {
          const pa = `${at}.parameters[${i}]`;
          if (!isObj(p)) return;
          const name = str(p.name);
          const where = str(p.in);
          if (!name) err(pa, "A parameter needs a name");
          if (!PARAM_IN.has(where)) err(pa, `"in" must be query, header, path or cookie${where === "body" || where === "formData" ? " (use requestBody in OpenAPI 3)" : ""}`);
          if (seen.has(`${where}:${name}`)) err(pa, `${name} (${where}) is declared twice`);
          seen.add(`${where}:${name}`);
          if (where === "path" && p.required !== true) err(pa, `Path parameter ${name} must have required: true`);
          if (where === "path" && !template.includes(name)) err(pa, `Path parameter ${name} isn't in the path ${path}`);
          if (!p.schema && !p.content) warn(pa, `Give ${name} a schema (type)`);
        });
        const declared = new Set([...shared, ...own].filter(isObj).filter((p) => p.in === "path").map((p) => str(p.name)));
        for (const t of template) if (!declared.has(t)) err(at, `{${t}} in the path has no path parameter`);
        if (!isObj(op.responses) || !Object.keys(op.responses).length) err(`${at}.responses`, "List at least one response");
        else
          for (const code of Object.keys(op.responses)) {
            if (!/^([1-5]\d\d|[1-5]XX|default)$/i.test(code)) err(`${at}.responses.${code}`, `"${code}" is not a status code (use 200, 4XX or default)`);
            const r = resolveRef<Json>(doc, op.responses[code]);
            if (isObj(r) && r.description === undefined) warn(`${at}.responses.${code}`, "A response needs a description");
          }
        if (op.requestBody !== undefined) {
          const rb = resolveRef<Json>(doc, op.requestBody);
          if (!isObj(rb) || !isObj(rb.content) || !Object.keys(rb.content).length) err(`${at}.requestBody`, "requestBody needs content (e.g. application/json with a schema)");
          if (m === "get" || m === "head") warn(`${at}.requestBody`, `${m.toUpperCase()} with a body: many clients and servers drop it`);
        }
      }
      if (!methods) warn(pAt, "No operations on this path");
    }
  if (ops > SPEC_BOUNDS.operations) err("paths", `At most ${SPEC_BOUNDS.operations} operations`);

  // Schema types.
  const schemas = isObj(doc.components) && isObj(doc.components.schemas) ? doc.components.schemas : {};
  const checkSchema = (s: unknown, at: string, depth = 0) => {
    if (!isObj(s) || depth > 30) return;
    const t = s.type;
    for (const x of Array.isArray(t) ? t : t === undefined ? [] : [t]) if (typeof x !== "string" || !SCHEMA_TYPES.has(x)) err(`${at}.type`, `"${String(x)}" is not a schema type`);
    if (t === "array" && s.items === undefined) warn(at, "An array schema needs items");
    if (Array.isArray(s.required) && isObj(s.properties)) for (const r of s.required) if (!(String(r) in s.properties)) warn(`${at}.required`, `"${r}" is required but not in properties`);
    if (isObj(s.properties)) for (const [k, v] of Object.entries(s.properties)) checkSchema(v, `${at}.properties.${k}`, depth + 1);
    if (s.items) checkSchema(s.items, `${at}.items`, depth + 1);
  };
  for (const [k, v] of Object.entries(schemas)) checkSchema(v, `components.schemas.${k}`);
  return out;
}

// ── Docs model ───────────────────────────────────────────────────────────────

export interface DocsMedia {
  type: string;
  schema: unknown;
  example: unknown;
}

export interface DocsParameter {
  name: string;
  in: string;
  required: boolean;
  deprecated: boolean;
  description: string;
  schema: unknown;
  example: unknown;
}

export interface DocsOperation {
  /** Anchor, e.g. "get-users-id". */
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  operationId: string;
  deprecated: boolean;
  tags: string[];
  parameters: DocsParameter[];
  requestBody: { required: boolean; description: string; contents: DocsMedia[] } | null;
  responses: Array<{ code: string; description: string; contents: DocsMedia[]; headers: Array<{ name: string; description: string; schema: unknown }> }>;
  /** Names of the security schemes it needs ([] = public, null = the API's default). */
  security: string[][];
  samples: Partial<Record<SnippetLanguage, string>>;
}

export interface DocsModel {
  title: string;
  version: string;
  description: string;
  openapi: string;
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string; operations: DocsOperation[] }>;
  schemas: Array<{ name: string; description: string; schema: unknown }>;
  securitySchemes: Array<{ name: string; type: string; scheme: string; in: string; paramName: string; description: string; bearerFormat: string }>;
  operationCount: number;
}

export const operationAnchor = (method: string, path: string) =>
  `${method.toLowerCase()}-${path.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "root"}`;

function mediaList(doc: Json, content: unknown): DocsMedia[] {
  if (!isObj(content)) return [];
  return Object.entries(content).map(([type, mIn]) => {
    const m = isObj(mIn) ? mIn : {};
    let example: unknown = m.example;
    if (example === undefined && isObj(m.examples)) {
      const first = resolveRef<Json>(doc, Object.values(m.examples)[0]);
      example = isObj(first) ? first.value : undefined;
    }
    if (example === undefined && m.schema !== undefined) example = sampleFromSchema(doc, m.schema);
    return { type, schema: derefSchema(doc, m.schema), example };
  });
}

/** Schemes the operation needs: [[A], [B, C]] = A, or B and C together. [] when public. */
function securityOf(doc: Json, op: Json): string[][] {
  const list = Array.isArray(op.security) ? op.security : Array.isArray(doc.security) ? doc.security : [];
  return list.filter(isObj).map((req) => Object.keys(req)).filter((x) => x.length);
}

function samplesFor(doc: Json, o: Omit<DocsOperation, "samples">, server: string): DocsOperation["samples"] {
  const pathValue = (p: DocsParameter) => String(p.example ?? sampleFromSchema(doc, p.schema) ?? p.name);
  let path = o.path;
  for (const p of o.parameters.filter((x) => x.in === "path")) path = path.replace(`{${p.name}}`, encodeURIComponent(pathValue(p)));
  const base = /^https?:\/\//.test(server) ? server.replace(/\/$/, "") : `https://api.example.com${server.replace(/\/$/, "")}`;
  const schemes = isObj(doc.components) && isObj(doc.components.securitySchemes) ? doc.components.securitySchemes : {};
  const first = o.security[0]?.[0];
  const scheme = first ? resolveRef<Json>(doc, schemes[first]) : undefined;
  const headers = o.parameters.filter((p) => p.in === "header" && p.required).map((p) => ({ key: p.name, value: pathValue(p), enabled: true }));
  const params = o.parameters.filter((p) => p.in === "query" && p.required).map((p) => ({ key: p.name, value: pathValue(p), enabled: true }));
  let auth: ApiAuth = { type: "none" };
  if (isObj(scheme)) {
    if (scheme.type === "http" && str(scheme.scheme).toLowerCase() === "basic") auth = { type: "basic", username: "USERNAME", password: "PASSWORD" };
    else if ((scheme.type === "http" && str(scheme.scheme).toLowerCase() === "bearer") || scheme.type === "oauth2" || scheme.type === "openIdConnect") auth = { type: "bearer", token: "YOUR_TOKEN" };
    else if (scheme.type === "apiKey" && scheme.in !== "cookie") auth = { type: "apiKey", name: str(scheme.name, "X-API-Key"), value: "YOUR_API_KEY", in: scheme.in === "query" ? "query" : "header" };
  }
  const json = o.requestBody?.contents.find((c) => c.type.includes("json"));
  const form = o.requestBody?.contents.find((c) => c.type.includes("x-www-form-urlencoded"));
  const body = json
    ? { type: "json" as const, text: JSON.stringify(json.example ?? {}, null, 2) }
    : form && isObj(form.example)
      ? { type: "form" as const, fields: Object.entries(form.example).map(([k, v]) => ({ key: k, value: typeof v === "string" ? v : JSON.stringify(v), enabled: true })) }
      : { type: "none" as const };
  const method = o.method.toUpperCase();
  const req = newApiRequest({ method: (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method) ? method : "GET") as ApiMethod, url: `${base}${path}`, params, headers, auth, body });
  const built = buildRequest(req, makeScope([]));
  if (built.problems.length) return {};
  const out: DocsOperation["samples"] = {};
  for (const lang of ["curl", "fetch", "python", "go"] as const) out[lang] = codeSnippet(built, lang, req);
  return out;
}

/** What rendered docs show. Assumes an OpenAPI 3 document (normalizeSpec first). */
export function specModel(doc: Json, opts: { samples?: boolean } = {}): DocsModel {
  const info = isObj(doc.info) ? doc.info : {};
  const servers = (Array.isArray(doc.servers) ? doc.servers : []).filter(isObj).map((s) => {
    let url = str(s.url);
    if (isObj(s.variables)) for (const [k, v] of Object.entries(s.variables)) url = url.replace(`{${k}}`, str(isObj(v) ? v.default : "", k));
    return { url, description: str(s.description) };
  });
  const tagDefs = (Array.isArray(doc.tags) ? doc.tags : []).filter(isObj).map((t) => ({ name: str(t.name), description: str(t.description) }));
  const byTag = new Map<string, DocsOperation[]>();
  let count = 0;
  for (const [path, itemIn] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    const item = resolveRef<Json>(doc, itemIn);
    if (!isObj(item)) continue;
    const shared = (Array.isArray(item.parameters) ? item.parameters : []).map((p) => resolveRef<Json>(doc, p)).filter(isObj);
    for (const m of SPEC_METHODS) {
      const op = item[m];
      if (!isObj(op)) continue;
      count++;
      const own = (Array.isArray(op.parameters) ? op.parameters : []).map((p) => resolveRef<Json>(doc, p)).filter(isObj);
      const merged = [...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)), ...own];
      const parameters: DocsParameter[] = merged.map((p) => ({
        name: str(p.name),
        in: str(p.in),
        required: p.required === true,
        deprecated: p.deprecated === true,
        description: str(p.description),
        schema: derefSchema(doc, p.schema),
        example: p.example ?? (isObj(p.schema) ? (p.schema as Json).example : undefined),
      }));
      const rb = op.requestBody !== undefined ? resolveRef<Json>(doc, op.requestBody) : undefined;
      const responses = Object.entries(isObj(op.responses) ? op.responses : {}).map(([code, rIn]) => {
        const r = resolveRef<Json>(doc, rIn) ?? {};
        return {
          code,
          description: str(r.description),
          contents: mediaList(doc, r.content),
          headers: Object.entries(isObj(r.headers) ? r.headers : {}).map(([name, hIn]) => {
            const h = resolveRef<Json>(doc, hIn) ?? {};
            return { name, description: str(h.description), schema: derefSchema(doc, h.schema) };
          }),
        };
      });
      responses.sort((a, b) => a.code.localeCompare(b.code));
      const base: Omit<DocsOperation, "samples"> = {
        id: operationAnchor(m, path),
        method: m.toUpperCase(),
        path,
        summary: str(op.summary),
        description: str(op.description),
        operationId: str(op.operationId),
        deprecated: op.deprecated === true,
        tags: Array.isArray(op.tags) && op.tags.length ? (op.tags as unknown[]).map(String) : ["default"],
        parameters,
        requestBody: isObj(rb) ? { required: rb.required === true, description: str(rb.description), contents: mediaList(doc, rb.content) } : null,
        responses,
        security: securityOf(doc, op),
      };
      const full: DocsOperation = { ...base, samples: opts.samples === false ? {} : samplesFor(doc, base, servers[0]?.url ?? "") };
      for (const t of full.tags) (byTag.get(t) ?? byTag.set(t, []).get(t)!).push(full);
    }
  }
  const tags = [
    ...tagDefs.filter((t) => byTag.has(t.name)).map((t) => ({ ...t, operations: byTag.get(t.name)! })),
    ...[...byTag.keys()].filter((t) => !tagDefs.some((d) => d.name === t)).map((t) => ({ name: t, description: "", operations: byTag.get(t)! })),
  ];
  const components = isObj(doc.components) ? doc.components : {};
  return {
    title: str(info.title, "API"),
    version: String(info.version ?? ""),
    description: str(info.description),
    openapi: str(doc.openapi),
    servers,
    tags,
    schemas: Object.entries(isObj(components.schemas) ? components.schemas : {}).map(([name, s]) => ({ name, description: isObj(s) ? str(s.description) : "", schema: derefSchema(doc, s, 4) })),
    securitySchemes: Object.entries(isObj(components.securitySchemes) ? components.securitySchemes : {}).map(([name, sIn]) => {
      const s = resolveRef<Json>(doc, sIn) ?? {};
      return { name, type: str(s.type), scheme: str(s.scheme), in: str(s.in), paramName: str(s.name), description: str(s.description), bearerFormat: str(s.bearerFormat) };
    }),
    operationCount: count,
  };
}

// ── Diff ─────────────────────────────────────────────────────────────────────

export interface SpecChange {
  severity: "breaking" | "warning" | "info";
  /** Operation ("GET /users/{}") or "API". */
  location: string;
  message: string;
}

const normPath = (p: string) => p.replace(/\{[^}]+\}/g, "{}");

type OpEntry = { method: string; path: string; op: Json; shared: Json[] };

function operationsOf(doc: Json): Map<string, OpEntry> {
  const out = new Map<string, OpEntry>();
  for (const [path, itemIn] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    const item = resolveRef<Json>(doc, itemIn);
    if (!isObj(item)) continue;
    const shared = (Array.isArray(item.parameters) ? item.parameters : []).map((p) => resolveRef<Json>(doc, p)).filter(isObj);
    for (const m of SPEC_METHODS) if (isObj(item[m])) out.set(`${m.toUpperCase()} ${normPath(path)}`, { method: m.toUpperCase(), path, op: item[m] as Json, shared });
  }
  return out;
}

/** A schema with its $ref followed and allOf parts merged (properties, required, type). */
function flatSchema(doc: Json, s: unknown, depth = 0): Json | undefined {
  const r = resolveRef<Json>(doc, s);
  if (!isObj(r) || !Array.isArray(r.allOf) || depth > 10) return isObj(r) ? r : undefined;
  const { allOf, ...rest } = r;
  const out: Json = { ...rest };
  const props: Json = isObj(rest.properties) ? { ...rest.properties } : {};
  const req = new Set(Array.isArray(rest.required) ? (rest.required as string[]) : []);
  for (const part of allOf as unknown[]) {
    const f = flatSchema(doc, part, depth + 1);
    if (!f) continue;
    if (isObj(f.properties)) Object.assign(props, f.properties);
    if (Array.isArray(f.required)) for (const k of f.required as string[]) req.add(k);
    if (out.type === undefined && f.type !== undefined) out.type = f.type;
  }
  if (Object.keys(props).length) out.properties = props;
  if (req.size) out.required = [...req];
  return out;
}

const typeName = (s: unknown) => (isObj(s) ? (Array.isArray(s.type) ? (s.type as string[]).join("|") : str(s.type, isObj(s.properties) ? "object" : "")) : "");

/**
 * Compares two schemas as seen by a client. "request": what the client sends
 * (new required fields, narrowed enums break it). "response": what the
 * client reads (removed fields, changed types break it).
 */
function diffSchema(oldDoc: Json, newDoc: Json, a: unknown, b: unknown, dir: "request" | "response", at: string, push: (c: Omit<SpecChange, "location">) => void, depth = 0) {
  if (depth > 12) return;
  const x = flatSchema(oldDoc, a);
  const y = flatSchema(newDoc, b);
  if (!isObj(x) || !isObj(y)) return;
  const tx = typeName(x);
  const ty = typeName(y);
  if (tx && ty && tx !== ty && !(tx === "integer" && ty === "number" && dir === "response") && !(tx === "number" && ty === "integer" && dir === "request")) {
    push({ severity: "breaking", message: `${at || "body"}: type changed from ${tx} to ${ty}` });
    return;
  }
  const ex = Array.isArray(x.enum) ? x.enum.map((v) => JSON.stringify(v)) : null;
  const ey = Array.isArray(y.enum) ? y.enum.map((v) => JSON.stringify(v)) : null;
  if (ex && ey) {
    const removed = ex.filter((v) => !ey.includes(v));
    const added = ey.filter((v) => !ex.includes(v));
    if (removed.length) push({ severity: dir === "request" ? "breaking" : "info", message: `${at || "value"}: no longer accepts ${removed.join(", ")}` });
    if (added.length) push({ severity: dir === "response" ? "warning" : "info", message: `${at || "value"}: new value${added.length === 1 ? "" : "s"} ${added.join(", ")}${dir === "response" ? " (clients may not expect it)" : ""}` });
  } else if (!ex && ey && dir === "request") push({ severity: "breaking", message: `${at || "value"}: now limited to ${ey.join(", ")}` });
  const px = isObj(x.properties) ? x.properties : {};
  const py = isObj(y.properties) ? y.properties : {};
  const rx = new Set(Array.isArray(x.required) ? (x.required as string[]) : []);
  const ry = new Set(Array.isArray(y.required) ? (y.required as string[]) : []);
  const name = (k: string) => (at ? `${at}.${k}` : k);
  for (const k of Object.keys(px)) {
    if (!(k in py)) {
      if (dir === "response") push({ severity: "breaking", message: `${name(k)} was removed from the response` });
      else push({ severity: rx.has(k) ? "info" : "warning", message: `${name(k)} is no longer read by the API` });
    }
  }
  for (const k of Object.keys(py)) {
    if (!(k in px)) {
      if (dir === "request" && ry.has(k)) push({ severity: "breaking", message: `new required field ${name(k)}` });
      else push({ severity: "info", message: `new field ${name(k)}` });
    } else {
      if (dir === "request" && ry.has(k) && !rx.has(k)) push({ severity: "breaking", message: `${name(k)} is now required` });
      if (dir === "response" && rx.has(k) && !ry.has(k)) push({ severity: "warning", message: `${name(k)} may now be missing from the response` });
      diffSchema(oldDoc, newDoc, px[k], py[k], dir, name(k), push, depth + 1);
    }
  }
  if (x.items || y.items) diffSchema(oldDoc, newDoc, x.items, y.items, dir, `${at}[]`, push, depth + 1);
}

function jsonContent(doc: Json, body: unknown): Json | undefined {
  const b = resolveRef<Json>(doc, body);
  if (!isObj(b) || !isObj(b.content)) return undefined;
  const key = Object.keys(b.content).find((k) => k.includes("json")) ?? Object.keys(b.content)[0];
  return key ? (b.content[key] as Json) : undefined;
}

/** Changes from `oldDoc` to `newDoc` (both OpenAPI 3), most severe first. */
export function diffSpecs(oldDoc: Json, newDoc: Json): SpecChange[] {
  const out: SpecChange[] = [];
  const add = (location: string) => (c: Omit<SpecChange, "location">) => out.push({ ...c, location });
  const api = add("API");
  const vOld = isObj(oldDoc.info) ? String(oldDoc.info.version ?? "") : "";
  const vNew = isObj(newDoc.info) ? String(newDoc.info.version ?? "") : "";
  if (vOld !== vNew) api({ severity: "info", message: `version ${vOld || "(none)"} → ${vNew || "(none)"}` });
  const sOld = (Array.isArray(oldDoc.servers) ? oldDoc.servers : []).filter(isObj).map((s) => str(s.url));
  const sNew = (Array.isArray(newDoc.servers) ? newDoc.servers : []).filter(isObj).map((s) => str(s.url));
  for (const s of sOld) if (!sNew.includes(s)) api({ severity: "warning", message: `server ${s} was removed` });
  for (const s of sNew) if (!sOld.includes(s)) api({ severity: "info", message: `new server ${s}` });

  const before = operationsOf(oldDoc);
  const after = operationsOf(newDoc);
  for (const [key, o] of before) if (!after.has(key)) add(`${o.method} ${o.path}`)({ severity: "breaking", message: "operation removed" });
  for (const [key, n] of after) {
    const loc = add(`${n.method} ${n.path}`);
    const o = before.get(key);
    if (!o) {
      loc({ severity: "info", message: "new operation" });
      continue;
    }
    if (!o.op.deprecated && n.op.deprecated) loc({ severity: "warning", message: "now deprecated" });
    // Parameters
    const params = (doc: Json, e: OpEntry) => {
      const own = (Array.isArray(e.op.parameters) ? e.op.parameters : []).map((p) => resolveRef<Json>(doc, p)).filter(isObj);
      const all = [...e.shared.filter((s) => !own.some((x) => x.name === s.name && x.in === s.in)), ...own];
      return new Map(all.map((p) => [`${str(p.in)}:${str(p.in) === "header" ? str(p.name).toLowerCase() : str(p.name)}`, p]));
    };
    const pa = params(oldDoc, o);
    const pb = params(newDoc, n);
    for (const [k, p] of pb) {
      const label = `${str(p.in)} parameter ${str(p.name)}`;
      const prev = pa.get(k);
      if (!prev) loc({ severity: p.required === true && p.in !== "path" ? "breaking" : "info", message: `new ${p.required === true ? "required" : "optional"} ${label}` });
      else {
        if (p.required === true && prev.required !== true) loc({ severity: "breaking", message: `${label} is now required` });
        diffSchema(oldDoc, newDoc, prev.schema, p.schema, "request", label, loc);
      }
    }
    for (const [k, p] of pa) if (!pb.has(k) && p.in !== "path") loc({ severity: "warning", message: `${str(p.in)} parameter ${str(p.name)} was removed (clients still sending it may be refused)` });
    // Request body
    const rbOld = resolveRef<Json>(oldDoc, o.op.requestBody);
    const rbNew = resolveRef<Json>(newDoc, n.op.requestBody);
    if (!isObj(rbOld) && isObj(rbNew)) loc({ severity: rbNew.required === true ? "breaking" : "info", message: `new ${rbNew.required === true ? "required " : ""}request body` });
    else if (isObj(rbOld) && isObj(rbNew)) {
      if (rbNew.required === true && rbOld.required !== true) loc({ severity: "breaking", message: "the request body is now required" });
      const ctOld = Object.keys(isObj(rbOld.content) ? rbOld.content : {});
      const ctNew = Object.keys(isObj(rbNew.content) ? rbNew.content : {});
      for (const ct of ctOld) if (!ctNew.includes(ct)) loc({ severity: "breaking", message: `request body no longer accepts ${ct}` });
      diffSchema(oldDoc, newDoc, jsonContent(oldDoc, rbOld)?.schema, jsonContent(newDoc, rbNew)?.schema, "request", "", (c) => loc({ ...c, message: `request: ${c.message}` }));
    } else if (isObj(rbOld) && !isObj(rbNew)) loc({ severity: "warning", message: "the request body was removed" });
    // Responses
    const rOld = isObj(o.op.responses) ? o.op.responses : {};
    const rNew = isObj(n.op.responses) ? n.op.responses : {};
    for (const code of Object.keys(rOld)) {
      if (!(code in rNew)) loc({ severity: code.startsWith("2") ? "breaking" : "warning", message: `response ${code} was removed` });
      else diffSchema(oldDoc, newDoc, jsonContent(oldDoc, rOld[code])?.schema, jsonContent(newDoc, rNew[code])?.schema, "response", "", (c) => loc({ ...c, message: `response ${code}: ${c.message}` }));
    }
    for (const code of Object.keys(rNew)) if (!(code in rOld)) loc({ severity: code.startsWith("2") ? "warning" : "info", message: `new response ${code}` });
    // Security
    const secOld = securityOf(oldDoc, o.op);
    const secNew = securityOf(newDoc, n.op);
    if (!secOld.length && secNew.length) loc({ severity: "breaking", message: `now needs authentication (${secNew.map((s) => s.join(" + ")).join(" or ")})` });
    else if (secOld.length && secNew.length && JSON.stringify(secOld) !== JSON.stringify(secNew)) loc({ severity: "warning", message: `authentication changed to ${secNew.map((s) => s.join(" + ")).join(" or ")}` });
    else if (secOld.length && !secNew.length) loc({ severity: "info", message: "no longer needs authentication" });
  }
  const rank = { breaking: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.location.localeCompare(b.location));
}

export function changeCounts(changes: readonly SpecChange[]): { breaking: number; warning: number; info: number } {
  return { breaking: changes.filter((c) => c.severity === "breaking").length, warning: changes.filter((c) => c.severity === "warning").length, info: changes.filter((c) => c.severity === "info").length };
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export const SPEC_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export function specSlugFrom(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/, "") || "api"
  );
}

/** A small, valid starting document. */
export function starterSpec(title: string): Json {
  return {
    openapi: "3.0.3",
    info: { title, version: "1.0.0", description: `The ${title} API.` },
    servers: [{ url: "https://api.example.com/v1", description: "Production" }],
    tags: [{ name: "Users", description: "People who use the product" }],
    paths: {
      "/users": {
        get: {
          tags: ["Users"],
          summary: "List users",
          operationId: "listUsers",
          parameters: [{ name: "limit", in: "query", description: "How many to return", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }],
          responses: { "200": { description: "The users", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/User" } } } } } },
        },
        post: {
          tags: ["Users"],
          summary: "Create a user",
          operationId: "createUser",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NewUser" } } } },
          responses: { "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } }, "422": { description: "Invalid input" } },
        },
      },
      "/users/{id}": {
        get: {
          tags: ["Users"],
          summary: "Get a user",
          operationId: "getUser",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", example: 42 } }],
          responses: { "200": { description: "The user", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } }, "404": { description: "No such user" } },
        },
      },
    },
    components: {
      schemas: {
        NewUser: { type: "object", required: ["name", "email"], properties: { name: { type: "string", example: "Ada Lovelace" }, email: { type: "string", format: "email", example: "ada@example.com" } } },
        User: { allOf: [{ $ref: "#/components/schemas/NewUser" }, { type: "object", required: ["id"], properties: { id: { type: "integer", example: 42 } } }] },
      },
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    },
    security: [{ bearer: [] }],
  };
}
