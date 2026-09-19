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

export class ResponseCache {
  private readonly store = new Map<string, CachedResponse>();

  // Evict entries when cache exceeds this size (LRU-lite: evict oldest)
  private readonly MAX_ENTRIES = 500;

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
    const key = this.buildKey(path, query, headers);
    const cached = this.store.get(key);

    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // The backend said this response depends on these request headers.
    if (cached.vary) {
      for (const [name, value] of Object.entries(cached.vary)) {
        if ((headers[name] ?? "") !== value) return null;
      }
    }

    cached.hits += 1;
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

    // Evict oldest entry if at capacity
    if (this.store.size >= this.MAX_ENTRIES && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }

    this.store.set(key, {
      ...response,
      vary,
      cachedAt: now,
      expiresAt: now + maxAge * 1_000,
      hits: 0,
    });
  }

  /**
   * Invalidate all cached entries for a path prefix.
   * Call after any POST/PUT/PATCH/DELETE to related resources.
   */
  invalidatePrefix(pathPrefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(pathPrefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Remove all expired entries. Called periodically. */
  evictExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  stats(): { size: number; totalHits: number } {
    let totalHits = 0;
    for (const entry of this.store.values()) totalHits += entry.hits;
    return { size: this.store.size, totalHits };
  }

  clear(): void {
    this.store.clear();
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
