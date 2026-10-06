// packages/shared/src/tunnelAccess.ts
//
// Access rules for a public tunnel (Prisma model TunnelPolicy). apps/api
// writes them; apps/hub enforces them before a request reaches the agent.
// Kept here so both sides hash passwords and sign share links identically.
//
// Order of checks for a request:
//   1. IP allowlist (when set): the caller's address must match, always.
//   2. Password (when set): HTTP Basic credentials, or a valid share-link
//      cookie, or a valid share-link token in the URL (which the hub turns
//      into the cookie with a redirect).
//
// Secrets: passwords are stored as HMAC-SHA256 with SERVER_HMAC_PEPPER and
// compared in constant time; share links are HMAC-signed, carry their own
// expiry and the policy version, so bumping the version revokes them all.

import { createHmac, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";

export const SHARE_QUERY_PARAM = "vv_share";
export const ACCESS_COOKIE = "vv_access";
export const MAX_SHARE_LINK_HOURS = 24 * 30;
export const MAX_ALLOWLIST_ENTRIES = 50;

export interface TunnelPolicyRecord {
  accountId: string;
  label: string;
  passwordHash: string | null;
  ipAllowlist: string[];
  version: number;
}

const hmac = (pepper: string, value: string) => createHmac("sha256", pepper).update(value).digest();

export function hashTunnelPassword(pepper: string, accountId: string, label: string, password: string): string {
  return hmac(pepper, `tunnel-password|${accountId}|${label}|${password}`).toString("hex");
}

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// ── IP allowlist ──────────────────────────────────────────────────────────────

/** Normalises one entry ("1.2.3.4", "10.0.0.0/8", "2001:db8::/32") or returns null if invalid. */
export function parseAllowlistEntry(entry: string): { address: string; prefix: number; type: "ipv4" | "ipv6" } | null {
  const [address, prefixText] = entry.trim().split("/");
  const version = isIP(address ?? "");
  if (!version) return null;
  const type = version === 4 ? "ipv4" : "ipv6";
  const max = version === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? max : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { address, prefix, type };
}

export function validateAllowlist(entries: string[]): string | undefined {
  if (entries.length > MAX_ALLOWLIST_ENTRIES) return `At most ${MAX_ALLOWLIST_ENTRIES} entries`;
  const bad = entries.find((e) => !parseAllowlistEntry(e));
  return bad ? `"${bad}" is not an IP address or CIDR range` : undefined;
}

export function ipAllowed(allowlist: string[], ip: string | null | undefined): boolean {
  if (allowlist.length === 0) return true;
  if (!ip) return false;
  // IPv4 seen through an IPv6 socket: ::ffff:1.2.3.4
  const addr = ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const type = isIP(addr) === 4 ? "ipv4" : isIP(addr) === 6 ? "ipv6" : null;
  if (!type) return false;
  const list = new BlockList();
  for (const e of allowlist) {
    const p = parseAllowlistEntry(e);
    if (p && p.type === type) list.addSubnet(p.address, p.prefix, p.type);
  }
  return list.check(addr, type);
}

// ── Share links ───────────────────────────────────────────────────────────────

export function signShareToken(pepper: string, p: { accountId: string; label: string; version: number; expiresAt: Date }): string {
  const exp = Math.floor(p.expiresAt.getTime() / 1000);
  const sig = hmac(pepper, `tunnel-share|${p.accountId}|${p.label}|${p.version}|${exp}`).subarray(0, 18).toString("base64url");
  return `${exp}.${p.version}.${sig}`;
}

/** Seconds left on a valid token for this policy, or 0. */
export function verifyShareToken(pepper: string, policy: TunnelPolicyRecord, token: string | null | undefined, now = Date.now()): number {
  if (!token) return 0;
  const [expText, versionText, sig] = token.split(".");
  const exp = Number(expText);
  const version = Number(versionText);
  if (!Number.isInteger(exp) || version !== policy.version || !sig) return 0;
  const left = exp - Math.floor(now / 1000);
  if (left <= 0) return 0;
  const expected = signShareToken(pepper, { accountId: policy.accountId, label: policy.label, version, expiresAt: new Date(exp * 1000) }).split(".")[2];
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? left : 0;
}

// ── Decision ──────────────────────────────────────────────────────────────────

export interface AccessRequest {
  ip: string | null;
  authorization?: string;
  cookie?: string;
  /** Request target (path + query), to find a share token. */
  url: string;
}

export type AccessDecision =
  | { allow: true; stripAuthorization: boolean }
  | { allow: false; status: 401 | 403; reason: string }
  /** Too many wrong passwords from this address: try again after retryAfterSeconds. */
  | { allow: false; status: 429; reason: string; retryAfterSeconds: number }
  /** A valid share token in the URL: redirect to the clean URL with this cookie. */
  | { allow: false; status: 302; location: string; cookie: { value: string; maxAgeSeconds: number } };

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function basicPassword(header: string | undefined): string | null {
  if (!header || !/^basic\s+/i.test(header)) return null;
  try {
    const decoded = Buffer.from(header.replace(/^basic\s+/i, ""), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    return i === -1 ? decoded : decoded.slice(i + 1);
  } catch {
    return null;
  }
}

export function evaluateTunnelAccess(policy: TunnelPolicyRecord | null, req: AccessRequest, pepper: string, now = Date.now()): AccessDecision {
  if (!policy) return { allow: true, stripAuthorization: false };

  if (!ipAllowed(policy.ipAllowlist, req.ip)) {
    return { allow: false, status: 403, reason: "This tunnel only accepts requests from allowed IP addresses." };
  }
  if (!policy.passwordHash) return { allow: true, stripAuthorization: false };

  // Share token in the URL -> set the cookie, drop the token from the URL.
  const q = req.url.indexOf("?");
  if (q !== -1) {
    const params = new URLSearchParams(req.url.slice(q + 1));
    const token = params.get(SHARE_QUERY_PARAM);
    if (token !== null) {
      const left = verifyShareToken(pepper, policy, token, now);
      if (left > 0) {
        params.delete(SHARE_QUERY_PARAM);
        const rest = params.toString();
        return { allow: false, status: 302, location: req.url.slice(0, q) + (rest ? `?${rest}` : ""), cookie: { value: token, maxAgeSeconds: left } };
      }
    }
  }

  if (verifyShareToken(pepper, policy, readCookie(req.cookie, ACCESS_COOKIE), now) > 0) return { allow: true, stripAuthorization: false };

  const password = basicPassword(req.authorization);
  if (password !== null && equalHex(hashTunnelPassword(pepper, policy.accountId, policy.label, password), policy.passwordHash)) {
    // The credentials were for the tunnel, not for the app behind it.
    return { allow: true, stripAuthorization: true };
  }
  return { allow: false, status: 401, reason: "This tunnel is password protected." };
}

/** Removes the tunnel's own cookie from a Cookie header before forwarding. */
export function stripAccessCookie(cookie: string | undefined): string | undefined {
  if (!cookie) return cookie;
  const kept = cookie
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${ACCESS_COOKIE}=`));
  return kept.length ? kept.join("; ") : undefined;
}

// ── Password guessing ─────────────────────────────────────────────────────────
// Wrong tunnel passwords per (account, tunnel, client IP) in a sliding minute.
// Past the limit the hub answers 429 without checking the password at all.
// In-process (per hub), like the public-path abuse limiter.

export const PASSWORD_GUESS_LIMIT = 10;
export const PASSWORD_GUESS_WINDOW_MS = 60_000;
const MAX_TRACKED = 50_000;

export class PasswordGuessLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly limit = PASSWORD_GUESS_LIMIT,
    private readonly windowMs = PASSWORD_GUESS_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  static key(accountId: string, label: string, ip: string | null | undefined): string {
    return `${accountId}\u0000${label}\u0000${ip ?? "?"}`;
  }

  /** Seconds until another attempt is allowed, or 0 when not blocked. */
  blockedFor(key: string): number {
    const list = this.recent(key);
    if (list.length < this.limit) return 0;
    return Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 1000));
  }

  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    if (list.length > this.limit) list.shift();
    this.failures.set(key, list);
    if (this.failures.size > MAX_TRACKED) this.sweep();
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  private sweep(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [k, list] of this.failures) if (!list.some((t) => t > cutoff)) this.failures.delete(k);
  }
}
