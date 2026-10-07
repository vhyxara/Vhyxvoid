// The API client engine (packages/shared/src/apiClient.ts, apiClientInterop.ts,
// httpRunner.ts): building requests, variables, auth, checks, captures,
// snippets, imports, collection runs, and sending over real HTTP.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";

import {
  applyCaptures,
  buildRequest,
  codeSnippet,
  evaluateAssertion,
  interpolate,
  makeScope,
  newApiRequest,
  orderedRequests,
  reportToJUnit,
  runCollection,
  selectJsonPath,
  validateJsonSchema,
  variablesUsed,
  apiCollectionProblem,
  type ApiAssertion,
  type ApiCollection,
  type ApiResponse,
} from "../../packages/shared/src/apiClient";
import { collectionFromMock, exportPostmanCollection, importApiCollection, parseCurl, shellWords } from "../../packages/shared/src/apiClientInterop";
import { SendError, sendHttp } from "../../packages/shared/src/httpRunner";

const res = (over: Partial<ApiResponse> = {}): ApiResponse => ({
  status: 200,
  statusText: "OK",
  headers: [["Content-Type", "application/json"], ["X-Request-Id", "abc"]],
  body: JSON.stringify({ items: [{ id: 7, name: "Ada", tags: ["x", "y"] }, { id: 8, name: "Linus" }], total: 2, ok: true }),
  bodyEncoding: "utf8",
  size: 90,
  truncated: false,
  timings: { dns: 1, connect: 2, tls: 3, firstByte: 40, download: 4, total: 50 },
  ...over,
});
const check = (a: Partial<ApiAssertion>, r = res()) => evaluateAssertion({ id: "a", enabled: true, source: "json", op: "eq", ...a } as ApiAssertion, r);

describe("variables", () => {
  it("resolves layers in order, keeps unknown names and lists them, masks secrets", () => {
    const scope = makeScope([[{ key: "host", value: "a.test", enabled: true }], [{ key: "host", value: "b.test", enabled: true }, { key: "token", value: "s3cret", enabled: true, secret: true }], { id: "9" }]);
    const missing = new Set<string>();
    expect(interpolate("https://{{host}}/u/{{ id }}?t={{token}}&x={{nope}}", scope, missing)).toBe("https://b.test/u/9?t=s3cret&x={{nope}}");
    expect([...missing]).toEqual(["nope"]);
    expect(interpolate("{{token}}", { ...scope, mode: "mask" })).toBe("{{token}}");
    expect(interpolate("{{$uuid}}", scope)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(interpolate("{{$timestamp}}", scope))).toBeGreaterThan(1_700_000_000);
  });

  it("lists the variables a request uses", () => {
    const r = newApiRequest({ url: "{{base}}/x", headers: [{ key: "X", value: "{{h}}", enabled: true }], auth: { type: "bearer", token: "{{tok}}" }, body: { type: "json", text: '{"a":"{{$uuid}}"}' } });
    expect(variablesUsed(r).sort()).toEqual(["base", "h", "tok"]);
  });
});

