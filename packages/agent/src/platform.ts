// packages/agent/src/platform.ts
//
// The CLI's platform API commands (internal-tools/shared/api-platform-plan.md,
// phase 7), for CI and scripts. They call the API with an API key
// (Authorization: Bearer <keyId>.<secret>):
//
//   vhyxvoid spec check <file> --spec <slug|id>   problems and changes vs the latest published version;
//                                                exit 1 on errors or breaking changes (--fail-on)
//   vhyxvoid spec push <file> --spec <slug|id>    save the draft, optionally --publish
//   vhyxvoid test --collection <name|id>          run a collection stored in the workspace
//   vhyxvoid collection push <file> --collection  replace a stored collection from a file
//
// A Markdown summary goes to $GITHUB_STEP_SUMMARY when it is set (GitHub
// Actions), and to --markdown <file> for a PR comment.

import * as fs from "fs";

import { exportNative, type MockEndpoint, type NativeMockFile } from "@vhyxvoid/shared/mock";
import { nativeCollectionFile, type ApiCollection, type NativeCollectionFile } from "@vhyxvoid/shared/apiclient";

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class UsageError extends Error {}

export interface Credentials {
  apiUrl: string;
  token: string;
}

/**
 * The API key from --api-key "keyId.secret", or VHYXVOID_API_KEY (either
 * "keyId.secret", or the key ID with VHYXVOID_SECRET). The API from
 * --api-url or VHYXVOID_API_URL (an origin), default https://api.vhyxvoid.com.
 */
export function credentials(opts: { apiKey?: string; apiUrl?: string }, env: NodeJS.ProcessEnv = process.env): Credentials {
  const raw = (opts.apiKey ?? env.VHYXVOID_API_KEY ?? "").trim();
  const token = raw.includes(".") ? raw : raw && env.VHYXVOID_SECRET ? `${raw}.${env.VHYXVOID_SECRET.trim()}` : "";
  if (!/^vhyxvoid_(dev|live)_[0-9a-f]+\.[0-9a-f]{64}$/.test(token)) {
    throw new UsageError("An API key is needed: --api-key <keyId>.<secret>, or VHYXVOID_API_KEY and VHYXVOID_SECRET. Create one under API keys with the scopes this command needs.");
  }
  const origin = (opts.apiUrl ?? env.VHYXVOID_API_URL ?? "https://api.vhyxvoid.com").replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return { apiUrl: `${origin}/api/v1`, token };
}

type Fetch = typeof fetch;

export class PlatformClient {
  constructor(
    private readonly creds: Credentials,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.creds.apiUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.creds.token}`, "user-agent": "vhyxvoid-cli", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new PlatformError(`Cannot reach ${this.creds.apiUrl}: ${(err as Error).message}`, 0);
    }
    const text = await res.text();
    let json: { message?: string; data?: T } | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new PlatformError(json?.message ?? `${method} ${path} failed (${res.status})`, res.status);
    return (json?.data ?? json) as T;
  }

  whoami() {
    return this.request<{ accountId: string; workspace: string | null; keyId: string; scopes: string[]; dashboardUrl: string }>("GET", "/platform/whoami");
  }
}

// ── Specs ────────────────────────────────────────────────────────────────────

type SpecSummary = { id: string; name: string; slug: string; version: number; latest: { number: number; version: string } | null };
export type SpecProblem = { path: string; message: string; severity: "error" | "warning" };
export type SpecChange = { severity: "breaking" | "warning" | "info"; location: string; message: string };
export type SpecCheck = {
  spec: { id: string; name: string; slug: string };
  against: { number: number; version: string } | null;
  problems: SpecProblem[];
  changes: SpecChange[];
  counts: { breaking: number; warning: number; info: number };
  converted: boolean;
};

export type FailOn = "breaking" | "warning" | "none";

export async function findSpec(client: PlatformClient, accountId: string, ref: string): Promise<SpecSummary> {
  const list = await client.request<{ specs: SpecSummary[] }>("GET", `/specs/${accountId}`);
  const s = list.specs.find((x) => x.id === ref || x.slug === ref.toLowerCase());
  if (!s) throw new UsageError(`No API spec "${ref}" in this workspace (specs: ${list.specs.map((x) => x.slug).join(", ") || "none"})`);
  return s;
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new UsageError(`Cannot read ${file}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
}

