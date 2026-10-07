// The API documentation engine (packages/shared/src/apiSpec.ts): Swagger 2
// conversion, validation, the docs model and the version diff.
import { describe, expect, it } from "vitest";

import { changeCounts, convertSwagger2, derefSchema, diffSpecs, normalizeSpec, operationAnchor, specModel, specSlugFrom, starterSpec, validateSpec } from "@vhyxvoid/shared";

type Json = Record<string, any>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("convertSwagger2", () => {
  const swagger: Json = {
    swagger: "2.0",
    info: { title: "Pets", version: "2.1" },
    host: "pets.example.com",
    basePath: "/v2/",
    schemes: ["https"],
    securityDefinitions: { key: { type: "apiKey", name: "X-Key", in: "header" }, basic: { type: "basic" } },
    definitions: { Pet: { type: "object", required: ["name"], properties: { name: { type: "string" }, tag: { type: "string" } } } },
    paths: {
      "/pets/{id}": {
        parameters: [{ name: "id", in: "path", required: true, type: "integer" }],
        get: { summary: "One pet", responses: { 200: { description: "ok", schema: { $ref: "#/definitions/Pet" } } } },
        put: { parameters: [{ name: "body", in: "body", required: true, schema: { $ref: "#/definitions/Pet" } }], responses: { 204: { description: "saved" } } },
      },
      "/upload": { post: { parameters: [{ name: "file", in: "formData", type: "file", required: true }], responses: {} } },
    },
  };

  it("moves servers, schemas, bodies and security to OpenAPI 3", () => {
    const v3 = convertSwagger2(swagger);
    expect(v3.openapi).toBe("3.0.3");
    expect(v3.servers).toEqual([{ url: "https://pets.example.com/v2" }]);
    const item = (v3.paths as Json)["/pets/{id}"];
    expect(item.parameters[0]).toEqual({ name: "id", in: "path", required: true, schema: { type: "integer" } });
    expect(item.get.responses["200"].content["application/json"].schema).toEqual({ $ref: "#/components/schemas/Pet" });
    expect(item.put.requestBody).toEqual({ required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } });
    expect(item.put.parameters).toBeUndefined();
    const upload = (v3.paths as Json)["/upload"].post;
    expect(upload.requestBody.content["multipart/form-data"].schema).toEqual({ type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] });
    expect(upload.responses).toEqual({ default: { description: "Response" } });
    expect((v3.components as Json).securitySchemes).toEqual({ key: { type: "apiKey", name: "X-Key", in: "header" }, basic: { type: "http", scheme: "basic" } });
    expect(validateSpec(v3).filter((p) => p.severity === "error")).toEqual([]);
  });

  it("normalizeSpec passes OpenAPI 3 through and refuses anything else", () => {
    expect(normalizeSpec(swagger).converted).toBe(true);
    const v3 = starterSpec("Shop");
    expect(normalizeSpec(v3)).toEqual({ doc: v3, converted: false });
    expect(() => normalizeSpec({ hello: 1 })).toThrow(/OpenAPI 3/);
  });
});