describe("buildRequest", () => {
  const scope = makeScope([{ base: "api.test", token: "T" }]);

  it("adds https://, query params, headers and a JSON body with its content type", () => {
    const b = buildRequest(newApiRequest({ method: "POST", url: "{{base}}/users?x=1", params: [{ key: "page", value: "2", enabled: true }, { key: "off", value: "1", enabled: false }], headers: [{ key: "X-Trace", value: "t", enabled: true }, { key: "Content-Length", value: "5", enabled: true }], body: { type: "json", text: '{"name":"Ada"}' } }), scope);
    expect(b.problems).toEqual([]);
    expect(b.url).toBe("https://api.test/users?x=1&page=2");
    expect(b.headers).toContainEqual(["Content-Type", "application/json"]);
    expect(b.headers.some(([k]) => k === "Content-Length")).toBe(false);
    expect(b.warnings[0]).toMatch(/Content-Length is set by the client/);
    expect(b.body?.toString()).toBe('{"name":"Ada"}');
  });

  it("auth helpers: bearer, basic, API key in query, inherit from the collection, HMAC with a timestamp", () => {
    expect(buildRequest(newApiRequest({ url: "x.test", auth: { type: "bearer", token: "{{token}}" } }), scope).headers).toContainEqual(["Authorization", "Bearer T"]);
    expect(buildRequest(newApiRequest({ url: "x.test", auth: { type: "basic", username: "u", password: "p" } }), scope).headers).toContainEqual(["Authorization", `Basic ${Buffer.from("u:p").toString("base64")}`]);
    expect(buildRequest(newApiRequest({ url: "x.test/a", auth: { type: "apiKey", name: "key", value: "K", in: "query" } }), scope).url).toBe("https://x.test/a?key=K");
    expect(buildRequest(newApiRequest({ url: "x.test", auth: { type: "inherit" } }), scope, { collectionAuth: { type: "apiKey", name: "X-Key", value: "C", in: "header" } }).headers).toContainEqual(["X-Key", "C"]);
    const hm = buildRequest(newApiRequest({ method: "POST", url: "x.test", body: { type: "raw", text: "hello", contentType: "text/plain" }, auth: { type: "hmac", secret: "sh", algorithm: "sha256", encoding: "hex", header: "X-Sig", prefix: "sha256=", timestampHeader: "X-Ts" } }), scope, { now: 1700000000 });
    expect(hm.headers).toContainEqual(["X-Ts", "1700000000"]);
    expect(hm.headers).toContainEqual(["X-Sig", `sha256=${createHmac("sha256", "sh").update("1700000000.hello").digest("hex")}`]);
  });

  it("form, multipart with a file, GraphQL; refuses bad URLs, credentials in the URL and header injection", () => {
    expect(buildRequest(newApiRequest({ method: "POST", url: "x.test", body: { type: "form", fields: [{ key: "a b", value: "c&d", enabled: true }] } }), scope).body?.toString()).toBe("a+b=c%26d");
    const mp = buildRequest(newApiRequest({ method: "POST", url: "x.test", body: { type: "multipart", fields: [{ key: "note", value: "hi", enabled: true }, { key: "doc", value: "", enabled: true, file: { name: "a.txt", contentType: "text/plain", base64: Buffer.from("FILE").toString("base64") } }] } }), scope);
    const ct = mp.headers.find(([k]) => k === "Content-Type")![1];
    expect(ct).toMatch(/^multipart\/form-data; boundary=/);
    expect(mp.body!.toString()).toContain('name="doc"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nFILE');
    expect(JSON.parse(buildRequest(newApiRequest({ method: "POST", url: "x.test", body: { type: "graphql", query: "{ me { id } }", variables: '{"a":1}' } }), scope).body!.toString())).toEqual({ query: "{ me { id } }", variables: { a: 1 } });
    expect(buildRequest(newApiRequest({ url: "" }), scope).problems).toEqual(["Enter a URL"]);
    expect(buildRequest(newApiRequest({ url: "{{nope}}/x" }), scope).problems).toEqual(["Define {{nope}} (in the collection or the environment) before sending"]);
    expect(buildRequest(newApiRequest({ url: "x.test", headers: [{ key: "X", value: "{{later}}", enabled: true }] }), scope).warnings).toEqual(["Not defined, sent as written: {{later}}"]);
    expect(buildRequest(newApiRequest({ url: "ftp://x.test" }), scope).problems[0]).toMatch(/Only http/);
    expect(buildRequest(newApiRequest({ url: "https://u:p@x.test" }), scope).problems[0]).toMatch(/credentials/);
    expect(buildRequest(newApiRequest({ url: "x.test", headers: [{ key: "X", value: "a\r\nEvil: 1", enabled: true }] }), scope).problems[0]).toMatch(/line break/);
    expect(buildRequest(newApiRequest({ url: "x.test", headers: [{ key: "Bad Name", value: "1", enabled: true }] }), scope).problems[0]).toMatch(/not a valid header name/);
  });
});

