// The platform API's OpenAPI document, built from the routes themselves.
//
// Every route that accepts an API key declares `config.apiKeyScope`; it also
// declares `config.apiDoc` (a summary, and the zod schemas its handler
// validates the body and query with). An onRoute hook collects them while the
// routes are registered, so the document lists exactly what is served and
// can't drift from the code. Served at GET /api/v1/platform/openapi.json; a
// copy is kept in apps/docs/public and checked by tests/e2e/platformOpenApi.test.ts.
import type { RouteOptions } from "fastify";
import { z } from "zod";

import { ANY_SCOPE } from "./apiKeyAuth";

export type ApiDoc = {
  summary: string;
  description?: string;
  body?: z.ZodType;
  query?: z.ZodType;
  /** The success status (default 200). */
  status?: number;
  /** The success response is a file, not the JSON envelope. */
  file?: string;
};

export type CollectedRoute = { method: string; url: string; scope: string; doc?: ApiDoc };

/** Collects API-key routes as they are registered; add `onRoute` before registering them. */
export function platformRouteCollector() {
  const routes: CollectedRoute[] = [];
  return {
    routes,
    onRoute(opts: RouteOptions) {
      const config = (opts.config ?? {}) as { apiKeyScope?: string; apiDoc?: ApiDoc };
      if (!config.apiKeyScope) return;
      for (const method of [opts.method].flat()) {
        if (method === "HEAD" || method === "OPTIONS") continue;
        routes.push({ method: String(method).toUpperCase(), url: opts.url, scope: config.apiKeyScope, doc: config.apiDoc });
      }
    },
  };
}

const TAGS: Record<string, { name: string; description: string }> = {
  platform: { name: "Platform", description: "The key itself." },
  mocks: { name: "Mock APIs", description: "Hosted mock APIs: list, read, create, change, import, try, export." },
  specs: { name: "API docs", description: "OpenAPI specs: drafts, checks against the latest version, versions, diffs, exports." },
  "api-client": { name: "API client", description: "Collections and their runs. Runs finish in the background: start one, then poll it." },
  team: { name: "Team space", description: "Channels and messages, documents, issues and comments. Writes act as the key's creator." },
  ai: { name: "AI assist", description: "Drafts of mock endpoints and test collections. Drafts run in the background: start one, then poll it." },
  analytics: { name: "Analytics", description: "Compare live traffic with a spec." },
};

const SAFE_INT = 9007199254740991;

