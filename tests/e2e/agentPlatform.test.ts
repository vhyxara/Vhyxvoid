// The CLI's platform API commands (packages/agent/src/platform.ts) against a
// fake API: credentials, spec check/push decisions, the PR summary, and runs
// of stored collections.
import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { PlatformClient, PlatformError, UsageError, checkFails, checkMarkdown, checkSpec, credentials, formatCheck, pushCollection, pushSpec, runRemote, writeJobSummary, type SpecCheck } from "../../packages/agent/src/platform";

const KEY = `vhyxvoid_dev_${"a".repeat(32)}`;
const SECRET = "b".repeat(64);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vv-cli-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

type Call = { method: string; url: string; body: any; auth: string };

function fakeApi(routes: Record<string, (body: any) => { status?: number; data?: unknown; message?: string }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: String(init.method), url: u.pathname, body, auth: String((init.headers as Record<string, string>).authorization) });
    const h = routes[key];
    if (!h) return new Response(JSON.stringify({ message: `no route ${key}` }), { status: 404 });
    const r = h(body);
    return new Response(JSON.stringify(r.status && r.status >= 400 ? { message: r.message } : { success: true, data: r.data }), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const A = "acc-1";
const whoami = { "GET /api/v1/platform/whoami": () => ({ data: { accountId: A, workspace: "Acme", keyId: KEY, scopes: ["*"], dashboardUrl: "https://app.test/organizations/acc-1" } }) };
const specs = { "GET /api/v1/specs/acc-1": () => ({ data: { specs: [{ id: "s1", name: "Shop API", slug: "shop", version: 3, latest: { number: 2, version: "1.1.0" } }] } }) };

describe("credentials", () => {
  it("reads keyId.secret from the flag or the environment", () => {
    expect(credentials({ apiKey: `${KEY}.${SECRET}` }, {})).toEqual({ apiUrl: "https://api.vhyxvoid.com/api/v1", token: `${KEY}.${SECRET}` });
    expect(credentials({}, { VHYXVOID_API_KEY: KEY, VHYXVOID_SECRET: SECRET, VHYXVOID_API_URL: "http://localhost:9100/" })).toEqual({ apiUrl: "http://localhost:9100/api/v1", token: `${KEY}.${SECRET}` });
    expect(credentials({ apiUrl: "https://api.x.dev/api/v1" }, { VHYXVOID_API_KEY: `${KEY}.${SECRET}` }).apiUrl).toBe("https://api.x.dev/api/v1");
    expect(() => credentials({}, { VHYXVOID_API_KEY: KEY })).toThrow(UsageError);
    expect(() => credentials({ apiKey: "nope" }, {})).toThrow(/API key is needed/);
  });
});

describe("spec check and push", () => {
  const file = path.join(dir, "openapi.yaml");
  fs.writeFileSync(file, "openapi: 3.0.3\n");
  const preview = (changes: SpecCheck["changes"], problems: SpecCheck["problems"] = []) => () => ({
    data: { problems, changes, counts: { breaking: changes.filter((c) => c.severity === "breaking").length, warning: changes.filter((c) => c.severity === "warning").length, info: changes.filter((c) => c.severity === "info").length }, against: { number: 2, version: "1.1.0" }, converted: false },
  });

  it("checks a file by slug, fails on breaking changes by default, writes a PR summary", async () => {
    const api = fakeApi({ ...whoami, ...specs, "POST /api/v1/specs/acc-1/s1/preview": preview([{ severity: "breaking", location: "GET /users/{id}", message: "operation removed" }, { severity: "info", location: "GET /teams", message: "new operation" }]) });
    const client = new PlatformClient({ apiUrl: "https://api.test/api/v1", token: `${KEY}.${SECRET}` }, api.f);
    const c = await checkSpec(client, file, "shop");
    expect(api.calls.find((x) => x.url.endsWith("/preview"))!.body).toEqual({ text: "openapi: 3.0.3\n" });
    expect(api.calls.every((x) => x.auth === `Bearer ${KEY}.${SECRET}`)).toBe(true);
    expect(checkFails(c, "breaking")).toBe("1 breaking change");
    expect(checkFails(c, "none")).toBeNull();
    expect(formatCheck(c).join("\n")).toContain("✗ GET /users/{id}: operation removed");
    const md = checkMarkdown(c, "breaking", "https://app.test/organizations/acc-1");
    expect(md).toContain("### ❌ Shop API: 1 breaking change");
    expect(md).toContain("| 🔴 breaking | `GET /users/{id}` | operation removed |");
    expect(md).toContain("(https://app.test/organizations/acc-1/api-docs/s1)");
    await expect(checkSpec(client, file, "nope")).rejects.toThrow(/No API spec "nope".*shop/);
  });

  it("errors always fail; warnings only with --fail-on warning", async () => {
    const base: SpecCheck = { spec: { id: "s1", name: "S", slug: "s" }, against: null, problems: [{ path: "info.title", message: "Give the API a title", severity: "error" }], changes: [], counts: { breaking: 0, warning: 1, info: 0 }, converted: false };
    expect(checkFails(base, "none")).toBe("1 error in the document");
    expect(checkFails({ ...base, problems: [] }, "breaking")).toBeNull();
    expect(checkFails({ ...base, problems: [] }, "warning")).toBe("1 warning");
    expect(checkMarkdown({ ...base, problems: [] }, "breaking")).toContain("### ✅ S: no breaking changes");
  });

  it("push saves the draft; publishes only without breaking changes unless allowed", async () => {
    const routes = (changes: SpecCheck["changes"]) => ({
      ...whoami,
      ...specs,
      "PUT /api/v1/specs/acc-1/s1": () => ({ data: {} }),
      "POST /api/v1/specs/acc-1/s1/preview": preview(changes),
      "POST /api/v1/specs/acc-1/s1/publish": () => ({ data: { number: 3, breaking: changes.filter((c) => c.severity === "breaking").length } }),
    });
    const breaking = [{ severity: "breaking" as const, location: "GET /a", message: "operation removed" }];
    let api = fakeApi(routes(breaking));
    let r = await pushSpec(new PlatformClient({ apiUrl: "https://api.test/api/v1", token: "t" }, api.f), file, "s1", { publish: true });
    expect(r.published).toBeNull();
    expect(r.message).toMatch(/did not publish: 1 breaking change.*--allow-breaking/);
    expect(api.calls.find((c) => c.method === "PUT")!.body).toEqual({ text: "openapi: 3.0.3\n", expectedVersion: 3 });
    expect(api.calls.some((c) => c.url.endsWith("/publish"))).toBe(false);
    api = fakeApi(routes(breaking));
    r = await pushSpec(new PlatformClient({ apiUrl: "https://api.test/api/v1", token: "t" }, api.f), file, "s1", { publish: true, allowBreaking: true, notes: "v3" });
    expect(r.published).toEqual({ number: 3, breaking: 1 });
    expect(api.calls.find((c) => c.url.endsWith("/publish"))!.body).toEqual({ notes: "v3" });
    // Nothing changed: the API answers 409, which is not a failure.
    api = fakeApi({ ...routes([]), "POST /api/v1/specs/acc-1/s1/publish": () => ({ status: 409, message: "Nothing changed since version 2" }) });
    r = await pushSpec(new PlatformClient({ apiUrl: "https://api.test/api/v1", token: "t" }, api.f), file, "s1", { publish: true });
    expect(r.message).toBe("Nothing to publish: Nothing changed since version 2");
  });
});

describe("collections", () => {
  const overview = { "GET /api/v1/api-client/acc-1": () => ({ data: { collections: [{ id: "c1", name: "Smoke" }], environments: [{ id: "e1", name: "Staging" }] } }) };

  it("runs a stored collection by name with an environment", async () => {
    const api = fakeApi({ ...whoami, ...overview, "POST /api/v1/api-client/acc-1/collections/c1/run": () => ({ data: { id: "run1", rateLimited: false, report: { total: 1 } } }) });
    const r = await runRemote(new PlatformClient({ apiUrl: "https://api.test/api/v1", token: "t" }, api.f), "smoke", { environment: "staging" });
    expect(r).toMatchObject({ runId: "run1", report: { total: 1 }, url: "https://app.test/organizations/acc-1/api-client/c1" });
    expect(api.calls.at(-1)!.body).toEqual({ environmentId: "e1" });
    await expect(runRemote(new PlatformClient({ apiUrl: "https://api.test/api/v1", token: "t" }, api.f), "Smoke", { environment: "prod" })).rejects.toThrow(/No environment "prod".*"Staging"/);
  });

  it("pushes a collection file through the importer with the current version", async () => {
    const file = path.join(dir, "postman.json");
    fs.writeFileSync(file, "{}");
    const api = fakeApi({
      ...whoami,
      ...overview,
      "POST /api/v1/api-client/acc-1/parse": () => ({ data: { collection: { name: "x", auth: { type: "none" }, variables: [], folders: [{ id: "f" }], requests: [{ id: "q1" }, { id: "q2" }] } } }),
      "GET /api/v1/api-client/acc-1/collections/c1": () => ({ data: { version: 7 } }),
      "PUT /api/v1/api-client/acc-1/collections/c1": () => ({ data: {} }),
    });
    const r = await pushCollection(new PlatformClient({ apiUrl: "https://api.test/api/v1", token: "t" }, api.f), file, "c1");
    expect(r).toMatchObject({ requests: 2, folders: 1 });
    expect(api.calls.at(-1)!.body).toMatchObject({ expectedVersion: 7, requests: [{ id: "q1" }, { id: "q2" }] });
  });

  it("API errors carry the message and status; the job summary is appended in Actions", async () => {
    const api = fakeApi({ "GET /api/v1/platform/whoami": () => ({ status: 403, message: "This API key lacks the scope specs:read" }) });
    const err = await new PlatformClient({ apiUrl: "https://api.test/api/v1", token: "t" }, api.f).whoami().catch((e) => e);
    expect(err).toBeInstanceOf(PlatformError);
    expect(err).toMatchObject({ status: 403, message: "This API key lacks the scope specs:read" });
    const summary = path.join(dir, "summary.md");
    expect(writeJobSummary("# hi", { GITHUB_STEP_SUMMARY: summary })).toBe(true);
    expect(writeJobSummary("# hi", {})).toBe(false);
    expect(fs.readFileSync(summary, "utf8")).toBe("# hi\n");
  });
});