describe("JSON path, schema, checks, captures", () => {
  it("selects with $, dots, brackets, negative indexes, [*] and length", () => {
    const doc = { a: { "b c": [1, 2, 3] }, items: [{ id: 1 }, { id: 2 }] };
    expect(selectJsonPath(doc, '$.a["b c"][-1]').value).toBe(3);
    expect(selectJsonPath(doc, "items[*].id").value).toEqual([1, 2]);
    expect(selectJsonPath(doc, "items.length").value).toBe(2);
    expect(selectJsonPath(doc, "a.0").found).toBe(false);
    expect(selectJsonPath(doc, "$").value).toBe(doc);
  });

  it("validates the JSON schema features people use", () => {
    const schema = { type: "object", required: ["id", "email"], additionalProperties: false, properties: { id: { type: "integer", minimum: 1 }, email: { type: "string", format: "email" }, tags: { type: "array", items: { enum: ["a", "b"] }, uniqueItems: true }, kind: { $ref: "#/$defs/kind" } }, $defs: { kind: { anyOf: [{ const: "x" }, { const: "y" }] } } };
    expect(validateJsonSchema({ id: 1, email: "a@b.co", tags: ["a"], kind: "x" }, schema)).toEqual([]);
    const errs = validateJsonSchema({ id: 0, email: "nope", tags: ["a", "a", "c"], kind: "z", extra: 1 }, schema);
    expect(errs).toEqual(expect.arrayContaining(["$.id: 0 is below the minimum 1", "$.email: not a valid email", "$.tags: items are not unique", '$.tags[2]: must be one of ["a","b"]', "$.kind: matches none of anyOf", '$: unexpected property "extra"']));
    expect(validateJsonSchema({}, { type: "object", required: ["id"] })).toEqual(['$: missing required property "id"']);
    expect(validateJsonSchema(5, { oneOf: [{ type: "integer" }, { type: "number" }] })[0]).toMatch(/matches 2 of oneOf/);
  });

  it("checks status, headers, JSON, body, time and size with each operator", () => {
    expect(check({ source: "status", op: "eq", value: "200" }).pass).toBe(true);
    expect(check({ source: "status", op: "eq", value: "201" }).message).toBe("expected 201, got 200");
    expect(check({ source: "header", path: "x-request-id", op: "eq", value: "abc" }).pass).toBe(true);
    expect(check({ source: "header", path: "x-missing", op: "notExists" }).pass).toBe(true);
    expect(check({ path: "$.total", value: "2" }).pass).toBe(true);
    expect(check({ path: "items[0].name", value: "Ada" }).pass).toBe(true);
    expect(check({ path: "items[0].tags", value: '["x","y"]' }).pass).toBe(true);
    expect(check({ path: "items[0].tags", op: "contains", value: "y" }).pass).toBe(true);
    expect(check({ path: "items[*].id", op: "contains", value: "8" }).pass).toBe(true);
    expect(check({ path: "ok", value: "true" }).pass).toBe(true);
    expect(check({ path: "items.length", op: "gte", value: "2" }).pass).toBe(true);
    expect(check({ path: "items[0].name", op: "matches", value: "^A" }).pass).toBe(true);
    expect(check({ path: "items", op: "type", value: "array" }).pass).toBe(true);
    expect(check({ path: "nope", op: "exists" }).pass).toBe(false);
    expect(check({ path: "items[0]", op: "schema", value: '{"type":"object","required":["id"]}' }).pass).toBe(true);
    expect(check({ source: "time", op: "lt", value: "100" }).pass).toBe(true);
    expect(check({ source: "time", op: "lt", value: "10" }).message).toBe("got 50");
    expect(check({ source: "body", op: "contains", value: "Linus" }).pass).toBe(true);
    expect(check({ source: "size", op: "lte", value: "100" }).pass).toBe(true);
    expect(check({ path: "x" }, res({ body: "<html>" })).message).toBe("the body is not JSON");
    expect(check({ source: "status", op: "eq", value: "{{want}}" }).pass).toBe(false);
    expect(evaluateAssertion({ id: "a", enabled: true, source: "status", op: "eq", value: "{{want}}" }, res(), makeScope([{ want: "200" }])).pass).toBe(true);
  });

  it("captures JSON values, headers, status and regex groups from the body", () => {
    const out = applyCaptures(
      [
        { id: "1", enabled: true, variable: "id", source: "json", path: "items[1].id" },
        { id: "2", enabled: true, variable: "rid", source: "header", path: "X-Request-ID" },
        { id: "3", enabled: true, variable: "code", source: "status" },
        { id: "4", enabled: true, variable: "who", source: "body", path: '"name":"(\\w+)"' },
        { id: "5", enabled: true, variable: "gone", source: "json", path: "nope" },
      ],
      res(),
    );
    expect(out.map((c) => c.value)).toEqual(["8", "abc", "200", "Ada", undefined]);
    expect(out[4]).toMatchObject({ ok: false, message: "nothing at nope" });
  });
});

