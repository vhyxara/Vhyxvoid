// Mock APIs phase 2: stateful resources (memory and Redis stores), record ->
// mock from captures, exports (MSW run for real against a stand-in, Postman,
// Mockoon, native) and imports (round trips, HAR, format detection).
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { MockApiDefinition, MockEndpoint } from "../../packages/shared/src/mockApi";
import {
  detectMockFormat,
  endpointsFromCaptures,
  exportMockoon,
  exportMsw,
  exportNative,
  exportPostman,
  generalizePath,
  importMockDocument,
  isIdSegment,
  toMockoonTemplate,
} from "../../packages/shared/src/mockInterop";
import {
  MemoryResourceStore,
  RedisResourceStore,
  matchResource,
  resolveResource,
  resourcesProblem,
  sampleResource,
  type MockResource,
  type MockResourceStore,
  type ResourceRedis,
} from "../../packages/shared/src/mockResources";

/** Map-backed stand-in with Redis semantics for the commands the store uses. */
class FakeRedis implements ResourceRedis {
  hashes = new Map<string, Map<string, string>>();
  strings = new Map<string, string>();
  async hgetall(k: string) {
    const h = this.hashes.get(k);
    // Like @upstash/redis: values come back parsed.
    return h ? Object.fromEntries([...h].map(([f, v]) => [f, JSON.parse(v)])) : null;
  }
  async hget(k: string, f: string) {
    const v = this.hashes.get(k)?.get(f);
    return v === undefined ? null : JSON.parse(v);
  }
  async hset(k: string, values: Record<string, string>) {
    const h = this.hashes.get(k) ?? new Map();
    for (const [f, v] of Object.entries(values)) h.set(f, v);
    this.hashes.set(k, h);
    return Object.keys(values).length;
  }
  async hsetnx(k: string, f: string, v: string) {
    const h = this.hashes.get(k) ?? new Map();
    if (h.has(f)) return 0;
    h.set(f, v);
    this.hashes.set(k, h);
    return 1;
  }
  async hdel(k: string, ...fs: string[]) {
    const h = this.hashes.get(k);
    let n = 0;
    for (const f of fs) if (h?.delete(f)) n++;
    if (h && h.size === 0) this.hashes.delete(k);
    return n;
  }
  async hlen(k: string) {
    return this.hashes.get(k)?.size ?? 0;
  }
  async incr(k: string) {
    const n = Number(this.strings.get(k) ?? 0) + 1;
    this.strings.set(k, String(n));
    return n;
  }
  async set(k: string, v: string, o?: { nx?: boolean }) {
    if (o?.nx && this.strings.has(k)) return null;
    this.strings.set(k, v);
    return "OK";
  }
  async expire() {
    return 1;
  }
  async del(...ks: string[]) {
    let n = 0;
    for (const k of ks) if (this.hashes.delete(k) || this.strings.delete(k)) n++;
    return n;
  }
}

const users = (): MockResource => ({ ...sampleResource("users"), id: "res_users" });
const def = (resources: MockResource[], endpoints: MockEndpoint[] = []): MockApiDefinition => ({ id: "mock_1", mode: "ALWAYS", cors: false, latencyMs: 0, endpoints, resources });
const send = (store: MockResourceStore, d: MockApiDefinition, method: string, url: string, body?: unknown) =>
  resolveResource(d, { method, url, headers: {}, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }, store, { mockId: "mock_1", uuid: () => "uuid-1" });

