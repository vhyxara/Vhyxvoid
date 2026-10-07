// packages/agent/src/apiTest.ts
//
// `vhyxvoid test <file>`: runs an API collection on this machine with the same
// engine as the dashboard (@vhyxvoid/shared/apiclient) and exits non-zero when
// a check fails, for CI. The file is a collection exported from the dashboard
// (VhyxVoid JSON, which can carry environments) or a Postman collection /
// OpenAPI document as JSON. Requests go straight from here, so they can reach
// localhost and private networks (unlike the dashboard's runner).
//
// Variables, lowest to highest: collection, --env, VHYXVOID_VAR_<NAME>
// environment variables, --var NAME=value, values captured during the run.

import * as fs from "fs";
import {
  importApiCollection,
  reportToJUnit,
  runCollection,
  sendHttp,
  type ApiVariable,
  type ImportedCollection,
  type RunReport,
  type RunRequestResult,
} from "@vhyxvoid/shared/apiclient";

export interface ApiTestOptions {
  file: string;
  /** An environment name inside the file, or a JSON file. */
  env?: string;
  vars?: string[];
  /** Folder name (or path "A/B") to run alone. */
  folder?: string;
  bail?: boolean;
  timeoutMs?: number;
  delayMs?: number;
  insecure?: boolean;
  followRedirects?: boolean;
  junit?: string;
  json?: string;
  quiet?: boolean;
  /** process.env, injectable for tests. */
  environ?: NodeJS.ProcessEnv;
}

export class UsageError extends Error {}

function readJson(file: string, what: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new UsageError(`Cannot read ${what} ${file}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${file} is not JSON. Export the collection from the dashboard (Export → VhyxVoid JSON), or convert YAML to JSON first.`);
  }
}

export function loadCollection(file: string): ImportedCollection {
  const doc = readJson(file, "the collection");
  try {
    return importApiCollection(doc);
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

/** --env: a name from the file's environments, or a JSON file (VhyxVoid, Postman environment, or { "NAME": "value" }). */
export function loadEnvironment(spec: string, imported: ImportedCollection): { name: string; variables: ApiVariable[] } {
  const inFile = imported.environments.find((e) => e.name.toLowerCase() === spec.toLowerCase());
  if (inFile) return inFile;
  if (!fs.existsSync(spec)) {
    const names = imported.environments.map((e) => `"${e.name}"`).join(", ");
    throw new UsageError(`No environment "${spec}"${names ? ` in the file (it has ${names})` : " in the file"}, and no such file`);
  }
  const doc = readJson(spec, "the environment") as Record<string, unknown>;
  if (Array.isArray(doc.values)) {
    return { name: String(doc.name ?? spec), variables: (doc.values as Record<string, unknown>[]).map((v) => ({ key: String(v.key), value: String(v.value ?? ""), enabled: v.enabled !== false })) };
  }
  if (Array.isArray(doc.variables)) return { name: String(doc.name ?? spec), variables: doc.variables as ApiVariable[] };
  if (Array.isArray(doc.environments) && (doc.environments as unknown[]).length) return (doc.environments as { name: string; variables: ApiVariable[] }[])[0];
  return { name: spec, variables: Object.entries(doc).map(([key, value]) => ({ key, value: typeof value === "string" ? value : JSON.stringify(value), enabled: true })) };
}

export function parseVars(list: string[] = [], environ: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(environ)) if (k.startsWith("VHYXVOID_VAR_") && v !== undefined) out[k.slice("VHYXVOID_VAR_".length)] = v;
  for (const item of list) {
    const eq = item.indexOf("=");
    if (eq <= 0) throw new UsageError(`--var needs NAME=value (got "${item}")`);
    out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
}

const mark: Record<RunRequestResult["outcome"], string> = { passed: "✓", failed: "✗", errored: "!", skipped: "-" };

export function formatResult(r: RunRequestResult): string[] {
  const where = r.folder.length ? `${r.folder.join(" / ")} / ` : "";
  const status = r.status !== undefined ? ` → ${r.status} ${r.timeMs} ms` : "";
  const lines = [`${mark[r.outcome]} ${r.method.padEnd(6)} ${where}${r.name}${status}`];
  for (const a of r.assertions) if (!a.pass) lines.push(`    ✗ ${a.label}: ${a.message}`);
  if (r.error) lines.push(`    ${r.outcome === "skipped" ? "skipped" : "error"}: ${r.error}`);
  return lines;
}

export function formatSummary(report: RunReport): string {
  const parts = [`${report.passed} passed`];
  if (report.failed) parts.push(`${report.failed} failed`);
  if (report.errored) parts.push(`${report.errored} errored`);
  if (report.skipped) parts.push(`${report.skipped} skipped`);
  return `${report.total} request${report.total === 1 ? "" : "s"}: ${parts.join(", ")}; checks ${report.assertions.passed}/${report.assertions.passed + report.assertions.failed} in ${(report.durationMs / 1000).toFixed(1)} s`;
}

/** Runs the file; returns the report (the caller decides the exit code). */
export async function runApiTests(opts: ApiTestOptions, print: (line: string) => void = console.log): Promise<RunReport> {
  const imported = loadCollection(opts.file);
  const col = imported.collection;
  const env = opts.env ? loadEnvironment(opts.env, imported) : imported.environments.length === 1 ? imported.environments[0] : undefined;
  const overrides = parseVars(opts.vars, opts.environ ?? process.env);
  let folderId: string | undefined;
  if (opts.folder) {
    const want = opts.folder.split("/").map((s) => s.trim().toLowerCase());
    let parent: string | null = null;
    for (const name of want) {
      const found = col.folders.find((f) => (f.parentId ?? null) === parent && f.name.toLowerCase() === name);
      if (!found) throw new UsageError(`No folder "${opts.folder}" in the collection (folders: ${col.folders.map((f) => f.name).join(", ") || "none"})`);
      parent = found.id;
    }
    folderId = parent ?? undefined;
  }
  const missingSecrets = (env?.variables ?? []).filter((v) => v.secret && v.value === "" && !(v.key in overrides)).map((v) => v.key);
  if (!opts.quiet) {
    print(`\n  ${col.name}${env ? ` · ${env.name}` : ""}`);
    if (missingSecrets.length) print(`  ⚠ No value for ${missingSecrets.join(", ")} (secrets are not exported): pass --var ${missingSecrets[0]}=… or set VHYXVOID_VAR_${missingSecrets[0]}`);
    print("");
  }
  const report = await runCollection({
    collection: col,
    environment: env?.variables,
    environmentName: env?.name,
    overrides,
    folderId,
    bail: opts.bail,
    delayMs: opts.delayMs,
    send: (built) => sendHttp(built, { timeoutMs: opts.timeoutMs ?? 30_000, insecure: opts.insecure, followRedirects: opts.followRedirects ? 5 : 0, userAgent: "vhyxvoid-test/1" }),
    onResult: (r) => {
      if (opts.quiet && r.outcome === "passed") return;
      for (const l of formatResult(r)) print(`  ${l}`);
    },
  });
  if (!opts.quiet || report.failed || report.errored) print(`\n  ${formatSummary(report)}\n`);
  if (opts.junit) fs.writeFileSync(opts.junit, reportToJUnit(report));
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(report, null, 2));
  return report;
}

export const exitCodeOf = (r: RunReport) => (r.failed || r.errored || r.total === 0 ? 1 : 0);