describe("snippets", () => {
  const req = newApiRequest({ method: "POST", url: "https://api.test/users", headers: [{ key: "X-A", value: "it's", enabled: true }], auth: { type: "bearer", token: "{{token}}" }, body: { type: "json", text: '{"name":"Ada"}' } });
  const built = buildRequest(req, makeScope([[{ key: "token", value: "SECRET", enabled: true, secret: true }]], "mask"));

  it("never contains a secret's value and quotes properly", () => {
    for (const lang of ["curl", "fetch", "axios", "python", "go"] as const) {
      const s = codeSnippet(built, lang, req);
      expect(s).not.toContain("SECRET");
      expect(s).toContain("{{token}}");
      expect(s).toContain("api.test/users");
    }
    expect(codeSnippet(built, "curl", req)).toContain(`-H 'X-A: it'\\''s'`);
    expect(codeSnippet(built, "fetch", req)).toContain('body: JSON.stringify({\n    "name": "Ada"\n  })');
    expect(codeSnippet(built, "go", req)).toContain('req.Header.Set(`Authorization`, `Bearer {{token}}`)');
  });

  it("writes multipart forms the way each language does", () => {
    const mp = newApiRequest({ method: "POST", url: "https://x.test/up", body: { type: "multipart", fields: [{ key: "f", value: "", enabled: true, file: { name: "a.png", contentType: "image/png", base64: "AA==" } }, { key: "n", value: "1", enabled: true }] } });
    const b = buildRequest(mp, makeScope([]));
    expect(codeSnippet(b, "curl", mp)).toContain("-F 'f=@a.png'");
    expect(codeSnippet(b, "python", mp)).toContain('"f": open("a.png", "rb")');
    expect(codeSnippet(b, "curl", mp)).not.toContain("boundary");
  });
});

