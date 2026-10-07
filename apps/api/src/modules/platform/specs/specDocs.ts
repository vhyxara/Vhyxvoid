// Helpers shared by the private and public API-docs routes (phase 5).
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { SPEC_BOUNDS, normalizeSpec, validateSpec, type SpecProblem } from "@vhyxvoid/shared";

type Json = Record<string, unknown>;

export interface ParsedSpec {
  /** OpenAPI 3 (Swagger 2 converted) — null when the text doesn't parse. */
  doc: Json | null;
  format: "yaml" | "json";
  converted: boolean;
  problems: SpecProblem[];
}

/** Reads the editor's text: JSON or YAML, OpenAPI 3 or Swagger 2. Never throws. */
export function parseSpecText(text: string): ParsedSpec {
  const trimmed = text.trimStart();
  const format = trimmed.startsWith("{") ? "json" : "yaml";
  if (Buffer.byteLength(text) > SPEC_BOUNDS.textBytes) return { doc: null, format, converted: false, problems: [{ path: "", message: `The document is over ${SPEC_BOUNDS.textBytes / 1_000_000} MB`, severity: "error" }] };
  let raw: unknown;
  try {
    raw = format === "json" ? JSON.parse(text) : parseYaml(text, { maxAliasCount: 100 });
  } catch (err) {
    const e = err as Error & { linePos?: Array<{ line: number; col: number }> };
    const at = e.linePos?.[0] ? `line ${e.linePos[0].line}` : "";
    return { doc: null, format, converted: false, problems: [{ path: at, message: `Not valid ${format.toUpperCase()}: ${e.message.split("\n")[0]}`, severity: "error" }] };
  }
  try {
    const { doc, converted } = normalizeSpec(raw);
    const problems = validateSpec(doc);
    if (converted) problems.unshift({ path: "swagger", message: "Swagger 2.0 was converted to OpenAPI 3.0.3 for the docs; publish to keep the converted version", severity: "warning" });
    return { doc, format, converted, problems };
  } catch (err) {
    return { doc: null, format, converted: false, problems: [{ path: "", message: (err as Error).message, severity: "error" }] };
  }
}

export const errorsOf = (problems: SpecProblem[]) => problems.filter((p) => p.severity === "error");

export function specToText(doc: unknown, format: "yaml" | "json"): string {
  return format === "json" ? `${JSON.stringify(doc, null, 2)}\n` : stringifyYaml(doc, { lineWidth: 0, aliasDuplicateObjects: false });
}

// ── Passwords and unlock tokens ──────────────────────────────────────────────

export function pepper(): string {
  const p = process.env.SERVER_HMAC_PEPPER;
  if (!p) throw new Error("SERVER_HMAC_PEPPER is not set");
  return p;
}

const hmac = (key: string, value: string) => createHmac("sha256", key).update(value).digest("hex");

export const hashDocsPassword = (specId: string, password: string) => hmac(pepper(), `docs-password|${specId}|${password}`);

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export const checkDocsPassword = (specId: string, passwordHash: string, password: string) => equalHex(hashDocsPassword(specId, password), passwordHash);

export const DOCS_TOKEN_HOURS = 12;

/** "exp.sig"; changing the password invalidates every token (the hash is in the key). */
export function signDocsToken(specId: string, passwordHash: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + DOCS_TOKEN_HOURS * 3600;
  return `${exp}.${hmac(`${pepper()}|${passwordHash}`, `docs-token|${specId}|${exp}`)}`;
}

export function verifyDocsToken(specId: string, passwordHash: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [expText, sig] = token.split(".");
  const exp = Number(expText);
  if (!Number.isInteger(exp) || exp * 1000 < now || !sig) return false;
  return equalHex(hmac(`${pepper()}|${passwordHash}`, `docs-token|${specId}|${exp}`), sig);
}

// ── Try it against a mock ────────────────────────────────────────────────────

export interface TryResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  ms: number;
}

const TRY_MAX_BYTES = 256 * 1024;
const DROP_REQUEST = new Set(["host", "content-length", "connection", "transfer-encoding", "cookie", "x-vhyxvoid-internal", "x-vhyxvoid-load-test", "x-hub-internal-secret", "x-forwarded-for", "x-real-ip"]);

/**
 * Sends one request to a mock API through OUR hub (HUB_INTERNAL_URL with the
 * mock's Host), like any visitor of the mock URL: counted, rate limited and
 * shown in the inspector. Never reaches another host.
 */
export function sendToMock(host: string, req: { method: string; path: string; headers: Record<string, string>; body?: string }): Promise<TryResult> {
  const hubUrl = process.env.HUB_INTERNAL_URL;
  if (!hubUrl) return Promise.reject(new Error("The hub is not configured on this API (HUB_INTERNAL_URL)"));
  const hub = new URL(hubUrl);
  const mod = hub.protocol === "https:" ? https : http;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQUEST.has(k.toLowerCase())) headers[k] = v;
  headers.host = host;
  headers["user-agent"] ??= "VhyxVoid-Docs/1";
  const body = req.body !== undefined && req.method !== "GET" && req.method !== "HEAD" ? Buffer.from(req.body) : undefined;
  if (body) headers["content-length"] = String(body.length);
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const r = mod.request({ host: hub.hostname, port: hub.port || (hub.protocol === "https:" ? 443 : 80), method: req.method, path: req.path, headers, timeout: 15_000 }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      res.on("data", (c: Buffer) => {
        if (size >= TRY_MAX_BYTES) {
          truncated = true;
          return;
        }
        chunks.push(c.subarray(0, TRY_MAX_BYTES - size));
        size += c.length;
        if (size > TRY_MAX_BYTES) truncated = true;
      });
      res.on("end", () => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined && k !== "set-cookie") out[k] = Array.isArray(v) ? v.join(", ") : v;
        resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks).toString("utf8"), truncated, ms: Math.round(performance.now() - t0) });
      });
      res.on("error", reject);
    });
    r.on("timeout", () => r.destroy(new Error("The mock didn't answer within 15 s")));
    r.on("error", reject);
    r.end(body);
  });
}
