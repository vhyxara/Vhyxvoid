// packages/shared/src/mockResources.ts
//
// Stateful mock resources (internal-tools/shared/api-platform-plan.md, phase 2).
// A resource such as `users` at `/users` gives a mock API a working REST
// collection with no code, like json-server or Mockoon's data buckets:
//
//   GET    /users            list (?field=value filters, ?q= search, ?_sort=&_order=, ?_page=&_limit=)
//   POST   /users            create (id from the body, else next number or a UUID)
//   GET    /users/:id        read
//   PUT    /users/:id        replace (keeps the id)
//   PATCH  /users/:id        merge
//   DELETE /users/:id        delete
//
// Data starts from the resource's seed and lives in a store per mock: Redis at
// the hub (one hash per resource, so writes to different items never lose
// each other), memory in tests and in the `vhyxvoid mock` CLI. Endpoints of
// the mock win over resources, so any route can be overridden by hand.

import { matchMockPath, type MockApiDefinition, type MockAnswer } from "./mockApi";

export interface MockResource {
  id: string;
  /** Shown in the dashboard; also the default path ("users" -> "/users"). */
  name: string;
  /** Collection path, without parameters: "/users", "/api/v1/orders". */
  path: string;
  enabled: boolean;
  /** Field that holds an item's id. Default "id". */
  idField?: string;
  /** Initial items (JSON objects), restored by Reset. */
  seed: Array<Record<string, unknown>>;
}

export const RESOURCE_BOUNDS = {
  resourcesPerMock: 20,
  itemsPerResource: 1000,
  seedItems: 500,
  itemBytes: 64 * 1024,
  seedBytes: 1024 * 1024,
  pageMax: 1000,
  /** Data of a mock nobody wrote to for this long is dropped (reseeded on the next request). */
  idleTtlSeconds: 30 * 86_400,
} as const;

const RESERVED_QUERY = new Set(["_page", "_limit", "_sort", "_order", "page", "limit", "q"]);

// ── Store ─────────────────────────────────────────────────────────────────────

export interface StoredItem {
  seq: number;
  item: Record<string, unknown>;
}

/** Storage for one resource's items. All methods are per (mock, resource). */
export interface MockResourceStore {
  /** Seeds once (first use or after a reset); later calls do nothing. */
  ensureSeeded(key: string, seed: Array<{ id: string; item: Record<string, unknown> }>): Promise<void>;
  all(key: string): Promise<Array<{ id: string } & StoredItem>>;
  get(key: string, id: string): Promise<StoredItem | null>;
  /** Creates only if the id is free; false when it is taken. */
  create(key: string, id: string, item: Record<string, unknown>): Promise<boolean>;
  /** Replaces an existing item (keeps its position); false when it does not exist. */
  update(key: string, id: string, item: Record<string, unknown>): Promise<boolean>;
  remove(key: string, id: string): Promise<boolean>;
  count(key: string): Promise<number>;
  reset(key: string): Promise<void>;
}

/** In-process store: tests, dry runs and the offline CLI. */
export class MemoryResourceStore implements MockResourceStore {
  private readonly data = new Map<string, { seq: number; items: Map<string, StoredItem> }>();

  private bucket(key: string) {
    let b = this.data.get(key);
    if (!b) {
      b = { seq: 0, items: new Map() };
      this.data.set(key, b);
    }
    return b;
  }
  async ensureSeeded(key: string, seed: Array<{ id: string; item: Record<string, unknown> }>) {
    if (this.data.has(key)) return;
    const b = this.bucket(key);
    for (const s of seed) b.items.set(s.id, { seq: ++b.seq, item: structuredClone(s.item) });
  }
  async all(key: string) {
    return [...this.bucket(key).items.entries()].map(([id, v]) => ({ id, ...structuredClone(v) })).sort((a, b) => a.seq - b.seq);
  }
  async get(key: string, id: string) {
    const v = this.bucket(key).items.get(id);
    return v ? structuredClone(v) : null;
  }
  async create(key: string, id: string, item: Record<string, unknown>) {
    const b = this.bucket(key);
    if (b.items.has(id)) return false;
    b.items.set(id, { seq: ++b.seq, item: structuredClone(item) });
    return true;
  }
  async update(key: string, id: string, item: Record<string, unknown>) {
    const b = this.bucket(key);
    const v = b.items.get(id);
    if (!v) return false;
    b.items.set(id, { seq: v.seq, item: structuredClone(item) });
    return true;
  }
  async remove(key: string, id: string) {
    return this.bucket(key).items.delete(id);
  }
  async count(key: string) {
    return this.bucket(key).items.size;
  }
  async reset(key: string) {
    this.data.delete(key);
  }
}