describe("imports", () => {
  it("splits shell words like sh", () => {
    expect(shellWords(`curl -H 'a: b' "x\\"y" $'l\\n2' plain\\ word \\\n  end`)).toEqual(["curl", "-H", "a: b", 'x"y', "l\n2", "plain word", "end"]);
  });

  it("reads curl commands from dev tools and docs", () => {
    const c = parseCurl(`curl 'https://api.test/v1/items?limit=5' -X POST -H 'Authorization: Bearer abc' -H 'content-type: application/json' --data-raw '{"a":1}' --compressed`);
    expect(c.request).toMatchObject({ method: "POST", url: "https://api.test/v1/items", params: [{ key: "limit", value: "5", enabled: true }], auth: { type: "bearer", token: "abc" }, body: { type: "json", text: '{\n  "a": 1\n}' } });
    expect(c.request.headers).toEqual([]);
    expect(parseCurl("curl -u ada:pw https://x.test -d a=1 -d b=2").request).toMatchObject({ method: "POST", auth: { type: "basic", username: "ada", password: "pw" }, body: { type: "form", fields: [{ key: "a", value: "1" }, { key: "b", value: "2" }] } });
    expect(parseCurl("curl -G https://x.test/s --data-urlencode 'q=a b'").request).toMatchObject({ method: "GET", params: [{ key: "q", value: "a b" }] });
    expect(parseCurl("curl -F file=@pic.png -F name=x https://x.test/up").request.body).toMatchObject({ type: "multipart", fields: [{ key: "file", file: { name: "pic.png" } }, { key: "name", value: "x" }] });
    expect(() => parseCurl("wget x")).toThrow(/starts with "curl"/);
  });

  it("Postman collections in (folders, auth, bodies, :params, status tests) and back out", () => {
    const pm = {
      info: { name: "Shop", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      auth: { type: "bearer", bearer: [{ key: "token", value: "{{tok}}" }] },
      variable: [{ key: "base", value: "https://shop.test" }],
      item: [
        { name: "Orders", item: [{ name: "Get order", request: { method: "GET", url: { raw: "{{base}}/orders/:id?full=1", query: [{ key: "full", value: "1" }] } }, event: [{ listen: "test", script: { exec: ["pm.test('ok', function () { pm.response.to.have.status(200); });"] } }] }] },
        { name: "Login", request: { method: "POST", header: [{ key: "Content-Type", value: "application/json" }], body: { mode: "raw", raw: '{"u":1}', options: { raw: { language: "json" } } }, url: "{{base}}/login", auth: { type: "noauth" } } },
      ],
    };
    const imp = importApiCollection(pm);
    expect(imp.format).toBe("postman");
    expect(imp.collection.auth).toEqual({ type: "bearer", token: "{{tok}}" });
    expect(imp.collection.folders).toHaveLength(1);
    const [get, login] = imp.collection.requests;
    expect(get).toMatchObject({ url: "{{base}}/orders/{{id}}", params: [{ key: "full", value: "1" }], folderId: imp.collection.folders[0].id, auth: { type: "inherit" }, assertions: [{ source: "status", op: "eq", value: "200" }] });
    expect(login).toMatchObject({ auth: { type: "none" }, body: { type: "json", text: '{"u":1}' }, headers: [] });
    expect(apiCollectionProblem(imp.collection, 100)).toBeNull();
    const out = exportPostmanCollection(imp.collection) as { item: { name: string; item?: { event?: { script: { exec: string[] } }[] }[] }[] };
    expect(out.item[0].name).toBe("Orders");
    expect(out.item[0].item![0].event![0].script.exec[0]).toContain("pm.response.to.have.status(200)");
    expect(importApiCollection(out).collection.requests).toHaveLength(2);
  });

  it("OpenAPI: one request per operation, {{baseUrl}}, tags as folders, auth, example bodies, status checks", () => {
    const imp = importApiCollection({
      openapi: "3.0.3",
      info: { title: "Pets" },
      servers: [{ url: "https://{env}.pets.test/v1", variables: { env: { default: "api" } } }],
      components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } }, schemas: { Pet: { type: "object", required: ["name"], properties: { name: { type: "string", example: "Rex" } } } } },
      paths: {
        "/pets/{petId}": { get: { tags: ["pets"], summary: "Get a pet", parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } } } },
        "/pets": { post: { tags: ["pets"], requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } }, responses: { "201": { description: "made" } } } },
      },
    });
    const c = imp.collection;
    expect(c.variables).toEqual(expect.arrayContaining([{ key: "baseUrl", value: "https://api.pets.test/v1", enabled: true }, { key: "apiKey", value: "", enabled: true, secret: true }, { key: "petId", value: "1", enabled: true }]));
    expect(c.auth).toEqual({ type: "apiKey", name: "X-Key", value: "{{apiKey}}", in: "header" });
    expect(c.folders.map((f) => f.name)).toEqual(["pets"]);
    expect(c.requests[0]).toMatchObject({ name: "Get a pet", url: "{{baseUrl}}/pets/{{petId}}", assertions: [{ op: "eq", value: "200" }, { op: "schema", enabled: false }] });
    expect(JSON.parse(c.requests[1].body.type === "json" ? c.requests[1].body.text : "")).toEqual({ name: "Rex" });
  });

  it("a mock becomes a test collection; resources get a create/get/delete flow with a capture", () => {
    const col = collectionFromMock(
      { mode: "ALWAYS", cors: true, latencyMs: 0, endpoints: [{ id: "e", name: "User", enabled: true, method: "GET", path: "/users/:id", responses: [{ id: "r", status: 200, headers: {}, body: "{}", isDefault: true }] }], resources: [{ id: "t", name: "todos", path: "/todos", enabled: true, seed: [{ id: 1, title: "x" }] }] },
      { name: "Store", baseUrl: "https://store.vv.test/" },
    );
    expect(col.variables).toEqual([{ key: "baseUrl", value: "https://store.vv.test", enabled: true }, { key: "id", value: "1", enabled: true }]);
    expect(col.requests.map((r) => `${r.method} ${r.url}`)).toEqual(["GET {{baseUrl}}/users/{{id}}", "GET {{baseUrl}}/todos", "POST {{baseUrl}}/todos", "GET {{baseUrl}}/todos/{{todosId}}", "DELETE {{baseUrl}}/todos/{{todosId}}"]);
    expect(col.requests[2].captures[0]).toMatchObject({ variable: "todosId", path: "$.id" });
    expect(apiCollectionProblem(col, 100)).toBeNull();
  });

  it("refuses unknown documents with a readable message", () => {
    expect(() => importApiCollection({ hello: 1 })).toThrow(/Not a supported document/);
  });
});