/** Problems in the file and its changes against the spec's latest published version. */
export async function checkSpec(client: PlatformClient, file: string, ref: string): Promise<SpecCheck> {
  return checkSpecText(client, readText(file), ref);
}

/** Same as checkSpec, for text that isn't in a file (an editor's unsaved buffer). */
export async function checkSpecText(client: PlatformClient, text: string, ref: string): Promise<SpecCheck> {
  const me = await client.whoami();
  const spec = await findSpec(client, me.accountId, ref);
  const r = await client.request<{ problems: SpecProblem[]; changes: SpecChange[]; counts: SpecCheck["counts"]; against: SpecCheck["against"]; converted: boolean }>("POST", `/specs/${me.accountId}/${spec.id}/preview`, { text });
  return { spec: { id: spec.id, name: spec.name, slug: spec.slug }, against: r.against, problems: r.problems, changes: r.changes, counts: r.counts, converted: r.converted };
}

export function checkFails(c: SpecCheck, failOn: FailOn): string | null {
  const errors = c.problems.filter((p) => p.severity === "error").length;
  if (errors) return `${errors} error${errors === 1 ? "" : "s"} in the document`;
  if (failOn !== "none" && c.counts.breaking) return `${c.counts.breaking} breaking change${c.counts.breaking === 1 ? "" : "s"}`;
  if (failOn === "warning" && c.counts.warning) return `${c.counts.warning} warning${c.counts.warning === 1 ? "" : "s"}`;
  return null;
}

const ICON = { breaking: "✗", warning: "!", info: "·", error: "✗" } as const;

export function formatCheck(c: SpecCheck): string[] {
  const lines = [`${c.spec.name} (${c.spec.slug}) — ${c.against ? `compared with v${c.against.number}${c.against.version ? ` (${c.against.version})` : ""}` : "nothing published yet"}`];
  const errors = c.problems.filter((p) => p.severity === "error");
  const warnings = c.problems.filter((p) => p.severity === "warning");
  if (errors.length || warnings.length) {
    lines.push("", `Problems: ${errors.length} error(s), ${warnings.length} warning(s)`);
    for (const p of [...errors, ...warnings]) lines.push(`  ${ICON[p.severity]} ${p.path ? `${p.path}: ` : ""}${p.message}`);
  }
  if (c.against) {
    lines.push("", c.changes.length ? `Changes: ${c.counts.breaking} breaking, ${c.counts.warning} warning, ${c.counts.info} other` : "No changes for clients.");
    for (const ch of c.changes) lines.push(`  ${ICON[ch.severity]} ${ch.location}: ${ch.message}`);
  }
  return lines;
}

const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** A PR comment / job summary. */
export function checkMarkdown(c: SpecCheck, failOn: FailOn, dashboardUrl?: string): string {
  const fail = checkFails(c, failOn);
  const head = fail ? `### ❌ ${c.spec.name}: ${fail}` : c.counts.breaking ? `### ⚠️ ${c.spec.name}: ${c.counts.breaking} breaking change(s)` : `### ✅ ${c.spec.name}: no breaking changes`;
  const out = [head, "", c.against ? `Compared with published **v${c.against.number}**${c.against.version ? ` (${md(c.against.version)})` : ""}.` : "Nothing is published yet; only the document was checked.", ""];
  const errors = c.problems.filter((p) => p.severity === "error");
  if (errors.length) {
    out.push("| Error | Where |", "| --- | --- |", ...errors.map((p) => `| ${md(p.message)} | \`${md(p.path || "—")}\` |`), "");
  }
  if (c.changes.length) {
    out.push("| | Operation | Change |", "| --- | --- | --- |", ...c.changes.map((ch) => `| ${ch.severity === "breaking" ? "🔴 breaking" : ch.severity === "warning" ? "🟡 warning" : "⚪ info"} | \`${md(ch.location)}\` | ${md(ch.message)} |`), "");
  }
  if (dashboardUrl) out.push(`[Open the API docs](${dashboardUrl}/api-docs/${c.spec.id})`);
  return out.join("\n");
}

export type PushResult = { saved: boolean; published: { number: number; breaking: number } | null; check: SpecCheck; message: string };

/**
 * Saves the file as the spec's draft; with publish, publishes it unless it
 * has errors or (without allowBreaking) breaking changes.
 */