/** zod -> JSON Schema (2020-12, what OpenAPI 3.1 uses), without the noise zod adds. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  let out: Record<string, unknown>;
  try {
    out = z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
      // Dates travel as ISO 8601 text (z.coerce.date() parses them).
      override: (ctx) => {
        if ((ctx.zodSchema as { _zod?: { def?: { type?: string } } })._zod?.def?.type === "date") Object.assign(ctx.jsonSchema, { type: "string", format: "date-time" });
      },
    }) as Record<string, unknown>;
  } catch {
    return { type: "object" };
  }
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (!v || typeof v !== "object") return v;
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "$schema") continue;
      if ((k === "minimum" && x === -SAFE_INT) || (k === "maximum" && x === SAFE_INT)) continue;
      // format: uuid says it; zod's long UUID regex only adds noise.
      if (k === "pattern" && (v as Record<string, unknown>).format === "uuid") continue;
      o[k] = clean(x);
    }
    return o;
  };
  return clean(out) as Record<string, unknown>;
}

const operationId = (method: string, path: string) =>
  method.toLowerCase() +
  path
    .replace(/^\/api\/v1\//, "/")
    .split(/[/-]/)
    .filter(Boolean)
    .map((s) => (s.startsWith(":") ? `By${s[1]!.toUpperCase()}${s.slice(2)}` : s[0]!.toUpperCase() + s.slice(1)))
    .join("");

const ERROR_RESPONSES: Record<string, string> = {
  "400": "The request is not valid; the message says why.",
  "401": "The key is missing, wrong, revoked or expired, or this route needs a dashboard sign-in.",
  "402": "A plan limit was reached.",
  "403": "The key lacks the route's scope, belongs to another workspace, or its creator is no longer a member.",
  "404": "Not found.",
  "429": "The key's requests-per-minute limit (or the per-address limit) was reached. Retry after Retry-After.",
};

export function buildPlatformOpenApi(routes: readonly CollectedRoute[], opts: { serverUrl: string; version: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  const usedTags = new Set<string>();
  const sorted = [...routes].sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  for (const r of sorted) {
    const path = r.url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const section = r.url.replace(/^\/api\/v1\//, "").split("/")[0] ?? "";
    const tag = TAGS[section]?.name ?? "Platform";
    usedTags.add(tag);
    const params = [...r.url.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: m[1] === "n" ? { type: "integer", minimum: 1 } : /^(accountId|id|cid|vid|runId|fid)$/.test(m[1]!) ? { type: "string", format: "uuid" } : { type: "string" },
    }));
    const query = r.doc?.query ? jsonSchemaOf(r.doc.query) : null;
    const queryParams = query && typeof query.properties === "object" && query.properties
      ? Object.entries(query.properties as Record<string, Record<string, unknown>>).map(([name, schema]) => ({
          name,
          in: "query",
          required: Array.isArray(query.required) && (query.required as string[]).includes(name),
          ...(typeof schema.description === "string" ? { description: schema.description } : {}),
          schema,
        }))
      : [];
    const status = String(r.doc?.status ?? 200);
    const scopeText = r.scope === ANY_SCOPE ? "Any valid API key." : `Needs the \`${r.scope}\` scope.`;
    const op: Record<string, unknown> = {
      operationId: operationId(r.method, r.url),
      tags: [tag],
      summary: r.doc?.summary ?? `${r.method} ${path}`,
      description: [r.doc?.description, scopeText].filter(Boolean).join("\n\n"),
      "x-required-scope": r.scope === ANY_SCOPE ? null : r.scope,
      security: [{ apiKey: [] }],
      ...(params.length || queryParams.length ? { parameters: [...params, ...queryParams] } : {}),
      ...(r.doc?.body ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchemaOf(r.doc.body) } } } } : {}),
      responses: {
        [status]: r.doc?.file
          ? { description: r.doc.file, headers: rateHeaders(), content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } }
          : { description: status === "202" ? "Started; poll for the result." : "Success.", headers: rateHeaders(), content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
        ...Object.fromEntries(Object.keys(ERROR_RESPONSES).map((s) => [s, { $ref: `#/components/responses/E${s}` }])),
      },
    };
    (paths[path] ??= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "VhyxVoid platform API",
      version: opts.version,
      description:
        "The dashboard's API, for scripts, CI and editors. Authenticate with an API key: `Authorization: Bearer <keyId>.<secret>`. A key acts in its own workspace, as the member who created it, and each route needs one scope. Each key may make a number of requests per minute (plan limit); every response carries X-RateLimit headers. Generated from the routes the API serves.",
    },
    servers: [{ url: opts.serverUrl }],
    tags: Object.values(TAGS).filter((t) => usedTags.has(t.name)),
    paths,
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", bearerFormat: "keyId.secret", description: "An API key from the dashboard: the key ID, a dot, and the secret." },
      },
      headers: {
        "X-RateLimit-Limit": { description: "The key's requests per minute.", schema: { type: "integer" } },
        "X-RateLimit-Remaining": { description: "Requests left this minute.", schema: { type: "integer" } },
        "X-RateLimit-Reset": { description: "Seconds until the minute ends.", schema: { type: "integer" } },
        "Retry-After": { description: "Seconds to wait before trying again.", schema: { type: "integer" } },
      },
      schemas: {
        Success: {
          type: "object",
          required: ["success", "message", "data"],
          properties: { success: { const: true }, message: { type: "string" }, data: { description: "The result; its shape is in the route's description and the docs." } },
        },
        Error: {
          type: "object",
          required: ["success", "message"],
          properties: { success: { const: false }, message: { type: "string" }, code: { type: "string" }, data: { type: "null" }, requestId: { type: "string" } },
        },
      },
      responses: Object.fromEntries(
        Object.entries(ERROR_RESPONSES).map(([s, description]) => [
          `E${s}`,
          { description, ...(s === "429" ? { headers: { "Retry-After": { $ref: "#/components/headers/Retry-After" } } } : {}), content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        ]),
      ),
    },
  };
}

function rateHeaders() {
  return {
    "X-RateLimit-Limit": { $ref: "#/components/headers/X-RateLimit-Limit" },
    "X-RateLimit-Remaining": { $ref: "#/components/headers/X-RateLimit-Remaining" },
    "X-RateLimit-Reset": { $ref: "#/components/headers/X-RateLimit-Reset" },
  };
}
