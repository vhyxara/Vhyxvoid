// `vhyxvoid test <file>` (packages/agent/src/apiTest.ts): a dashboard export
// run against a local server, environments from the file or a JSON file,
// --var and VHYXVOID_VAR_*, folders, JUnit output, and the exit code of the
// built CLI.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";

import { exitCodeOf, loadEnvironment, loadCollection, parseVars, runApiTests } from "../../packages/agent/src/apiTest";
import { newApiRequest, type ApiCollection } from "../../packages/shared/src/apiClient";
import { nativeCollectionFile } from "../../packages/shared/src/apiClientInterop";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vv-apitest-"));
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/login") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ token: `tok-${req.headers["x-key"] ?? "none"}` }));
    }
    res.writeHead(req.url === "/broken" ? 500 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ auth: req.headers.authorization ?? null }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const collection = (): ApiCollection => ({
  name: "CI suite",
  auth: { type: "bearer", token: "{{token}}" },
  variables: [{ key: "base", value: "http://wrong.invalid", enabled: true }],
  folders: [{ id: "f1", name: "Health" }],
  requests: [
    newApiRequest({ id: "q1", name: "Login", method: "POST", url: "{{base}}/login", headers: [{ key: "X-Key", value: "{{apiKey}}", enabled: true }], auth: { type: "none" }, captures: [{ id: "c", enabled: true, variable: "token", source: "json", path: "token" }] }),
    newApiRequest({ id: "q2", name: "Me", url: "{{base}}/me", assertions: [{ id: "a", enabled: true, source: "json", path: "auth", op: "eq", value: "Bearer tok-{{apiKey}}" }] }),
    newApiRequest({ id: "q3", name: "Broken", url: "{{base}}/broken", folderId: "f1", assertions: [{ id: "a", enabled: true, source: "status", op: "eq", value: "200" }] }),
  ],
});

function write(name: string, content: unknown) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify(content));
  return f;
}

describe("vhyxvoid test", () => {
  it("runs an export with its environment, a secret from VHYXVOID_VAR_*, and reports a failure", async () => {
    const file = write("suite.json", nativeCollectionFile(collection(), [{ name: "local", variables: [{ key: "base", value: base, enabled: true }, { key: "apiKey", value: "", enabled: true, secret: true }] }]));
    const lines: string[] = [];
    const report = await runApiTests({ file, env: "local", environ: { VHYXVOID_VAR_apiKey: "K1" }, junit: path.join(dir, "junit.xml") }, (l) => lines.push(l));
    expect(report).toMatchObject({ total: 3, passed: 2, failed: 1, environment: "local" });
    expect(exitCodeOf(report)).toBe(1);
    expect(lines.join("\n")).toContain("✓ POST   Login → 200");
    expect(lines.join("\n")).toContain("✗ GET    Health / Broken → 500");
    expect(lines.join("\n")).toContain("✗ status equals 200: expected 200, got 500");
    expect(fs.readFileSync(path.join(dir, "junit.xml"), "utf8")).toContain('failures="1"');
  });

  it("--folder runs one folder; --var beats VHYXVOID_VAR_; a missing secret is pointed out", async () => {
    const file = write("suite2.json", nativeCollectionFile(collection(), [{ name: "local", variables: [{ key: "base", value: base, enabled: true }, { key: "apiKey", value: "", enabled: true, secret: true }] }]));
    const lines: string[] = [];
    const only = await runApiTests({ file, folder: "health" }, (l) => lines.push(l));
    expect(only.results.map((r) => r.name)).toEqual(["Broken"]);
    expect(lines.join("\n")).toMatch(/No value for apiKey/);
    expect(parseVars(["apiKey=K2", "x=a=b"], { VHYXVOID_VAR_apiKey: "K1" })).toEqual({ apiKey: "K2", x: "a=b" });
    expect(() => parseVars(["oops"])).toThrow(/NAME=value/);
  });

  it("environments from a file: Postman, plain object; readable errors", () => {
    const imported = loadCollection(write("s.json", nativeCollectionFile(collection())));
    expect(loadEnvironment(write("pm.json", { name: "PM", values: [{ key: "base", value: "x", enabled: true }] }), imported)).toEqual({ name: "PM", variables: [{ key: "base", value: "x", enabled: true }] });
    expect(loadEnvironment(write("plain.json", { base: "y" }), imported).variables).toEqual([{ key: "base", value: "y", enabled: true }]);
    expect(() => loadEnvironment("staging", imported)).toThrow(/No environment "staging"/);
    expect(() => loadCollection(path.join(dir, "nope.json"))).toThrow(/Cannot read/);
    fs.writeFileSync(path.join(dir, "y.yaml"), "a: 1");
    expect(() => loadCollection(path.join(dir, "y.yaml"))).toThrow(/is not JSON/);
  });

  it("the built CLI exits 0 when everything passes, 1 on a failure, 2 on a usage error", async () => {
    const cli = path.resolve(__dirname, "../../packages/agent/dist/cli.js");
    if (!fs.existsSync(cli)) return;
    const pass = write("pass.json", nativeCollectionFile({ ...collection(), requests: collection().requests.slice(0, 2) }));
    const fail = write("fail.json", nativeCollectionFile(collection()));
    const run = (args: string[]) => new Promise<{ code: number; out: string }>((resolve) => execFile(process.execPath, [cli, ...args], (err, stdout, stderr) => resolve({ code: err ? ((err as NodeJS.ErrnoException & { code: number }).code as number) : 0, out: stdout + stderr })));
    const ok = await run(["test", pass, "--var", `base=${base}`, "--var", "apiKey=Z"]);
    expect(ok.out).toContain("2 requests: 2 passed");
    expect(ok.code).toBe(0);
    expect((await run(["test", fail, "--var", `base=${base}`, "--var", "apiKey=Z", "-q"])).code).toBe(1);
    const usage = await run(["test", path.join(dir, "missing.json")]);
    expect(usage.code).toBe(2);
    expect(usage.out).toContain("Cannot read the collection");
  });
});
