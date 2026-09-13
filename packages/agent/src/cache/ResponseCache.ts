// packages/agent/src/cache/ResponseCache.ts

export interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  /** See TunnelResponseMsg.bodyEncoding — preserved so a cache HIT for a
   * binary response doesn't lose its encoding on replay. */
  bodyEncoding?: "utf8" | "base64";
  durationMs: number;
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
   */
  get(method: string, path: string, query: string): CachedResponse | null {
    // Only cache GET requests — POST/PUT/DELETE are never safe to cache
    if (method.toUpperCase() !== "GET") return null;

    const key = this.buildKey(path, query);
    const cached = this.store.get(key);

    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.store.delete(key);
      return null;
    }

    cached.hits += 1;
    return cached;
  }

  /**
   * Store a response if the backend's Cache-Control header allows it.
   * Does nothing for non-GET methods or non-cacheable responses.
   */
  set(
    method: string,
    path: string,
    query: string,
    response: Omit<CachedResponse, "cachedAt" | "expiresAt" | "hits">,
  ): void {
    if (method.toUpperCase() !== "GET") return;

    // Only cache 2xx responses
    if (response.status < 200 || response.status >= 300) return;

    const maxAge = this.parseMaxAge(response.headers["cache-control"] ?? "");
    if (maxAge <= 0) return; // no-cache, no-store, or no max-age directive

    const now = Date.now();
    const key = this.buildKey(path, query);

    // Evict oldest entry if at capacity
    if (this.store.size >= this.MAX_ENTRIES && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }

    this.store.set(key, {
      ...response,
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

  private buildKey(path: string, query: string): string {
    return query ? `${path}?${query}` : path;
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