/** The Redis commands the Redis store needs (@upstash/redis or ioredis-like). */
export interface ResourceRedis {
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  hget(key: string, field: string): Promise<unknown>;
  hset(key: string, values: Record<string, string>): Promise<unknown>;
  hsetnx(key: string, field: string, value: string): Promise<number | boolean>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hlen(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  set(key: string, value: string, opts?: { nx?: boolean; ex?: number }): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

/**
 * Redis store: hash `mockdata:v1:<mock>:<resource>` (field = item id, value =
 * {"seq","item"}), counter `…:seq`. The counter doubles as the "seeded" marker,
 * so a resource whose items were all deleted stays empty instead of reseeding.
 */
export class RedisResourceStore implements MockResourceStore {
  constructor(private readonly redis: ResourceRedis) {}

  private seqKey = (key: string) => `${key}:seq`;

  private parse(v: unknown): StoredItem | null {
    if (v === null || v === undefined) return null;
    // @upstash/redis parses JSON values itself; other clients return strings.
    const o = typeof v === "string" ? JSON.parse(v) : v;
    return o && typeof o === "object" && "item" in (o as object) ? (o as StoredItem) : null;
  }

  private async touch(key: string) {
    await Promise.all([this.redis.expire(key, RESOURCE_BOUNDS.idleTtlSeconds), this.redis.expire(this.seqKey(key), RESOURCE_BOUNDS.idleTtlSeconds)]);
  }

  async ensureSeeded(key: string, seed: Array<{ id: string; item: Record<string, unknown> }>) {
    const first = await this.redis.set(this.seqKey(key), String(seed.length), { nx: true, ex: RESOURCE_BOUNDS.idleTtlSeconds });
    if (first !== "OK" && first !== true) return;
    if (seed.length) {
      await this.redis.hset(key, Object.fromEntries(seed.map((s, i) => [s.id, JSON.stringify({ seq: i + 1, item: s.item })])));
      await this.redis.expire(key, RESOURCE_BOUNDS.idleTtlSeconds);
    }
  }
  async all(key: string) {
    const h = (await this.redis.hgetall(key)) ?? {};
    const out: Array<{ id: string } & StoredItem> = [];
    for (const [id, v] of Object.entries(h)) {
      const s = this.parse(v);
      if (s) out.push({ id, ...s });
    }
    return out.sort((a, b) => a.seq - b.seq);
  }
  async get(key: string, id: string) {
    return this.parse(await this.redis.hget(key, id));
  }
  async create(key: string, id: string, item: Record<string, unknown>) {
    const seq = await this.redis.incr(this.seqKey(key));
    const ok = await this.redis.hsetnx(key, id, JSON.stringify({ seq, item }));
    if (ok === 1 || ok === true) await this.touch(key);
    return ok === 1 || ok === true;
  }
  async update(key: string, id: string, item: Record<string, unknown>) {
    const cur = await this.get(key, id);
    if (!cur) return false;
    await this.redis.hset(key, { [id]: JSON.stringify({ seq: cur.seq, item }) });
    await this.touch(key);
    return true;
  }
  async remove(key: string, id: string) {
    const n = await this.redis.hdel(key, id);
    if (n) await this.touch(key);
    return n > 0;
  }
  async count(key: string) {
    return this.redis.hlen(key);
  }
  async reset(key: string) {
    await this.redis.del(key, this.seqKey(key));
  }
}

export const resourceStoreKey = (mockId: string, resourceId: string) => `mockdata:v1:${mockId}:${resourceId}`;

// ── Matching ──────────────────────────────────────────────────────────────────

function normalizePath(p: string) {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** Which resource (and item id) a request is for, without reading the body. */
export function matchResource(resources: readonly MockResource[] | undefined, method: string, url: string): { resource: MockResource; id: string | null } | null {
  if (!resources?.length) return null;
  const m = method.toUpperCase();
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(m)) return null;
  const qi = url.indexOf("?");
  const path = qi === -1 ? url : url.slice(0, qi);
  for (const r of resources) {
    if (!r.enabled) continue;
    const base = normalizePath(r.path);
    if (matchMockPath(base, path)) return ["GET", "HEAD", "POST"].includes(m) ? { resource: r, id: null } : null;
    const one = matchMockPath(`${base}/:__id`, path);
    if (one && m !== "POST") return { resource: r, id: one.__id };
  }
  return null;
}

/** Whether the mock's endpoints or resources answer this request (endpoints first, as served). */
export function resourceHandles(def: Pick<MockApiDefinition, "resources">, req: { method: string; url: string }): boolean {
  return matchResource(def.resources, req.method, req.url) !== null;
}

// ── Serving ───────────────────────────────────────────────────────────────────

const idOf = (r: MockResource) => r.idField || "id";

function seedEntries(r: MockResource) {
  const field = idOf(r);
  return r.seed
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .map((item, i) => ({ id: item[field] !== undefined && item[field] !== null ? String(item[field]) : String(i + 1), item: item[field] === undefined ? { [field]: i + 1, ...item } : item }));
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Omit<MockAnswer, "endpointId" | "responseId" | "latencyMs"> {
  return { status, headers: { "content-type": "application/json", ...extra }, body: body === undefined ? "" : JSON.stringify(body, null, 2) };
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
}

/** Parses a query string into first-value pairs. */
function query(url: string): Record<string, string> {
  const qi = url.indexOf("?");
  const out: Record<string, string> = {};
  if (qi === -1) return out;
  for (const [k, v] of new URLSearchParams(url.slice(qi + 1))) if (!(k in out)) out[k] = v;
  return out;
}

/**
 * Serves a resource request (the caller checked matchResource). Never throws
 * for bad input: answers 400/404/409/422 like a real API would.
 */
export async function resolveResource(
  def: Pick<MockApiDefinition, "resources" | "cors" | "latencyMs"> & { id?: string },
  req: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body?: string },
  store: MockResourceStore,
  opts: { mockId: string; uuid?: () => string },
): Promise<MockAnswer | null> {
  const hit = matchResource(def.resources, req.method, req.url);
  if (!hit) return null;
  const { resource: r, id } = hit;
  const key = resourceStoreKey(opts.mockId, r.id);
  const field = idOf(r);
  const method = req.method.toUpperCase();
  const name = r.name || r.path;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const cors: Record<string, string> = def.cors
    ? { "access-control-allow-origin": origin || "*", ...(origin ? { "access-control-allow-credentials": "true", vary: "Origin" } : {}), "access-control-expose-headers": "x-total-count, location" }
    : {};
  const answer = (a: Omit<MockAnswer, "endpointId" | "responseId" | "latencyMs">, action: string): MockAnswer => ({
    endpointId: `resource:${r.id}`,
    responseId: action,
    latencyMs: Math.max(0, def.latencyMs ?? 0),
    ...a,
    headers: { ...cors, ...a.headers },
    body: method === "HEAD" ? "" : a.body,
  });

  await store.ensureSeeded(key, seedEntries(r));

  const readBody = (): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } => {
    if (!req.body) return { ok: false, error: "The body must be a JSON object" };
    if (req.body.length > RESOURCE_BOUNDS.itemBytes) return { ok: false, error: `An item can be at most ${RESOURCE_BOUNDS.itemBytes / 1024} KB` };
    try {
      const v = JSON.parse(req.body);
      if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "The body must be a JSON object" };
      return { ok: true, value: v };
    } catch {
      return { ok: false, error: "The body is not valid JSON" };
    }
  };