describe("validateSpec", () => {
  it("accepts the starter document", () => {
    expect(validateSpec(starterSpec("Shop"))).toEqual([]);
  });

  it("finds the problems a reader or generator would hit, with their location", () => {
    const doc: Json = clone(starterSpec("Shop"));
    doc.info.title = "";
    doc.paths["/users/{id}"].get.parameters[0].required = false;
    doc.paths["/users/{id}"].get.responses["600"] = { description: "?" };
    doc.paths["/users"].post.operationId = "listUsers";
    doc.paths["/users"].post.requestBody.content["application/json"].schema = { $ref: "#/components/schemas/Missing" };
    doc.paths["/orders/{orderId}"] = { get: { responses: {} } };
    doc.components.schemas.Bad = { type: "text" };
    const errors = validateSpec(doc).filter((p) => p.severity === "error");
    const at = errors.map((e) => e.path);
    expect(at).toContain("info.title");
    expect(at).toContain("paths./users/{id}.get.parameters[0]");
    expect(at).toContain("paths./users/{id}.get.responses.600");
    expect(at).toContain("paths./users.post.operationId");
    expect(errors.find((e) => e.message.includes("#/components/schemas/Missing"))).toBeTruthy();
    expect(at).toContain("paths./orders/{orderId}.get");
    expect(at).toContain("paths./orders/{orderId}.get.responses");
    expect(at).toContain("components.schemas.Bad.type");
    expect(validateSpec(doc).some((p) => p.severity === "warning" && p.path === "paths./orders/{orderId}.get")).toBe(true);
  });

  it("explains Swagger 2 leftovers and a missing version", () => {
    const problems = validateSpec({ openapi: "2.0", info: { title: "x" }, paths: { "/a": { post: { parameters: [{ name: "b", in: "body" }], responses: { 200: { description: "ok" } } } } } });
    expect(problems.find((p) => p.path === "openapi")?.severity).toBe("error");
    expect(problems.find((p) => p.path === "info.version")).toBeTruthy();
    expect(problems.find((p) => p.message.includes("use requestBody"))).toBeTruthy();
    expect(problems.find((p) => p.path === "servers")?.severity).toBe("warning");
  });
});

describe("specModel", () => {
  const model = specModel(starterSpec("Shop"));

  it("groups operations by tag with anchors, merged parameters and resolved schemas", () => {
    expect(model.title).toBe("Shop");
    expect(model.operationCount).toBe(3);
    expect(model.tags.map((t) => t.name)).toEqual(["Users"]);
    const get = model.tags[0].operations.find((o) => o.id === "get-users-id")!;
    expect(get.method).toBe("GET");
    expect(get.parameters[0]).toMatchObject({ name: "id", in: "path", required: true, example: 42 });
    expect(get.responses.map((r) => r.code)).toEqual(["200", "404"]);
    // The User schema is allOf [NewUser, {id}] — inlined, and an example built from it.
    expect(get.responses[0].contents[0].example).toMatchObject({ id: 42, name: "Ada Lovelace", email: "ada@example.com" });
    expect(get.security).toEqual([["bearer"]]);
    expect(model.securitySchemes[0]).toMatchObject({ name: "bearer", type: "http", scheme: "bearer" });
  });

  it("writes code samples with the server, path example, auth and body", () => {
    const post = model.tags[0].operations.find((o) => o.id === "post-users")!;
    expect(post.samples.curl).toContain("https://api.example.com/v1/users");
    expect(post.samples.curl).toContain("Authorization: Bearer YOUR_TOKEN");
    expect(post.samples.curl).toContain("Ada Lovelace");
    expect(Object.keys(post.samples).sort()).toEqual(["curl", "fetch", "go", "python"]);
    const get = model.tags[0].operations.find((o) => o.id === "get-users-id")!;
    expect(get.samples.fetch).toContain("/v1/users/42");
    expect(specModel(starterSpec("Shop"), { samples: false }).tags[0].operations[0].samples).toEqual({});
  });

  it("puts untagged operations under default and keeps cycles as links", () => {
    const doc: Json = {
      openapi: "3.0.3",
      info: { title: "T", version: "1" },
      paths: { "/": { get: { responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } } } } } } },
      components: { schemas: { Node: { type: "object", properties: { child: { $ref: "#/components/schemas/Node" } } } } },
    };
    const m = specModel(doc);
    expect(m.tags[0].name).toBe("default");
    expect(m.tags[0].operations[0].id).toBe("get-root");
    const schema = derefSchema(doc, { $ref: "#/components/schemas/Node" }) as Json;
    expect(schema.properties.child).toEqual({ $ref: "#/components/schemas/Node", title: "Node" });
  });

  it("anchors and slugs are URL-safe", () => {
    expect(operationAnchor("DELETE", "/teams/{teamId}/members/{id}")).toBe("delete-teams-teamid-members-id");
    expect(specSlugFrom("  Payments API (v2)! ")).toBe("payments-api-v2");
    expect(specSlugFrom("!!!")).toBe("api");
  });
});

