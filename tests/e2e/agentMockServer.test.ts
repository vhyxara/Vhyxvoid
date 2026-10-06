// `vhyxvoid mock <file>` (packages/agent/src/mockServer.ts): a mock exported
// from the dashboard served locally over real HTTP, resources in memory,
// reload on change, readable errors for bad files.
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Server } from "node:http";

import { loadMockFile, startMockServer } from "../../packages/agent/src/mockServer";
import { exportNative } from "../../packages/shared/src/mockInterop";
import type { MockApiDefinition } from "../../packages/shared/src/mockApi";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vv-mockcli-"));
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

const def: MockApiDefinition = {
  mode: "ALWAYS",
  cors: true,
  latencyMs: 0,
  endpoints: [{ id: "e1", name: "Health", enabled: true, method: "GET", path: "/health", responses: [{ id: "r1", status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' }] }],
  resources: [{ id: "res_t", name: "todos", path: "/todos", enabled: true, seed: [{ id: 1, title: "Write docs", done: false }] }],
};

function write(name: string, content: unknown) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content));
  return f;
}

async function start(file: string) {
  const lines: string[] = [];
  const s = await startMockServer({ file, port: 0, host: "127.0.0.1", log: (l) => lines.push(l) });
  servers.push(s.server);
  const port = (s.server.address() as { port: number }).port;
  const call = (method: string, p: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${port}${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { ...s, call, lines };
}

describe("vhyxvoid mock", () => {
  it("serves endpoints and resources from a dashboard export, logs each request", async () => {
    const m = await start(write("store.json", exportNative(def, { name: "Store" })));
    expect(await (await m.call("GET", "/health")).json()).toEqual({ ok: true });
    const created = await m.call("POST", "/todos", { title: "Ship it" });
    expect(created.status).toBe(201);
    expect(created.headers.get("access-control-allow-origin")).toBe("*");
    expect(await (await m.call("GET", "/todos")).json()).toHaveLength(2);
    const missing = await m.call("GET", "/nope");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-vhyxvoid-error")).toBe("MOCK_NO_ROUTE");
    expect(m.lines[0]).toMatch(/^GET \/health → 200 \(Health\)/);
    expect(m.lines.some((l) => /POST \/todos → 201 \(resource todos create\)/.test(l))).toBe(true);
  });

  it("reloads a changed file; resource data survives when resources are unchanged", async () => {
    const file = write("reload.json", exportNative(def, { name: "R" }));
    const m = await start(file);
    await m.call("POST", "/todos", { title: "Kept" });
    const changed = { ...def, endpoints: [{ ...def.endpoints[0], responses: [{ id: "r1", status: 200, body: "changed" }] }] };
    fs.writeFileSync(file, JSON.stringify(exportNative(changed, { name: "R" })));
    m.reload();
    expect(await (await m.call("GET", "/health")).text()).toBe("changed");
    expect(await (await m.call("GET", "/todos")).json()).toHaveLength(2);
  });

  it("serves OpenAPI JSON too; explains YAML and unknown files", async () => {
    const m = await start(write("api.json", { openapi: "3.0.3", info: { title: "Pets" }, paths: { "/pets": { get: { responses: { "200": { description: "ok", content: { "application/json": { example: [{ name: "Rex" }] } } } } } } } }));
    expect(m.current().format).toBe("openapi");
    expect(await (await m.call("GET", "/pets")).json()).toEqual([{ name: "Rex" }]);
    expect(() => loadMockFile(write("api.yaml", "openapi: 3.0.3\n"))).toThrow(/is not JSON/);
    expect(() => loadMockFile(write("x.json", { hello: 1 }))).toThrow(/Not a supported document/);
    expect(() => loadMockFile(path.join(dir, "missing.json"))).toThrow(/Cannot read/);
  });
});
