// packages/agent/src/cache/ResponseCache.ts

import { createHash } from "node:crypto";

/** Request headers as the hub forwards them (any case; values may be arrays). */
export type RequestHeaders = Record<string, string | string[] | undefined>;

// A header counts as identifying the CALLER (and so partitions the cache) if it
// is one of the standard credential headers, or its name says it carries a
// credential: x-api-key, api-key, x-auth-token, x-csrf-token, x-session-id, ...
// This is a heuristic on purpose: there is no way to enumerate every custom
// auth header, and a response that varies on any other request header is
// covered by the backend's own `Vary` (see below). It errs toward more
// partitions, which costs a cache miss, never a leak.
const CREDENTIAL_HEADER =
  /^(authorization|proxy-authorization|cookie)$|(^|-)(auth|token|key|secret|session|csrf|xsrf|api)(-|$)/;

export interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  /** See TunnelResponseMsg.bodyEncoding — preserved so a cache HIT for a
   * binary response doesn't lose its encoding on replay. */
  bodyEncoding?: "utf8" | "base64";
  durationMs: number;
  /**
   * Request header names the backend's `Vary` said this response depends on,
   * with the request's values at store time. A later request only matches if it
   * sends the same values.
   */
  vary?: Record<string, string>;
  cachedAt: number; // unix ms
  expiresAt: number; // unix ms
  hits: number; // how many times this entry was served from cache
}

/** Default memory budget. The agent can run inside the developer's own app
 * process (@vhyxvoid/next, @vhyxvoid/middleware), so the cache is bounded in
 * bytes, not only in entries (audit part2 G5). */
export const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 500;