export async function pushSpec(client: PlatformClient, file: string, ref: string, opts: { publish?: boolean; notes?: string; allowBreaking?: boolean }): Promise<PushResult> {
  return pushSpecText(client, readText(file), ref, opts);
}

/** Same as pushSpec, for text that isn't in a file. */
export async function pushSpecText(client: PlatformClient, text: string, ref: string, opts: { publish?: boolean; notes?: string; allowBreaking?: boolean }): Promise<PushResult> {
  const me = await client.whoami();
  const spec = await findSpec(client, me.accountId, ref);
  await client.request("PUT", `/specs/${me.accountId}/${spec.id}`, { text, expectedVersion: spec.version });
  const check = await checkSpecText(client, text, spec.id);
  if (!opts.publish) return { saved: true, published: null, check, message: `Saved the draft of ${spec.name}` };
  const fail = checkFails(check, opts.allowBreaking ? "none" : "breaking");
  if (fail) return { saved: true, published: null, check, message: `Saved the draft but did not publish: ${fail}${check.counts.breaking && !opts.allowBreaking ? " (use --allow-breaking to publish anyway)" : ""}` };
  try {
    const v = await client.request<{ number: number; breaking: number }>("POST", `/specs/${me.accountId}/${spec.id}/publish`, { notes: opts.notes ?? "" });
    return { saved: true, published: { number: v.number, breaking: v.breaking }, check, message: `Published ${spec.name} v${v.number}` };
  } catch (err) {
    if (err instanceof PlatformError && err.status === 409) return { saved: true, published: null, check, message: `Nothing to publish: ${err.message}` };
    throw err;
  }
}

// ── Collections ──────────────────────────────────────────────────────────────

type Overview = { collections: Array<{ id: string; name: string }>; environments: Array<{ id: string; name: string }> };

async function findCollection(client: PlatformClient, accountId: string, ref: string) {
  const o = await client.request<Overview>("GET", `/api-client/${accountId}`);
  const c = o.collections.find((x) => x.id === ref) ?? o.collections.filter((x) => x.name.toLowerCase() === ref.toLowerCase())[0];
  if (!c) throw new UsageError(`No collection "${ref}" in this workspace (collections: ${o.collections.map((x) => `"${x.name}"`).join(", ") || "none"})`);
  return { c, o };
}

/** Runs a stored collection on the platform (its runner, public addresses only). */
export async function runRemote<R>(client: PlatformClient, ref: string, opts: { environment?: string; folder?: string; bail?: boolean; vars?: Record<string, string> }) {
  const me = await client.whoami();
  const { c, o } = await findCollection(client, me.accountId, ref);
  let environmentId: string | undefined;
  if (opts.environment) {
    const e = o.environments.find((x) => x.id === opts.environment || x.name.toLowerCase() === opts.environment!.toLowerCase());
    if (!e) throw new UsageError(`No environment "${opts.environment}" (environments: ${o.environments.map((x) => `"${x.name}"`).join(", ") || "none"})`);
    environmentId = e.id;
  }
  let folderId: string | undefined;
  if (opts.folder) {
    const full = await client.request<{ folders: Array<{ id: string; name: string; parentId?: string | null }> }>("GET", `/api-client/${me.accountId}/collections/${c.id}`);
    folderId = folderByPath(full.folders, opts.folder);
    if (!folderId) throw new UsageError(`No folder "${opts.folder}" in ${c.name} (folders: ${full.folders.map((f) => `"${f.name}"`).join(", ") || "none"})`);
  }
  const vars = opts.vars && Object.keys(opts.vars).length ? opts.vars : undefined;
  const r = await client.request<{ id: string; report: R; rateLimited: boolean }>("POST", `/api-client/${me.accountId}/collections/${c.id}/run`, {
    ...(environmentId ? { environmentId } : {}),
    ...(folderId ? { folderId } : {}),
    ...(opts.bail ? { bail: true } : {}),
    ...(vars ? { runtime: vars } : {}),
  });
  return { collection: c, runId: r.id, report: r.report, rateLimited: r.rateLimited, url: `${me.dashboardUrl}/api-client/${c.id}` };
}

