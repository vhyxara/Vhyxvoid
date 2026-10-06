// Hosted mock API engine (packages/shared/src/mockApi.ts): path matching,
// response selection, templating, CORS, validation, OpenAPI import/export.
import { describe, expect, it } from "vitest";

import {
  MOCK_TEMPLATES,
  exportOpenApi,
  importOpenApi,
  matchMockPath,
  mockDefinitionProblem,
  renderTemplate,
  resolveMock,
  sampleFromSchema,
  templateProblem,
  type MockApiDefinition,
  type MockEndpoint,
  type MockRequest,
} from "../../packages/shared/src/mockApi";

const def = (endpoints: MockEndpoint[], extra: Partial<MockApiDefinition> = {}): MockApiDefinition => ({ mode: "ALWAYS", cors: false, latencyMs: 0, endpoints, ...extra });
const req = (method: string, url: string, headers: MockRequest["headers"] = {}, body?: string): MockRequest => ({ method, url, headers, body });
let n = 0;
const endpoint = (method: MockEndpoint["method"], path: string, responses: MockEndpoint["responses"], extra: Partial<MockEndpoint> = {}): MockEndpoint => ({
  id: `e${++n}`,
  enabled: true,
  method,
  path,
  responses,
  ...extra,
});
const r = (status: number, body = "", extra: Partial<MockEndpoint["responses"][number]> = {}) => ({ id: `r${++n}`, status, body, ...extra });
/** Deterministic randomness: a fixed sequence. */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe("path matching", () => {
  it("captures :params and {params}, decodes them, ignores trailing slashes", () => {
    expect(matchMockPath("/users/:id", "/users/42")).toEqual({ id: "42" });
    expect(matchMockPath("/users/{id}/posts/{postId}", "/users/a%20b/posts/7/")).toEqual({ id: "a b", postId: "7" });
    expect(matchMockPath("/users/:id", "/users/42/posts")).toBeNull();
    expect(matchMockPath("/users", "/users/")).toEqual({});
  });
  it("* matches the rest of the path, slashes included", () => {
    expect(matchMockPath("/files/*", "/files/a/b/c.txt")).toEqual({ "*": "a/b/c.txt" });
    expect(matchMockPath("/", "/")).toEqual({});
    expect(matchMockPath("/", "/x")).toBeNull();
  });
  it("treats regex characters in literal segments literally", () => {
    expect(matchMockPath("/v1.0/items", "/v1x0/items")).toBeNull();
    expect(matchMockPath("/v1.0/items", "/v1.0/items")).toEqual({});
  });
});