  if (id === null && (method === "GET" || method === "HEAD")) {
    const q = query(req.url);
    let items = (await store.all(key)).map((x) => x.item);
    for (const [k, v] of Object.entries(q)) {
      if (RESERVED_QUERY.has(k)) continue;
      items = items.filter((it) => {
        const val = k.split(".").reduce<unknown>((acc, p) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[p] : undefined), it);
        return val !== undefined && String(val) === v;
      });
    }
    if (q.q) {
      const needle = q.q.toLowerCase();
      items = items.filter((it) => JSON.stringify(it).toLowerCase().includes(needle));
    }
    if (q._sort) {
      const dir = (q._order ?? "asc").toLowerCase() === "desc" ? -1 : 1;
      const sortField = q._sort;
      items = [...items].sort((a, b) => dir * compare(a[sortField], b[sortField]));
    }
    const total = items.length;
    const pageRaw = q._page ?? q.page;
    const limitRaw = q._limit ?? q.limit;
    if (pageRaw !== undefined || limitRaw !== undefined) {
      const limit = Math.min(RESOURCE_BOUNDS.pageMax, Math.max(1, Number(limitRaw) || 10));
      const page = Math.max(1, Number(pageRaw) || 1);
      items = items.slice((page - 1) * limit, page * limit);
    }
    return answer(json(200, items, { "x-total-count": String(total) }), "list");
  }

  if (id === null && method === "POST") {
    const b = readBody();
    if (!b.ok) return answer(json(400, { error: b.error }), "create");
    if ((await store.count(key)) >= RESOURCE_BOUNDS.itemsPerResource)
      return answer(json(422, { error: `${name} is full (${RESOURCE_BOUNDS.itemsPerResource} items). Delete some, or reset it.` }), "create");
    const item = { ...b.value };
    let newId: string;
    if (item[field] !== undefined && item[field] !== null && item[field] !== "") {
      newId = String(item[field]);
      if (!(await store.create(key, newId, item))) return answer(json(409, { error: `${name} ${newId} already exists` }), "create");
    } else {
      const existing = await store.all(key);
      const numeric = existing.length > 0 && existing.every((x) => /^\d+$/.test(x.id));
      let created = false;
      newId = "";
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        newId = numeric || existing.length === 0 ? String(Math.max(0, ...existing.map((x) => Number(x.id) || 0)) + 1 + attempt) : (opts.uuid ?? randomUuid)();
        item[field] = /^\d+$/.test(newId) ? Number(newId) : newId;
        created = await store.create(key, newId, item);
      }
      if (!created) return answer(json(409, { error: "Could not pick a free id; try again" }), "create");
    }
    const path = `${normalizePath(r.path)}/${encodeURIComponent(newId)}`;
    return answer(json(201, item, { location: path }), "create");
  }

  if (id === null) return null;
  const current = await store.get(key, id);

  if (method === "GET" || method === "HEAD") return current ? answer(json(200, current.item), "read") : answer(json(404, { error: `${name} ${id} not found` }), "read");
  if (method === "DELETE") return (await store.remove(key, id)) ? answer({ status: 204, headers: {}, body: "" }, "delete") : answer(json(404, { error: `${name} ${id} not found` }), "delete");

  if (method === "PUT" || method === "PATCH") {
    if (!current) return answer(json(404, { error: `${name} ${id} not found` }), method === "PUT" ? "replace" : "update");
    const b = readBody();
    if (!b.ok) return answer(json(400, { error: b.error }), method === "PUT" ? "replace" : "update");
    const keepId = { [field]: current.item[field] ?? (/^\d+$/.test(id) ? Number(id) : id) };
    const next = method === "PUT" ? { ...b.value, ...keepId } : { ...current.item, ...b.value, ...keepId };
    if (JSON.stringify(next).length > RESOURCE_BOUNDS.itemBytes) return answer(json(400, { error: `An item can be at most ${RESOURCE_BOUNDS.itemBytes / 1024} KB` }), "update");
    await store.update(key, id, next);
    return answer(json(200, next), method === "PUT" ? "replace" : "update");
  }
  return null;
}

function randomUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  return `${h.slice(0, 8).join("")}-${h.slice(8, 12).join("")}-4${h.slice(13, 16).join("")}-a${h.slice(17, 20).join("")}-${h.slice(20).join("")}`;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function resourcesProblem(resources: unknown): string | null {
  if (resources === undefined) return null;
  if (!Array.isArray(resources)) return "resources must be a list";
  if (resources.length > RESOURCE_BOUNDS.resourcesPerMock) return `At most ${RESOURCE_BOUNDS.resourcesPerMock} resources per mock`;
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [i, r] of resources.entries()) {
    const where = `Resource ${i + 1}${r?.name ? ` (${r.name})` : ""}`;
    if (!r || typeof r !== "object") return `${where}: must be an object`;
    if (typeof r.id !== "string" || !r.id || ids.has(r.id)) return `${where}: needs a unique id`;
    ids.add(r.id);
    if (typeof r.name !== "string" || !r.name.trim() || r.name.length > 60) return `${where}: needs a name (up to 60 characters)`;
    if (typeof r.path !== "string" || !/^(\/[A-Za-z0-9._~-]+)+$/.test(r.path) || r.path.length > 200)
      return `${where}: path must look like /users or /api/v1/orders (no parameters, spaces or trailing slash)`;
    if (paths.has(r.path)) return `${where}: another resource already uses ${r.path}`;
    paths.add(r.path);
    if (typeof r.enabled !== "boolean") return `${where}: enabled must be true or false`;
    if (r.idField !== undefined && (typeof r.idField !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(r.idField))) return `${where}: invalid id field`;
    if (!Array.isArray(r.seed)) return `${where}: seed must be a JSON list`;
    if (r.seed.length > RESOURCE_BOUNDS.seedItems) return `${where}: at most ${RESOURCE_BOUNDS.seedItems} seed items`;
    if (r.seed.some((x: unknown) => !x || typeof x !== "object" || Array.isArray(x))) return `${where}: every seed item must be a JSON object`;
    if (JSON.stringify(r.seed).length > RESOURCE_BOUNDS.seedBytes) return `${where}: seed data is over ${RESOURCE_BOUNDS.seedBytes / 1024} KB`;
    const field = r.idField || "id";
    const seen = new Set<string>();
    for (const item of r.seed as Array<Record<string, unknown>>) {
      const v = item[field];
      if (v === undefined) continue;
      if (typeof v !== "string" && typeof v !== "number") return `${where}: seed ids (${field}) must be strings or numbers`;
      if (seen.has(String(v))) return `${where}: seed id ${String(v)} appears twice`;
      seen.add(String(v));
    }
  }
  return null;
}

let rseq = 0;
export function resourceId(): string {
  rseq = (rseq + 1) % 1_000_000;
  return `res_${Date.now().toString(36)}${rseq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A starting resource for the editor's "Add resource". */
export function sampleResource(name = "users"): MockResource {
  const clean = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "items";
  return {
    id: resourceId(),
    name: clean,
    path: `/${clean}`,
    enabled: true,
    idField: "id",
    seed: [
      { id: 1, name: "Ada Lovelace", email: "ada@example.com", role: "admin" },
      { id: 2, name: "Alan Turing", email: "alan@example.com", role: "member" },
      { id: 3, name: "Grace Hopper", email: "grace@example.com", role: "member" },
    ],
  };
}