/** A folder by id or by "Parent/Child" names (case-insensitive). */
export function folderByPath(folders: ReadonlyArray<{ id: string; name: string; parentId?: string | null }>, ref: string): string | undefined {
  if (folders.some((f) => f.id === ref)) return ref;
  const parts = ref.split("/").map((x) => x.trim().toLowerCase()).filter(Boolean);
  let parent: string | null = null;
  let found: string | undefined;
  for (const part of parts) {
    const f = folders.find((x) => (x.parentId ?? null) === parent && x.name.toLowerCase() === part);
    if (!f) return undefined;
    found = f.id;
    parent = f.id;
  }
  return found;
}

/** Replaces a stored collection's requests, folders and variables from a file (any format the dashboard imports). */
export async function pushCollection(client: PlatformClient, file: string, ref: string) {
  const me = await client.whoami();
  const { c } = await findCollection(client, me.accountId, ref);
  const parsed = await client.request<{ collection: { name: string; description?: string; auth: unknown; variables: unknown[]; folders: unknown[]; requests: unknown[] } }>("POST", `/api-client/${me.accountId}/parse`, { document: readText(file) });
  const current = await client.request<{ version: number }>("GET", `/api-client/${me.accountId}/collections/${c.id}`);
  const col = parsed.collection;
  await client.request("PUT", `/api-client/${me.accountId}/collections/${c.id}`, { auth: col.auth, variables: col.variables, folders: col.folders, requests: col.requests, expectedVersion: current.version });
  return { collection: c, requests: col.requests.length, folders: col.folders.length };
}

// ── AI assist ────────────────────────────────────────────────────────────────

type AiUsage = { used: number; limit: number | null; resetsAt: string };
export type AiMockResult = { file: NativeMockFile; summary: string; warnings: string[]; usage: AiUsage };
export type AiTestsResult = { file: NativeCollectionFile; summary: string; warnings: string[]; usage: AiUsage };

/** Draft a mock API (needs ai:use). The result is a VhyxVoid mock file `vhyxvoid mock` serves. */
export async function aiMock(client: PlatformClient, opts: { description?: string; traffic?: string; name?: string }): Promise<AiMockResult> {
  if (!opts.description?.trim() && !opts.traffic) throw new UsageError("Describe the API, or pass --traffic <tunnel> to learn from captured requests");
  const me = await client.whoami();
  const r = await client.request<{ summary: string; endpoints: MockEndpoint[]; warnings: string[]; usage: AiUsage }>("POST", `/ai/${me.accountId}/mock`, {
    ...(opts.description?.trim() ? { description: opts.description.trim() } : {}),
    ...(opts.traffic ? { trafficLabel: opts.traffic } : {}),
  });
  const file = exportNative({ mode: "ALWAYS", cors: true, latencyMs: 0, endpoints: r.endpoints }, { name: opts.name || "AI draft", description: r.summary });
  return { file, summary: r.summary, warnings: r.warnings, usage: r.usage };
}

/** Draft a test collection (needs ai:use; specs:read is not needed for --spec). The result is a collection file `vhyxvoid test` runs. */
export async function aiTests(client: PlatformClient, opts: { description?: string; traffic?: string; spec?: string; baseUrl?: string }): Promise<AiTestsResult> {
  if (!opts.description?.trim() && !opts.traffic && !opts.spec) throw new UsageError("Describe what to test, or pass --spec <slug> or --traffic <tunnel>");
  const me = await client.whoami();
  const specId = opts.spec ? (await findSpec(client, me.accountId, opts.spec)).id : undefined;
  const r = await client.request<{ summary: string; collection: ApiCollection; warnings: string[]; usage: AiUsage }>("POST", `/ai/${me.accountId}/tests`, {
    ...(opts.description?.trim() ? { description: opts.description.trim() } : {}),
    ...(opts.traffic ? { trafficLabel: opts.traffic } : {}),
    ...(specId ? { specId } : {}),
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
  });
  return { file: nativeCollectionFile(r.collection), summary: r.summary, warnings: r.warnings, usage: r.usage };
}

export function usageLine(u: AiUsage): string {
  return u.limit === null ? `${u.used} AI draft(s) this month` : `${u.used} of ${u.limit} AI drafts used this month`;
}

/** Appends to the GitHub Actions job summary when running in Actions. */
export function writeJobSummary(markdown: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.GITHUB_STEP_SUMMARY) return false;
  try {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    return true;
  } catch {
    return false;
  }
}