describe("runCollection", () => {
  const col: ApiCollection = {
    name: "Flow",
    auth: { type: "bearer", token: "{{token}}" },
    variables: [{ key: "base", value: "https://x.test", enabled: true }],
    folders: [{ id: "f1", name: "Users" }, { id: "f2", name: "Nested", parentId: "f1" }],
    requests: [
      newApiRequest({ id: "q3", name: "Nested one", url: "{{base}}/n", folderId: "f2", assertions: [{ id: "a", enabled: true, source: "status", op: "eq", value: "200" }] }),
      newApiRequest({ id: "q1", name: "Login", method: "POST", url: "{{base}}/login", captures: [{ id: "c", enabled: true, variable: "uid", source: "json", path: "id" }] }),
      newApiRequest({ id: "q2", name: "Me", url: "{{base}}/users/{{uid}}", folderId: "f1", assertions: [{ id: "a", enabled: true, source: "json", path: "id", op: "eq", value: "{{uid}}" }, { id: "b", enabled: true, source: "status", op: "eq", value: "201" }] }),
    ],
  };
  const sent: string[] = [];
  const send = async (b: ReturnType<typeof buildRequest>) => {
    sent.push(`${b.method} ${b.url} ${b.headers.find(([k]) => k === "Authorization")?.[1]}`);
    return res({ body: JSON.stringify({ id: 42 }) });
  };

  it("runs depth first, chains captures, uses the environment, reports and writes JUnit", async () => {
    expect(orderedRequests(col).map((r) => r.id)).toEqual(["q1", "q2", "q3"]);
    const report = await runCollection({ collection: col, environment: [{ key: "token", value: "TK", enabled: true, secret: true }], environmentName: "staging", send });
    expect(sent).toEqual(["POST https://x.test/login Bearer TK", "GET https://x.test/users/42 Bearer TK", "GET https://x.test/n Bearer TK"]);
    expect(report).toMatchObject({ total: 3, passed: 2, failed: 1, errored: 0, assertions: { passed: 2, failed: 1 }, environment: "staging" });
    expect(report.results[1]).toMatchObject({ outcome: "failed", folder: ["Users"], url: "{{base}}/users/{{uid}}".replace("{{base}}", "https://x.test").replace("{{uid}}", "42") });
    expect(report.results[2].folder).toEqual(["Users", "Nested"]);
    const junit = reportToJUnit(report);
    expect(junit).toContain('<testsuite name="Flow" tests="3" failures="1" errors="0"');
    expect(junit).toContain('<failure message="status equals 201">');
  });

  it("bails, skips the rest; a send error is an error; a folder runs alone", async () => {
    const report = await runCollection({ collection: col, send: async () => Promise.reject(new SendError("refused", "ECONNREFUSED")), bail: true });
    expect(report.results.map((r) => r.outcome)).toEqual(["errored", "skipped", "skipped"]);
    const folder = await runCollection({ collection: col, send, folderId: "f1" });
    expect(folder.results.map((r) => r.requestId)).toEqual(["q2", "q3"]);
    const limited = await runCollection({ collection: col, send, beforeEach: (r) => (r.id === "q2" ? "Rate limited" : null) });
    expect(limited.results.map((r) => r.outcome)).toEqual(["passed", "skipped", "skipped"]);
  });

  it("validates collections: folders, cycles, ids, plan size", () => {
    expect(apiCollectionProblem(col, 2)).toMatch(/At most 2 requests/);
    expect(apiCollectionProblem({ ...col, folders: [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }], requests: [] }, 10)).toMatch(/circular/);
    expect(apiCollectionProblem({ ...col, requests: [col.requests[0], col.requests[0]] }, 10)).toMatch(/used twice/);
    expect(apiCollectionProblem({ ...col, variables: [{ key: "1bad", value: "", enabled: true }] }, 10)).toMatch(/not a variable name/);
  });
});