describe("diffSpecs", () => {
  const base = starterSpec("Shop") as Json;

  it("no changes for the same document", () => {
    expect(diffSpecs(base, clone(base))).toEqual([]);
  });

  it("marks what breaks clients", () => {
    const next: Json = clone(base);
    delete next.paths["/users/{id}"];
    next.components.schemas.NewUser.required.push("phone");
    next.components.schemas.NewUser.properties.phone = { type: "string" };
    next.paths["/users"].get.parameters.push({ name: "org", in: "query", required: true, schema: { type: "string" } });
    next.paths["/users"].get.parameters[0].schema.type = "string";
    const changes = diffSpecs(base, next);
    const breaking = changes.filter((c) => c.severity === "breaking").map((c) => `${c.location}: ${c.message}`);
    expect(breaking).toContain("GET /users/{id}: operation removed");
    expect(breaking).toContain("POST /users: request: new required field phone");
    expect(breaking).toContain("GET /users: new required query parameter org");
    expect(breaking).toContain("GET /users: query parameter limit: type changed from integer to string");
    // Responses carrying User (allOf NewUser) gain a field — not breaking for readers.
    expect(changes).toContainEqual({ severity: "info", location: "POST /users", message: "response 201: new field phone" });
    expect(changes[0].severity).toBe("breaking");
  });

  it("removed response fields break, new optional things don't", () => {
    const next: Json = clone(base);
    next.info.version = "1.1.0";
    delete next.components.schemas.User.allOf[1].properties.id;
    next.components.schemas.User.allOf[1].required = [];
    next.paths["/users"].get.parameters.push({ name: "q", in: "query", schema: { type: "string" } });
    next.paths["/teams"] = { get: { summary: "Teams", responses: { 200: { description: "ok" } } } };
    next.paths["/users"].post.deprecated = true;
    const changes = diffSpecs(base, next);
    expect(changes).toContainEqual({ severity: "breaking", location: "GET /users/{id}", message: "response 200: id was removed from the response" });
    expect(changes).toContainEqual({ severity: "info", location: "GET /users", message: "new optional query parameter q" });
    expect(changes).toContainEqual({ severity: "info", location: "GET /teams", message: "new operation" });
    expect(changes).toContainEqual({ severity: "warning", location: "POST /users", message: "now deprecated" });
    expect(changes).toContainEqual({ severity: "info", location: "API", message: "version 1.0.0 → 1.1.0" });
  });

  it("enums, auth and renamed path params", () => {
    const a: Json = clone(base);
    a.paths["/users"].get.parameters.push({ name: "sort", in: "query", schema: { type: "string", enum: ["name", "created"] } });
    const b: Json = clone(a);
    b.paths["/users"].get.parameters[1].schema.enum = ["name", "email"];
    b.paths["/users/{userId}"] = b.paths["/users/{id}"];
    delete b.paths["/users/{id}"];
    b.paths["/users/{userId}"].get.parameters[0].name = "userId";
    b.paths["/users/{userId}"].get.security = [];
    const changes = diffSpecs(a, b);
    expect(changes).toContainEqual({ severity: "breaking", location: "GET /users", message: 'query parameter sort: no longer accepts "created"' });
    expect(changes).toContainEqual({ severity: "info", location: "GET /users", message: 'query parameter sort: new value "email"' });
    expect(changes).toContainEqual({ severity: "info", location: "GET /users/{userId}", message: "no longer needs authentication" });
    // Same shape — not removed and re-added.
    expect(changes.some((c) => c.message === "operation removed")).toBe(false);
    const c = changeCounts(changes);
    expect(c.breaking).toBe(1);

    const pub: Json = clone(base);
    delete pub.security;
    expect(diffSpecs(pub, base).filter((x) => x.severity === "breaking").length).toBe(3);
  });
});