describe("resolveMock", () => {
  it("first enabled endpoint in order wins; method must match (GET also answers HEAD, with no body)", () => {
    const d = def([
      endpoint("POST", "/a", [r(201, "post")]),
      endpoint("GET", "/a", [r(200, "first")], { enabled: false }),
      endpoint("GET", "/a", [r(200, "second")]),
      endpoint("ANY", "/a", [r(200, "any")]),
    ]);
    expect(resolveMock(d, req("GET", "/a?x=1"))?.body).toBe("second");
    expect(resolveMock(d, req("DELETE", "/a"))?.body).toBe("any");
    const head = resolveMock(d, req("HEAD", "/a"));
    expect(head?.status).toBe(200);
    expect(head?.body).toBe("");
    expect(resolveMock(d, req("GET", "/b"))).toBeNull();
  });

  it("rules pick a response; the default answers when none match", () => {
    const d = def([
      endpoint("GET", "/users/:id", [
        r(404, "missing", { rules: [{ source: "param", key: "id", op: "equals", value: "0" }] }),
        r(403, "admin only", { rules: [{ source: "header", key: "X-Role", op: "not_equals", value: "admin" }, { source: "query", key: "secret", op: "exists" }] }),
        r(200, "found", { isDefault: true }),
      ]),
    ]);
    expect(resolveMock(d, req("GET", "/users/0"))?.status).toBe(404);
    expect(resolveMock(d, req("GET", "/users/5?secret=1"))?.status).toBe(403);
    expect(resolveMock(d, req("GET", "/users/5?secret=1", { "x-role": "admin" }))?.status).toBe(200);
    expect(resolveMock(d, req("GET", "/users/5"))?.status).toBe(200);
  });

  it("rulesMatch any; body rules read JSON paths and form fields; cookie and regex rules", () => {
    const d = def([
      endpoint("POST", "/pay", [
        r(402, "declined", { rules: [{ source: "body", key: "card.number", op: "contains", value: "0002" }, { source: "cookie", key: "test", op: "equals", value: "fail" }], rulesMatch: "any" }),
        r(422, "bad amount", { rules: [{ source: "body", key: "amount", op: "regex", value: "^-" }] }),
        r(200, "ok"),
      ]),
    ]);
    expect(resolveMock(d, req("POST", "/pay", {}, JSON.stringify({ card: { number: "4000000000000002" } })))?.status).toBe(402);
    expect(resolveMock(d, req("POST", "/pay", { cookie: "a=1; test=fail" }, "{}"))?.status).toBe(402);
    expect(resolveMock(d, req("POST", "/pay", { "content-type": "application/x-www-form-urlencoded" }, "amount=-5"))?.status).toBe(422);
    expect(resolveMock(d, req("POST", "/pay", {}, '{"amount": 5}'))?.status).toBe(200);
  });

  it("sequential cycles per endpoint; random uses the random source", () => {
    const sequence = new Map<string, number>();
    const d = def([endpoint("GET", "/flaky", [r(200), r(503)], { selection: "sequential" }), endpoint("GET", "/coin", [r(200), r(500)], { selection: "random" })]);
    expect([1, 2, 3].map(() => resolveMock(d, req("GET", "/flaky"), { sequence })?.status)).toEqual([200, 503, 200]);
    expect(resolveMock(d, req("GET", "/coin"), { random: () => 0.9 })?.status).toBe(500);
    expect(resolveMock(d, req("GET", "/coin"), { random: () => 0.1 })?.status).toBe(200);
  });

  it("adds latency from the API and the response, capped", () => {
    const d = def([endpoint("GET", "/s", [r(200, "", { latencyMs: 250 })])], { latencyMs: 100 });
    expect(resolveMock(d, req("GET", "/s"))?.latencyMs).toBe(350);
  });

  it("guesses a content type when none is set", () => {
    const d = def([endpoint("GET", "/j", [r(200, ' {"a":1}')]), endpoint("GET", "/t", [r(200, "hi")]), endpoint("GET", "/h", [r(200, "<p>", { headers: { "Content-Type": "text/html" } })])]);
    expect(resolveMock(d, req("GET", "/j"))?.headers["content-type"]).toBe("application/json");
    expect(resolveMock(d, req("GET", "/t"))?.headers["content-type"]).toContain("text/plain");
    expect(resolveMock(d, req("GET", "/h"))?.headers["content-type"]).toBe("text/html");
  });

  it("CORS: answers preflights for any path and adds headers to answers", () => {
    const d = def([endpoint("GET", "/a", [r(200, "x")])], { cors: true });
    const pre = resolveMock(d, req("OPTIONS", "/anything", { origin: "https://app.test", "access-control-request-method": "POST", "access-control-request-headers": "content-type" }));
    expect(pre?.status).toBe(204);
    expect(pre?.headers["access-control-allow-origin"]).toBe("https://app.test");
    expect(pre?.headers["access-control-allow-headers"]).toBe("content-type");
    expect(resolveMock(d, req("GET", "/a", { origin: "https://app.test" }))?.headers["access-control-allow-credentials"]).toBe("true");
    // Without CORS a preflight is just an OPTIONS request that matches nothing.
    expect(resolveMock(def([endpoint("GET", "/a", [r(200)])]), req("OPTIONS", "/a", { origin: "x", "access-control-request-method": "GET" }))).toBeNull();
  });
});