describe("sendHttp", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.url === "/gzip") {
          res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
          return res.end(zlib.gzipSync(JSON.stringify({ zipped: true })));
        }
        if (req.url === "/big") {
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end("x".repeat(10_000));
        }
        if (req.url === "/bin") {
          res.writeHead(200, { "content-type": "image/png" });
          return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
        }
        if (req.url === "/redirect") {
          res.writeHead(302, { location: "/echo" });
          return res.end();
        }
        if (req.url === "/slow") return setTimeout(() => res.end("late"), 500);
        res.writeHead(201, { "content-type": "application/json", "x-a": "1" });
        res.end(JSON.stringify({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString(), ua: req.headers["user-agent"], ct: req.headers["content-type"] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const built = (path: string, over: Partial<ReturnType<typeof buildRequest>> = {}) => ({ ...buildRequest(newApiRequest({ url: base + path }), makeScope([])), ...over });

  it("sends, measures, and returns headers and a text body", async () => {
    const b = buildRequest(newApiRequest({ method: "POST", url: `${base}/echo`, body: { type: "json", text: '{"a":1}' } }), makeScope([]));
    const r = await sendHttp(b);
    expect(r.status).toBe(201);
    expect(JSON.parse(r.body)).toMatchObject({ method: "POST", body: '{"a":1}', ua: "VhyxVoid-API-Client/1", ct: "application/json" });
    expect(r.headers).toContainEqual(["x-a", "1"]);
    expect(r.timings.total).toBeGreaterThan(0);
    expect(r.timings.connect).toBeGreaterThanOrEqual(0);
    expect(r.remoteAddress).toBe("127.0.0.1");
  });

  it("decompresses, cuts large bodies, base64s binary, follows redirects only when asked, times out", async () => {
    expect(JSON.parse((await sendHttp(built("/gzip"))).body)).toEqual({ zipped: true });
    const big = await sendHttp(built("/big"), { maxBytes: 1000 });
    expect(big).toMatchObject({ size: 1000, truncated: true });
    const bin = await sendHttp(built("/bin"));
    expect(bin.bodyEncoding).toBe("base64");
    expect(Buffer.from(bin.body, "base64")[0]).toBe(0x89);
    expect((await sendHttp(built("/redirect"))).status).toBe(302);
    const followed = await sendHttp(built("/redirect"), { followRedirects: 3 });
    expect(followed.status).toBe(201);
    expect(followed.redirects).toEqual([`${base}/redirect`]);
    await expect(sendHttp(built("/slow"), { timeoutMs: 100 })).rejects.toMatchObject({ code: "ETIMEDOUT" });
  });

  it("refuses through checkUrl and a guarded lookup; explains connection errors", async () => {
    await expect(sendHttp(built("/echo"), { checkUrl: () => "That address is private" })).rejects.toMatchObject({ code: "EPRIVATE" });
    const lookup = (_h: string, _o: unknown, cb: (e: NodeJS.ErrnoException | null, a: string, f?: number) => void) => cb(Object.assign(new Error("private"), { code: "EPRIVATE" }), "", 0);
    await expect(sendHttp({ ...built("/echo"), url: "http://localhost.test:1/" }, { lookup })).rejects.toThrow(/public addresses only/);
    await expect(sendHttp({ ...built("/echo"), url: "http://127.0.0.1:1/" })).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});