describe.each([
  ["memory", () => new MemoryResourceStore()],
  ["redis", () => new RedisResourceStore(new FakeRedis())],
])("resources (%s store)", (_name, makeStore) => {
  it("full CRUD on the seed, with ids, 404s and Location", async () => {
    const store = makeStore();
    const d = def([users()]);
    const list = await send(store, d, "GET", "/users");
    expect(list?.status).toBe(200);
    expect(JSON.parse(list!.body).map((u: { id: number }) => u.id)).toEqual([1, 2, 3]);
    expect(list?.headers["x-total-count"]).toBe("3");

    const created = await send(store, d, "POST", "/users", { name: "Linus" });
    expect(created?.status).toBe(201);
    expect(JSON.parse(created!.body)).toEqual({ name: "Linus", id: 4 });
    expect(created?.headers.location).toBe("/users/4");
    expect((await send(store, d, "POST", "/users", { id: 4, name: "dup" }))?.status).toBe(409);

    expect(JSON.parse((await send(store, d, "GET", "/users/4"))!.body).name).toBe("Linus");
    const patched = await send(store, d, "PATCH", "/users/4", { role: "admin", id: 99 });
    expect(JSON.parse(patched!.body)).toEqual({ name: "Linus", id: 4, role: "admin" });
    const replaced = await send(store, d, "PUT", "/users/4", { name: "Torvalds" });
    expect(JSON.parse(replaced!.body)).toEqual({ name: "Torvalds", id: 4 });

    expect((await send(store, d, "DELETE", "/users/4"))?.status).toBe(204);
    expect((await send(store, d, "DELETE", "/users/4"))?.status).toBe(404);
    expect((await send(store, d, "GET", "/users/4"))?.status).toBe(404);
    expect((await send(store, d, "PATCH", "/users/77", {}))?.status).toBe(404);
  });

  it("filters, search, sort and pages; order of creation is kept", async () => {
    const store = makeStore();
    const d = def([users()]);
    expect(JSON.parse((await send(store, d, "GET", "/users?role=member"))!.body)).toHaveLength(2);
    expect(JSON.parse((await send(store, d, "GET", "/users?q=GRACE"))!.body)[0].name).toBe("Grace Hopper");
    expect(JSON.parse((await send(store, d, "GET", "/users?_sort=name&_order=desc"))!.body)[0].name).toBe("Grace Hopper");
    const page = await send(store, d, "GET", "/users?_page=2&_limit=2");
    expect(JSON.parse(page!.body).map((u: { id: number }) => u.id)).toEqual([3]);
    expect(page?.headers["x-total-count"]).toBe("3");
  });

  it("bad bodies answer 400; emptied resources stay empty; reset reseeds", async () => {
    const store = makeStore();
    const d = def([users()]);
    expect((await send(store, d, "POST", "/users", "not json"))?.status).toBe(400);
    expect((await send(store, d, "POST", "/users", "[1]"))?.status).toBe(400);
    for (const id of [1, 2, 3]) await send(store, d, "DELETE", `/users/${id}`);
    expect(JSON.parse((await send(store, d, "GET", "/users"))!.body)).toEqual([]);
    await store.reset("mockdata:v1:mock_1:res_users");
    expect(JSON.parse((await send(store, d, "GET", "/users"))!.body)).toHaveLength(3);
  });

  it("string ids get a UUID; a custom id field is honoured", async () => {
    const store = makeStore();
    const r: MockResource = { id: "res_o", name: "orders", path: "/api/orders", enabled: true, idField: "orderId", seed: [{ orderId: "a1", total: 5 }] };
    const d = def([r]);
    const created = await send(store, d, "POST", "/api/orders", { total: 9 });
    expect(JSON.parse(created!.body)).toEqual({ total: 9, orderId: "uuid-1" });
    expect(JSON.parse((await send(store, d, "GET", "/api/orders/a1"))!.body).total).toBe(5);
  });
});

