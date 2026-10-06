// packages/shared/src/customDomains.ts
//
// Custom domains: a customer serves one of their tunnels on their own
// hostname (api.acme.dev). Lifecycle:
//
//   1. Claimed in the dashboard (hostname + tunnel label). Several accounts
//      may hold a pending claim for the same hostname; none of them routes.
//   2. Verified when the TXT record `_vhyxvoid.<hostname>` contains
//      `vhyxvoid-verify=<token>` for that claim. Only one verified claim per
//      hostname exists (partial unique index); verifying removes the others.
//   3. Routed: the customer points the hostname at the platform (CNAME to the
//      operator's target, or A/AAAA records equal to the target's). The hub
//      routes verified hostnames; the edge (Caddy on-demand TLS) only gets a
//      certificate for verified hostnames (GET /api/v1/public/domains/allow).
//
// DNS is read through an injectable resolver so tests (and a non-production
// override) never touch real DNS.

import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";

export const DOMAIN_TXT_PREFIX = "_vhyxvoid";
export const DOMAIN_TXT_VALUE_PREFIX = "vhyxvoid-verify=";
/** Pending claims are re-checked automatically this long, then left for a manual check. */
export const DOMAIN_PENDING_AUTOCHECK_DAYS = 7;

export type DomainValidation = { ok: true; hostname: string } | { ok: false; error: string };

const RESERVED_SUFFIXES = ["localhost", "local", "internal", "invalid", "example", "arpa", "onion"];

/**
 * Normalises and validates a hostname a customer wants to use.
 * @param platformDomain the tunnel domain (e.g. "vhyxvoid.com"); it and its subdomains are refused
 * @param allowTestTld allow ".test" (local development and the e2e journey only)
 */
export function validateCustomHostname(input: string, platformDomain: string, allowTestTld = false): DomainValidation {
  let host = String(input ?? "").trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!host) return { ok: false, error: "Enter a hostname like api.example.com" };
  if (host.includes("*")) return { ok: false, error: "Wildcard domains are not supported; add each hostname" };
  if (host.includes(":")) return isIP(host) ? { ok: false, error: "Use a hostname, not an IP address" } : { ok: false, error: "Leave out the port" };
  const ascii = domainToASCII(host);
  if (!ascii) return { ok: false, error: "That is not a valid hostname" };
  host = ascii;
  if (isIP(host)) return { ok: false, error: "Use a hostname, not an IP address" };
  if (host.length > 253) return { ok: false, error: "That hostname is too long" };
  const labels = host.split(".");
  if (labels.length < 2) return { ok: false, error: "Use a full hostname like api.example.com" };
  for (const l of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) return { ok: false, error: `"${l}" is not a valid part of a hostname` };
  }
  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) return { ok: false, error: "That is not a valid hostname" };
  const platform = platformDomain.toLowerCase();
  if (platform && (host === platform || host.endsWith(`.${platform}`))) {
    return { ok: false, error: `Hostnames under ${platform} are provided automatically; use your own domain` };
  }
  if (RESERVED_SUFFIXES.includes(tld) || (tld === "test" && !allowTestTld)) {
    return { ok: false, error: "That domain cannot be used on the internet" };
  }
  return { ok: true, hostname: host };
}

export function newVerificationToken(): string {
  return randomBytes(18).toString("base64url");
}

export function verificationRecord(hostname: string, token: string): { name: string; value: string } {
  return { name: `${DOMAIN_TXT_PREFIX}.${hostname}`, value: `${DOMAIN_TXT_VALUE_PREFIX}${token}` };
}

// ── DNS checks ────────────────────────────────────────────────────────────────

export interface DnsResolverLike {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
}

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "ESERVFAIL", "ENONAME"]);

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch (err) {
    if (NOT_FOUND.has((err as NodeJS.ErrnoException).code ?? "")) return [];
    throw err;
  }
}

const clean = (h: string) => h.toLowerCase().replace(/\.$/, "");

export interface DomainCheck {
  verified: boolean;
  /** The hostname reaches the platform (CNAME to the target, or the same addresses). */
  routed: boolean;
  /** What was found, for the dashboard. */
  found: { txt: string[]; cname: string[]; addresses: string[] };
  error: string | null;
}

export async function checkCustomDomain(resolver: DnsResolverLike, hostname: string, token: string, target: string): Promise<DomainCheck> {
  const want = verificationRecord(hostname, token);
  try {
    const [txt, cname, a4, a6] = await Promise.all([
      safe(resolver.resolveTxt(want.name)).then((rows) => rows.map((chunks) => chunks.join(""))),
      safe(resolver.resolveCname(hostname)).then((r) => r.map(clean)),
      safe(resolver.resolve4(hostname)),
      safe(resolver.resolve6(hostname)),
    ]);
    const verified = txt.some((v) => v.trim() === want.value);
    let routed = false;
    const t = clean(target || "");
    if (t) {
      if (cname.includes(t)) routed = true;
      else if (a4.length || a6.length) {
        const [t4, t6] = await Promise.all([safe(resolver.resolve4(t)), safe(resolver.resolve6(t))]);
        const targets = new Set([...t4, ...t6]);
        routed = [...a4, ...a6].some((ip) => targets.has(ip));
      }
    }
    return { verified, routed, found: { txt, cname, addresses: [...a4, ...a6] }, error: null };
  } catch (err) {
    return { verified: false, routed: false, found: { txt: [], cname: [], addresses: [] }, error: `DNS lookup failed: ${(err as Error).message}` };
  }
}

/**
 * A resolver that answers from a fixed table, for development and tests:
 * `{ "_vhyxvoid.app.example.test": { "TXT": ["vhyxvoid-verify=…"] }, "app.example.test": { "CNAME": ["edge.vv.test"] } }`.
 * Names missing from the table answer "not found".
 */
export function staticDnsResolver(records: Record<string, Partial<Record<"TXT" | "CNAME" | "A" | "AAAA", string[]>>>): DnsResolverLike {
  const get = (name: string, type: "TXT" | "CNAME" | "A" | "AAAA") => {
    const v = records[clean(name)]?.[type];
    if (!v || !v.length) return Promise.reject(Object.assign(new Error(`${type} ${name} not found`), { code: "ENOTFOUND" }));
    return Promise.resolve(v);
  };
  return {
    resolveTxt: (n) => get(n, "TXT").then((v) => v.map((x) => [x])),
    resolveCname: (n) => get(n, "CNAME"),
    resolve4: (n) => get(n, "A"),
    resolve6: (n) => get(n, "AAAA"),
  };
}