describe("templating", () => {
  const ctxFor = (r0: MockRequest, params: Record<string, string> = {}) => {
    const d = def([endpoint("ANY", "/*", [r(200, "", { templating: true, body: "" })])]);
    return { d, r0, params };
  };
  const render = (body: string, request: MockRequest = req("GET", "/x/y"), extra: Partial<Parameters<typeof resolveMock>[2]> = {}) =>
    resolveMock(def([endpoint("ANY", "/:a/*", [r(200, body, { templating: true })])]), request, { random: seq(0), now: () => Date.UTC(2026, 0, 2), ...extra })!.body;

  it("echoes request parts", () => {
    void ctxFor;
    const body = JSON.stringify({ user: { name: "Ada" }, list: [1, 2] });
    const out = render(
      "{{request.method}} {{request.path}} {{request.params.a}} {{request.params.*}} {{request.query.q}} {{request.headers.X-Trace}} {{request.cookies.sid}} {{request.body.user.name}} {{request.body.list.1}} {{json request.body.user}}",
      req("POST", "/users/x/y?q=hi", { "x-trace": "t1", cookie: "sid=s9" }, body),
    );
    expect(out).toBe('POST /users/x/y users x/y hi t1 s9 Ada 2 {"name":"Ada"}');
  });

  it("generators are deterministic with a fixed random source", () => {
    expect(render("{{int 5 5}} {{float 1 1 1}} {{bool}} {{pick 'a' 'b'}} {{firstName}} {{now}} {{timestamp}}")).toBe(`5 1.0 true a Ada 2026-01-02T00:00:00.000Z ${Date.UTC(2026, 0, 2) / 1000}`);
    expect(render("{{uuid}}")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(render("{{email}}")).toBe("ada.lovelace@example.com");
  });

  it("repeat with @index, ranges, nesting, trailing comma dropped", () => {
    expect(render("[{{#repeat 3}}{{@index}},{{/repeat}}]")).toBe("[0,1,2]");
    expect(render("[{{#repeat 2 2}}[{{#repeat 2}}x,{{/repeat}}],{{/repeat}}]")).toBe("[[x,x],[x,x]]");
    expect(JSON.parse(render('{ "items": [{{#repeat 3}}{ "n": {{@index}} },{{/repeat}}] }')).items).toHaveLength(3);
  });

  it("bad templates answer 500 with the reason instead of throwing", () => {
    const res = resolveMock(def([endpoint("GET", "/x", [r(200, "{{nope}}", { templating: true })])]), req("GET", "/x"));
    expect(res?.status).toBe(500);
    expect(JSON.parse(res!.body).error).toContain("Unknown template tag");
  });

  it("output is bounded", () => {
    expect(() => renderTemplate("{{#repeat 1000}}{{#repeat 1000}}xxxxxxxxxx{{/repeat}}{{/repeat}}", { request: {} as never, random: Math.random, now: Date.now }, 1024)).toThrow(/larger than/);
  });

  it("templateProblem finds unknown tags and unbalanced repeats; plain text is untouched without templating", () => {
    expect(templateProblem("{{request.query.a}} {{uuid}}")).toBeNull();
    expect(templateProblem("{{request.secret}}")).toMatch(/Unknown/);
    expect(templateProblem("{{#repeat 2}}x")).toMatch(/not closed/);
    expect(templateProblem("x{{/repeat}}")).toMatch(/without/);
    expect(resolveMock(def([endpoint("GET", "/x", [r(200, "{{uuid}}")])]), req("GET", "/x"))?.body).toBe("{{uuid}}");
  });
});

describe("mockDefinitionProblem", () => {
  const ok = def([endpoint("GET", "/a", [r(200, "x")])]);
  it("accepts a valid definition and every template", () => {
    expect(mockDefinitionProblem(ok, 10)).toBeNull();
    for (const t of MOCK_TEMPLATES) expect(mockDefinitionProblem(def(t.endpoints()), 100), t.key).toBeNull();
  });
  it.each([
    ["mode", { ...ok, mode: "SOMETIMES" }, /mode/],
    ["plan limit", def([endpoint("GET", "/a", [r(200)]), endpoint("GET", "/b", [r(200)])]), /At most 1 endpoints/],
    ["path", def([endpoint("GET", "a b", [r(200)])]), /path must start/],
    ["no responses", def([endpoint("GET", "/a", [])]), /at least one response/],
    ["status", def([endpoint("GET", "/a", [r(99)])]), /status/],
    ["protected header", def([endpoint("GET", "/a", [r(200, "", { headers: { "Content-Length": "1" } })])]), /set by VhyxVoid/],
    ["header injection", def([endpoint("GET", "/a", [r(200, "", { headers: { "x-a": "1\r\nx-b: 2" } })])]), /invalid value/],
    ["two defaults", def([endpoint("GET", "/a", [r(200, "", { isDefault: true }), r(201, "", { isDefault: true })])]), /only one default/],
    ["bad regex", def([endpoint("GET", "/a", [r(200, "", { rules: [{ source: "path", op: "regex", value: "(" }] })])]), /invalid regex/],
    ["rule without key", def([endpoint("GET", "/a", [r(200, "", { rules: [{ source: "query", op: "exists" }] })])]), /needs a name/],
    ["template", def([endpoint("GET", "/a", [r(200, "{{eval}}", { templating: true })])]), /Unknown template tag/],
  ])("refuses %s", (_name, d, re) => {
    expect(mockDefinitionProblem(d, 1)).toMatch(re as RegExp);
  });
});

describe("OpenAPI", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Pets", description: "A pet store" },
    paths: {
      "/pets": {
        get: {
          summary: "List pets",
          responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } } } } } },
        },
        post: { operationId: "createPet", responses: { "201": { $ref: "#/components/responses/Created" }, "400": { description: "bad" } } },
      },
      "/pets/{petId}": {
        get: {
          responses: {
            "404": { description: "missing", content: { "application/json": { example: { error: "nope" } } } },
            "200": { description: "pet", content: { "application/json": { examples: { one: { value: { id: 7, name: "Rex" } } } } } },
          },
        },
      },
    },
    components: {
      schemas: {
        Pet: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, tag: { type: "string", enum: ["dog", "cat"] }, born: { type: "string", format: "date" }, owner: { $ref: "#/components/schemas/Owner" } } },
        Owner: { type: "object", properties: { email: { type: "string", format: "email" }, pets: { type: "array", items: { $ref: "#/components/schemas/Pet" } } } },
      },
      responses: { Created: { description: "created", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } },
    },
  };

  it("imports operations with examples, $refs, schemas and a 2xx default; the result validates", () => {
    const res = importOpenApi(spec);
    expect(res.title).toBe("Pets");
    expect(res.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(["GET /pets", "POST /pets", "GET /pets/{petId}"]);
    const list = JSON.parse(res.endpoints[0].responses[0].body!);
    expect(list[0]).toMatchObject({ id: 1, name: "string", tag: "dog", born: "2026-01-01", owner: { email: "ada@example.com" } });
    expect(res.endpoints[1].name).toBe("createPet");
    expect(res.endpoints[1].responses[0]).toMatchObject({ status: 201, isDefault: true });
    const byId = res.endpoints[2];
    expect(byId.responses[0]).toMatchObject({ status: 200, isDefault: true });
    expect(JSON.parse(byId.responses[0].body!)).toEqual({ id: 7, name: "Rex" });
    expect(mockDefinitionProblem(def(res.endpoints), 100)).toBeNull();
    // Served: path params from the spec's {petId} form.
    expect(resolveMock(def(res.endpoints), req("GET", "/pets/7"))?.status).toBe(200);
  });

  it("recursive schemas stop instead of looping", () => {
    expect(() => sampleFromSchema(spec as never, { $ref: "#/components/schemas/Pet" })).not.toThrow();
  });

  it("imports Swagger 2.0 with basePath; refuses other documents", () => {
    const v2 = { swagger: "2.0", info: { title: "Old" }, basePath: "/v1", paths: { "/ping": { get: { responses: { "200": { description: "ok", schema: { type: "object", properties: { pong: { type: "boolean" } } } } } } } } };
    const res = importOpenApi(v2);
    expect(res.endpoints[0].path).toBe("/v1/ping");
    expect(JSON.parse(res.endpoints[0].responses[0].body!)).toEqual({ pong: true });
    expect(() => importOpenApi({ hello: 1 })).toThrow(/Not an OpenAPI/);
  });

  it("exports a mock as OpenAPI 3 with path params and examples, and that re-imports", () => {
    const d = def([endpoint("GET", "/users/:id", [r(200, '{"id":1}', { headers: { "content-type": "application/json" } }), r(404, '{"e":1}')])]);
    const out = exportOpenApi(d, { title: "Mine", serverUrl: "https://acme--api.vhyxvoid.com" }) as { paths: Record<string, Record<string, { parameters: unknown[]; responses: Record<string, unknown> }>> };
    expect(out.paths["/users/{id}"].get.parameters).toHaveLength(1);
    expect(Object.keys(out.paths["/users/{id}"].get.responses)).toEqual(["200", "404"]);
    const again = importOpenApi(out);
    expect(JSON.parse(again.endpoints[0].responses[0].body!)).toEqual({ id: 1 });
  });
});