describe("resource matching and validation", () => {
  it("matches collection and item routes; POST only on the collection; disabled resources are skipped", () => {
    const r = users();
    expect(matchResource([r], "GET", "/users?x=1")).toMatchObject({ id: null });
    expect(matchResource([r], "GET", "/users/")).toMatchObject({ id: null });
    expect(matchResource([r], "PUT", "/users/7")).toMatchObject({ id: "7" });
    expect(matchResource([r], "POST", "/users/7")).toBeNull();
    expect(matchResource([r], "PUT", "/users")).toBeNull();
    expect(matchResource([r], "GET", "/users/7/posts")).toBeNull();
    expect(matchResource([{ ...r, enabled: false }], "GET", "/users")).toBeNull();
  });
  it("validates resources", () => {
    expect(resourcesProblem([users()])).toBeNull();
    expect(resourcesProblem([{ ...users(), path: "/users/:id" }])).toMatch(/path must look like/);
    expect(resourcesProblem([users(), { ...users(), id: "other" }])).toMatch(/already uses/);
    expect(resourcesProblem([{ ...users(), seed: [{ id: 1 }, { id: 1 }] }])).toMatch(/appears twice/);
    expect(resourcesProblem([{ ...users(), seed: [1] }])).toMatch(/JSON object/);
  });
});

