// Phase 7, the VS Code extension (packages/vscode): where problems land in a
// spec file, the spec mapping, run report lines, and the built bundle
// registering every command its manifest declares (against a stub vscode).
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import Module from "module";

import { locateChange, locateProblem, looksLikeSpec, problemSegments, reportLines, specRefFor } from "../../packages/vscode/src/editorText";

const yaml = `openapi: 3.0.3
info:
  title: Shop
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        "200":
          description: ok
  /users/{id}:
    get:
      parameters:
        - name: id
          in: path
      responses:
        "404":
          description: missing
    delete:
      responses: {}
components:
  schemas:
    User:
      type: object
`;

describe("locating problems and changes", () => {
  it("splits paths with dots and methods", () => {
    expect(problemSegments("paths./v1.0/users/{id}.get.parameters[0].name")).toEqual(["paths", "/v1.0/users/{id}", "get", "parameters", "name"]);
    expect(problemSegments("info.title")).toEqual(["info", "title"]);
    expect(problemSegments("paths./x")).toEqual(["paths", "/x"]);
  });

  it("finds the line in YAML and JSON, falling back to the deepest match", () => {
    expect(locateProblem(yaml, "info.title")).toBe(2);
    expect(locateProblem(yaml, "paths./users/{id}.get.parameters[0].name")).toBe(13);
    expect(locateProblem(yaml, "paths./users/{id}.delete.operationId")).toBe(18); // no operationId: the operation
    expect(locateChange(yaml, "GET /users/{id}")).toBe(11);
    expect(locateChange(yaml, "DELETE /users/{id} response 204")).toBe(18);
    expect(locateChange(yaml, "components.schemas.User")).toBe(22);
    expect(locateProblem(yaml, "nothing.here")).toBe(0);
    const json = JSON.stringify(JSON.parse('{"openapi":"3.0.3","info":{"title":"S","version":"1"},"paths":{"/a":{"get":{"responses":{}}},"/b":{"get":{}}}}'), null, 2);
    expect(json.split("\n")[locateChange(json, "GET /b")]).toContain('"get"');
    expect(json.split("\n")[locateChange(json, "GET /b")]).not.toBe(json.split("\n")[locateChange(json, "GET /a")]);
  });

  it("maps files to specs and recognises spec files", () => {
    expect(specRefFor({ "api/openapi.yaml": "shop" }, "api\\openapi.yaml")).toBe("shop");
    expect(specRefFor({ "./api/openapi.yaml": " shop " }, "api/openapi.yaml")).toBe("shop");
    expect(specRefFor({ "api/openapi.yaml": "shop" }, "other.yaml")).toBeNull();
    expect(specRefFor(undefined, "x")).toBeNull();
    expect(looksLikeSpec(yaml)).toBe(true);
    expect(looksLikeSpec('{\n  "swagger": "2.0"\n}')).toBe(true);
    expect(looksLikeSpec("name: ci\non: push")).toBe(false);
  });

  it("formats a run report", () => {
    const lines = reportLines({
      collection: "Smoke",
      environment: "Staging",
      durationMs: 1500,
      total: 2,
      passed: 1,
      failed: 1,
      errored: 0,
      skipped: 0,
      results: [
        { name: "List", method: "GET", url: "/a", status: 200, timeMs: 12, outcome: "passed", assertions: [{ pass: true, label: "status equals 200", message: "" }] },
        { name: "Create", method: "POST", url: "/a", status: 500, timeMs: 30, outcome: "failed", assertions: [{ pass: false, label: "status equals 201", message: "got 500" }] },
      ],
    });
    expect(lines).toEqual(["Smoke (Staging)", "", "✓ GET List  200  12 ms", "✗ POST Create  500  30 ms", "    ✗ status equals 201: got 500", "", "1 passed, 1 failed of 2 in 1.5 s"]);
  });
});

describe("the built extension", () => {
  const dist = path.resolve(__dirname, "../../packages/vscode/dist/extension.js");
  it.skipIf(!fs.existsSync(dist))("registers every command in its manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../packages/vscode/package.json"), "utf8"));
    const registered: string[] = [];
    const disposable = { dispose() {} };
    const stub = {
      window: {
        createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
        createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
        showInformationMessage: async () => undefined,
      },
      languages: { createDiagnosticCollection: () => ({ set() {}, delete() {}, dispose() {} }) },
      commands: { registerCommand: (name: string) => (registered.push(name), disposable) },
      workspace: { getConfiguration: () => ({ get: () => undefined }), onDidSaveTextDocument: () => disposable, onDidCloseTextDocument: () => disposable },
      StatusBarAlignment: { Left: 1 },
    };
    const load = (Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown })._load;
    (Module as unknown as { _load: typeof load })._load = (req: string, ...rest: unknown[]) => (req === "vscode" ? stub : load(req, ...rest));
    try {
      delete require.cache[dist];
      const ext = require(dist);
      ext.activate({ subscriptions: [], secrets: { get: async () => undefined }, globalState: { get: () => undefined, update: async () => undefined } });
    } finally {
      (Module as unknown as { _load: typeof load })._load = load;
    }
    expect(registered.sort()).toEqual(manifest.contributes.commands.map((c: { command: string }) => c.command).sort());
  });
});