export class ResponseCache {
  // Map iteration order is insertion order; a hit re-inserts its entry, so
  // the first key is always the least recently used one (LRU).
  private readonly store = new Map<string, CachedResponse>();
  private readonly sizes = new Map<string, number>();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
    private readonly maxBytes: number = DEFAULT_MAX_CACHE_BYTES,
  ) {}

  /**
   * Try to get a cached response.
   * Returns null on miss or if method is not GET.
   *
   * `requestHeaders` identify the caller: an entry is only returned to a
   * request carrying the same credentials as the one that produced it.
   */
  get(
    method: string,
    path: string,
    query: string,
    requestHeaders: RequestHeaders = {},
  ): CachedResponse | null {
    // Only cache GET requests — POST/PUT/DELETE are never safe to cache
    if (method.toUpperCase() !== "GET") return null;

    const headers = lowerCaseHeaders(requestHeaders);

    // The caller asked for a fresh copy (browser hard refresh sends
    // Cache-Control: no-cache / Pragma: no-cache). Go to the backend; its
    // response replaces the entry via set().
    if (requestsFreshCopy(headers)) return null;

    const key = this.buildKey(path, query, headers);
    const cached = this.store.get(key);

    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.remove(key);
      return null;
    }

    // The backend said this response depends on these request headers.
    if (cached.vary) {
      for (const [name, value] of Object.entries(cached.vary)) {
        if ((headers[name] ?? "") !== value) return null;
      }
    }

    cached.hits += 1;
    // Mark as most recently used.
    this.store.delete(key);
    this.store.set(key, cached);
    return cached;
  }

  /**
   * Store a response if the backend's Cache-Control header allows it.
   * Does nothing for non-GET methods or non-cacheable responses.
   *
   * `requestHeaders` are the headers of the request that produced `response`;
   * they decide which callers the entry may later be served to.
   */
  set(
    method: string,
    path: string,
    query: string,
    response: Omit<CachedResponse, "cachedAt" | "expiresAt" | "hits" | "vary">,
    requestHeaders: RequestHeaders = {},
  ): void {
    if (method.toUpperCase() !== "GET") return;

    // Only cache 2xx responses
    if (response.status < 200 || response.status >= 300) return;

    const maxAge = this.parseMaxAge(response.headers["cache-control"] ?? "");
    if (maxAge <= 0) return; // no-cache, no-store, or no max-age directive

    const responseHeaders = lowerCaseHeaders(response.headers);

    // A response that sets a cookie establishes state for ONE caller. Replaying
    // it to others would hand them that caller's session.
    if (responseHeaders["set-cookie"] !== undefined) return;

    const varyNames = (responseHeaders["vary"] ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (varyNames.includes("*")) return; // "depends on something we can't see"

    const headers = lowerCaseHeaders(requestHeaders);
    const vary = varyNames.length
      ? Object.fromEntries(varyNames.map((name) => [name, headers[name] ?? ""]))
      : undefined;

    const now = Date.now();
    const key = this.buildKey(path, query, headers);
    const bytes = entryBytes(key, response);

    // One response larger than the whole budget is never cached.
    if (bytes > this.maxBytes) return;

    this.remove(key);
    while (
      this.store.size > 0 &&
      (this.store.size >= this.maxEntries || this.totalBytes + bytes > this.maxBytes)
    ) {
      const leastRecent = this.store.keys().next().value as string;
      this.remove(leastRecent);
    }

    this.store.set(key, {
      ...response,
      vary,
      cachedAt: now,
      expiresAt: now + maxAge * 1_000,
      hits: 0,
    });
    this.sizes.set(key, bytes);
    this.totalBytes += bytes;
  }

  /**
   * Invalidate every cached entry for a path and everything under it, by
   * whole path segments: "/users" drops "/users", "/users?page=2" and
   * "/users/5", but not "/users-archive" or "/usersettings".
   * Call after any POST/PUT/PATCH/DELETE to related resources.
   */
  invalidatePrefix(pathPrefix: string): number {
    const prefix = pathPrefix.length > 1 ? pathPrefix.replace(/\/+$/, "") : pathPrefix;
    let count = 0;
    for (const key of [...this.store.keys()]) {
      if (isUnderPath(keyPath(key), prefix)) {
        this.remove(key);
        count++;
      }
    }
    return count;
  }

  /** Remove all expired entries. Called periodically. */
  evictExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of [...this.store]) {
      if (now > entry.expiresAt) {
        this.remove(key);
        count++;
      }
    }
    return count;
  }

  stats(): { size: number; totalHits: number; bytes: number } {
    let totalHits = 0;
    for (const entry of this.store.values()) totalHits += entry.hits;
    return { size: this.store.size, totalHits, bytes: this.totalBytes };
  }

  clear(): void {
    this.store.clear();
    this.sizes.clear();
    this.totalBytes = 0;
  }

  private remove(key: string): void {
    if (!this.store.delete(key)) return;
    this.totalBytes -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * `path?query`, then NUL, then a digest of the caller's credential headers
   * (empty for an anonymous request). The path stays first so invalidatePrefix,
   * which matches on the start of the key, keeps working. Only the digest, never
   * the credential itself, is used as a map key.
   */
  private buildKey(path: string, query: string, headers: Record<string, string>): string {
    const url = query ? `${path}?${query}` : path;

    return `${url}\u0000${credentialDigest(headers)}`;
  }

  /**
   * Parse max-age seconds from a Cache-Control header value.
   * Returns 0 if no caching is allowed.
   *
   * Examples:
   *   "max-age=300"                   → 300
   *   "public, max-age=60"            → 60
   *   "no-cache"                      → 0
   *   "no-store"                      → 0
   *   "private, max-age=120"          → 0  (private = don't cache in shared proxy)
   *   ""                              → 0
   */
  private parseMaxAge(cacheControl: string): number {
    if (!cacheControl) return 0;

    const lower = cacheControl.toLowerCase();

    // Directives that mean "do not cache"
    if (lower.includes("no-store") || lower.includes("no-cache")) return 0;

    // Private responses should not be cached at the agent level
    // (agent acts as a shared intermediary)
    if (lower.includes("private")) return 0;

    // Extract max-age=N
    const match = lower.match(/max-age\s*=\s*(\d+)/);
    if (!match) return 0;

    const seconds = parseInt(match[1], 10);
    return isNaN(seconds) ? 0 : seconds;
  }
}

/** Approximate in-memory size: strings are UTF-16, so 2 bytes per char. */
function entryBytes(
  key: string,
  response: { body: string | null; headers: Record<string, string> },
): number {
  let chars = key.length + (response.body?.length ?? 0);
  for (const [name, value] of Object.entries(response.headers)) {
    chars += name.length + String(value).length;
  }
  return chars * 2 + 256;
}

function requestsFreshCopy(headers: Record<string, string>): boolean {
  const cc = (headers["cache-control"] ?? "").toLowerCase();
  const pragma = (headers["pragma"] ?? "").toLowerCase();
  return cc.includes("no-cache") || cc.includes("no-store") || cc.includes("max-age=0") || pragma.includes("no-cache");
}

/** The path part of a cache key ("path?query\0digest" -> "path"). */
function keyPath(key: string): string {
  const url = key.slice(0, key.indexOf("\u0000"));
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function isUnderPath(path: string, prefix: string): boolean {
  if (prefix === "/" || prefix === "") return true;
  return path === prefix || path.startsWith(prefix + "/");
}

function lowerCaseHeaders(headers: RequestHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function credentialDigest(headers: Record<string, string>): string {
  const credentials = Object.keys(headers)
    .filter((name) => CREDENTIAL_HEADER.test(name))
    .sort()
    .map((name) => `${name}=${headers[name]}`);

  if (credentials.length === 0) return "";

  return createHash("sha256").update(credentials.join("\n")).digest("hex").slice(0, 32);
}