describe("record -> mock", () => {
  it("recognises ids in paths", () => {
    expect(["42", "3f2504e0-4f89-41d3-9a0c-0305e82c3301", "cus_NffrFeUfNV2Hib", "a1b2c3d4e5f6a7b8"].every(isIdSegment)).toBe(true);
    expect(["users", "v1", "me", "search"].some(isIdSegment)).toBe(false);
    expect(generalizePath("/users/42/orders/3f2504e0-4f89-41d3-9a0c-0305e82c3301?x=1")).toEqual({ pattern: "/users/:id/orders/:id2", values: { id: "42", id2: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" } });
  });

  it("groups by method and path, statuses become responses with rules on the seen id", () => {
    const { endpoints } = endpointsFromCaptures([
      { method: "GET", path: "/users/1", status: 200, responseHeaders: { "Content-Type": "application/json", "X-Secret": "s" }, responseBody: '{"id":1}' },
      { method: "GET", path: "/users/2", status: 200, responseBody: '{"id":2}' },
      { method: "GET", path: "/users/99", status: 404, responseBody: '{"error":"nope"}' },
      { method: "GET", path: "/users/me", status: 200, responseBody: '{"me":true}' },
      { method: "TRACE", path: "/x", status: 200 },
    ]);
    expect(endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(["GET /users/me", "GET /users/:id"]);
    const byId = endpoints[1];
    expect(byId.responses.map((r) => r.status)).toEqual([200, 404]);
    expect(byId.responses[0]).toMatchObject({ isDefault: true, body: '{"id":1}', headers: { "content-type": "application/json" } });
    expect(byId.responses[0].headers).not.toHaveProperty("x-secret");
    expect(byId.responses[1].rules).toEqual([{ source: "param", key: "id", op: "equals", value: "99" }]);
  });
});

const sample: MockApiDefinition = {
  id: "m",
  mode: "ALWAYS",
  cors: true,
  latencyMs: 0,
  endpoints: [
    {
      id: "e1",
      name: "Get user",
      enabled: true,
      method: "GET",
      path: "/users/{id}",
      responses: [
        { id: "r404", name: "Missing", status: 404, headers: { "content-type": "application/json" }, body: '{"error":"no"}', rules: [{ source: "param", key: "id", op: "equals", value: "0" }] },
        { id: "r403", name: "Forbidden", status: 403, body: "no", rules: [{ source: "header", key: "x-role", op: "not_equals", value: "admin" }, { source: "query", key: "secret", op: "exists" }] },
        { id: "r200", name: "Found", status: 200, headers: { "content-type": "application/json" }, body: '{"id":1}', isDefault: true },
      ],
    },
    { id: "e2", enabled: true, method: "POST", path: "/login", responses: [{ id: "a", status: 401, body: "bad", rules: [{ source: "body", key: "password", op: "not_equals", value: "secret" }] }, { id: "b", status: 200, body: "ok", isDefault: true }] },
    { id: "e3", enabled: true, method: "GET", path: "/flaky", selection: "sequential", responses: [{ id: "x", status: 200, body: "up" }, { id: "y", status: 503, body: "down" }] },
  ],
  resources: [{ id: "res_p", name: "posts", path: "/posts", enabled: true, idField: "id", seed: [{ id: 1, title: "Hello" }] }],
};

/** Runs the generated MSW module against a minimal stand-in for msw v2. */
async function loadMsw(code: string) {
  const req = createRequire(path.join(__dirname, "../../packages/agent/package.json"));
  const esbuild = req("esbuild") as typeof import("esbuild");
  const { code: js } = await esbuild.transform(code, { loader: "ts", format: "cjs" });
  class HttpResponse {
    constructor(
      public body: string | null,
      public init: { status?: number; headers?: Record<string, string> } = {},
    ) {}
    static json(b: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
      return new HttpResponse(JSON.stringify(b), init);
    }
  }
  const routes: Array<{ method: string; re: RegExp; names: string[]; fn: (ctx: unknown) => unknown }> = [];
  const add = (method: string) => (url: string, fn: (ctx: unknown) => unknown) => {
    const names: string[] = [];
    const re = new RegExp(`^${url.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, n) => (names.push(n), "([^/]+)"))}$`);
    routes.push({ method, re, names, fn });
  };
  const msw = { http: { get: add("GET"), post: add("POST"), put: add("PUT"), patch: add("PATCH"), delete: add("DELETE"), all: add("ANY") }, HttpResponse, delay: async () => {} };
  const mod = { exports: {} as { handlers: unknown[] } };
  new Function("require", "module", "exports", js)((id: string) => (id === "msw" ? msw : req(id)), mod, mod.exports);
  expect(mod.exports.handlers.length).toBeGreaterThan(0);
  return async (method: string, url: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
    const u = new URL(url, "http://local");
    for (const r of routes) {
      if (r.method !== "ANY" && r.method !== method) continue;
      const m = r.re.exec(u.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]]));
      const request = new Request(u, { method, headers: init.headers, body: init.body });
      const res = (await r.fn({ request, params, cookies: {} })) as HttpResponse;
      return { status: res.init.status ?? 200, body: res.body };
    }
    return null;
  };
}

describe("exports", () => {
  it("MSW handlers compile and behave like the mock: rules, body rules, sequence, resource CRUD", async () => {
    const code = exportMsw(sample, { name: "Sample" });
    expect(code).toContain("import { http, HttpResponse, delay } from 'msw'");
    const call = await loadMsw(code);
    expect((await call("GET", "/users/0"))?.status).toBe(404);
    expect((await call("GET", "/users/5?secret=1"))?.status).toBe(403);
    expect((await call("GET", "/users/5?secret=1", { headers: { "x-role": "admin" } }))?.status).toBe(200);
    expect((await call("POST", "/login", { body: '{"password":"nope"}' }))?.status).toBe(401);
    expect((await call("POST", "/login", { body: '{"password":"secret"}' }))?.status).toBe(200);
    expect([(await call("GET", "/flaky"))?.status, (await call("GET", "/flaky"))?.status, (await call("GET", "/flaky"))?.status]).toEqual([200, 503, 200]);
    expect(JSON.parse((await call("GET", "/posts"))!.body!)).toEqual([{ id: 1, title: "Hello" }]);
    expect((await call("POST", "/posts", { body: '{"title":"Two"}' }))?.status).toBe(201);
    expect(JSON.parse((await call("GET", "/posts/2"))!.body!).title).toBe("Two");
    expect((await call("DELETE", "/posts/2"))?.status).toBe(204);
  });

  it("Postman: requests with saved examples; folders for resources; imports back", () => {
    const col = exportPostman(sample, { name: "Sample", baseUrl: "https://acme--api.vhyxvoid.com" }) as { item: Array<{ name: string; request?: { url: { raw: string } }; response?: unknown[]; item?: unknown[] }>; variable: Array<{ value: string }> };
    expect(col.item[0].request!.url.raw).toBe("{{baseUrl}}/users/:id");
    expect(col.item[0].response).toHaveLength(3);
    expect(col.item.at(-1)!.item).toHaveLength(5);
    expect(col.variable[0].value).toBe("https://acme--api.vhyxvoid.com");
    const back = importMockDocument(col);
    expect(back.format).toBe("postman");
    expect(back.endpoints[0]).toMatchObject({ method: "GET", path: "/users/:id" });
    expect(back.endpoints[0].responses[0]).toMatchObject({ status: 200, isDefault: true });
  });

  it("Mockoon: rules, sequence, CRUD bucket and templates survive a round trip", () => {
    const env = exportMockoon(sample, { name: "Sample" }) as { routes: Array<{ type: string; responses: Array<{ rules: unknown[] }> }>; data: unknown[] };
    expect(env.routes.filter((r) => r.type === "crud")).toHaveLength(1);
    expect(env.data).toHaveLength(1);
    const back = importMockDocument(env);
    expect(back.format).toBe("mockoon");
    const get = back.endpoints.find((e) => e.path === "/users/:id")!;
    expect(get.responses.find((r) => r.status === 403)!.rules).toEqual([
      { source: "header", key: "x-role", op: "not_equals", value: "admin" },
      { source: "query", key: "secret", op: "exists" },
    ]);
    expect(back.endpoints.find((e) => e.path === "/flaky")!.selection).toBe("sequential");
    expect(back.resources[0]).toMatchObject({ path: "/posts", seed: [{ id: 1, title: "Hello" }] });
    expect(toMockoonTemplate("{{request.params.id}} {{uuid}} {{#repeat 3}}x{{/repeat}} {{pick 'a' 'b'}}")).toBe("{{urlParam 'id'}} {{faker 'string.uuid'}} {{#repeat 3 comma=true}}x{{/repeat}} {{oneOf (array 'a' 'b')}}");
  });

  it("native export imports back with fresh ids and settings", () => {
    const file = exportNative(sample, { name: "Sample" });
    expect(detectMockFormat(file)).toBe("vhyxvoid");
    const back = importMockDocument(JSON.parse(JSON.stringify(file)));
    expect(back.endpoints).toHaveLength(3);
    expect(back.endpoints[0].id).not.toBe("e1");
    expect(back.resources[0].id).not.toBe("res_p");
    expect(back.settings).toEqual({ mode: "ALWAYS", cors: true, latencyMs: 0 });
  });
});

describe("imports", () => {
  it("HAR entries become endpoints with parameters", () => {
    const har = {
      log: {
        entries: [
          { request: { method: "GET", url: "https://api.example.com/items/12?x=1" }, response: { status: 200, headers: [{ name: "Content-Type", value: "application/json" }], content: { text: '{"id":12}' } } },
          { request: { method: "GET", url: "https://api.example.com/items/13" }, response: { status: 404, headers: [], content: { text: "" } } },
          { request: { method: "GET", url: "https://api.example.com/logo.png" }, response: { status: 200, headers: [], content: { text: "iVBOR", encoding: "base64" } } },
        ],
      },
    };
    const r = importMockDocument(har);
    expect(r.format).toBe("har");
    expect(r.endpoints.map((e) => e.path)).toEqual(["/logo.png", "/items/:id"]);
    expect(r.endpoints[0].responses[0].body).toBe("");
  });

  it("detects formats and refuses unknown documents", () => {
    expect(detectMockFormat({ openapi: "3.1.0" })).toBe("openapi");
    expect(detectMockFormat({ info: { schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [] })).toBe("postman");
    expect(detectMockFormat({ routes: [], lastMigration: 30 })).toBe("mockoon");
    expect(detectMockFormat({ log: { entries: [] } })).toBe("har");
    expect(() => importMockDocument({ hello: 1 })).toThrow(/Not a supported document/);
  });
});
