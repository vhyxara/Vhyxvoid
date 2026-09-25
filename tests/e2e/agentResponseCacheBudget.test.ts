import { describe, it, expect } from "vitest";
import { ResponseCache } from "../../packages/agent/src/cache/ResponseCache";

// Audit part2 G5 (shared/audit-2026-09-24-part2.md): the agent's ResponseCache
// had a 500-entry cap but no byte budget (it can live inside the developer's
// own app process), evicted FIFO rather than LRU, ignored a request's
// Cache-Control: no-cache, and invalidated by raw string prefix.

const ok = (body: string) => ({
  status: 200,
  headers: { "cache-control": "max-age=60" },
  body,
  bodyEncoding: "utf8" as const,
  durationMs: 1,
});

describe("ResponseCache memory budget and LRU", () => {
  it("stays under its byte budget, evicting least recently used entries", () => {
    const cache = new ResponseCache(500, 10_000);
    const body = "x".repeat(1_500); // ~3.3 KB per entry with overhead
    cache.set("GET", "/a", "", ok(body));
    cache.set("GET", "/b", "", ok(body));
    cache.get("GET", "/a", ""); // /a is now more recent than /b
    cache.set("GET", "/c", "", ok(body));
    cache.set("GET", "/d", "", ok(body)); // over budget: evicts /b first

    expect(cache.stats().bytes).toBeLessThanOrEqual(10_000);
    expect(cache.get("GET", "/b", "")).toBeNull();
    expect(cache.get("GET", "/a", "")?.body).toBe(body);
  });

  it("evicts the least recently used entry at the entry cap too", () => {
    const cache = new ResponseCache(2);
    cache.set("GET", "/a", "", ok("a"));
    cache.set("GET", "/b", "", ok("b"));
    cache.get("GET", "/a", "");
    cache.set("GET", "/c", "", ok("c"));
    expect(cache.get("GET", "/a", "")?.body).toBe("a");
    expect(cache.get("GET", "/b", "")).toBeNull();
  });

  it("never caches a single response larger than the whole budget", () => {
    const cache = new ResponseCache(500, 1_000);
    cache.set("GET", "/big", "", ok("x".repeat(2_000)));
    expect(cache.stats()).toMatchObject({ size: 0, bytes: 0 });
  });

  it("accounts bytes correctly on replace, invalidate and clear", () => {
    const cache = new ResponseCache();
    cache.set("GET", "/a", "", ok("1234"));
    const one = cache.stats().bytes;
    cache.set("GET", "/a", "", ok("1234"));
    expect(cache.stats().bytes).toBe(one);
    cache.invalidatePrefix("/a");
    expect(cache.stats().bytes).toBe(0);
    cache.set("GET", "/a", "", ok("1234"));
    cache.clear();
    expect(cache.stats().bytes).toBe(0);
  });
});

describe("ResponseCache honours a request's no-cache", () => {
  it.each([
    [{ "cache-control": "no-cache" }],
    [{ "Cache-Control": "max-age=0" }],
    [{ pragma: "no-cache" }],
  ])("misses on %o (browser hard refresh)", (headers) => {
    const cache = new ResponseCache();
    cache.set("GET", "/a", "", ok("a"));
    expect(cache.get("GET", "/a", "", headers)).toBeNull();
    expect(cache.get("GET", "/a", "")?.body).toBe("a");
  });
});

describe("ResponseCache invalidation by path segment", () => {
  it("drops the path, its queries and its children, but not sibling names", () => {
    const cache = new ResponseCache();
    for (const p of ["/users", "/users/5", "/users-archive", "/usersettings"]) cache.set("GET", p, "", ok(p));
    cache.set("GET", "/users", "page=2", ok("page2"));

    expect(cache.invalidatePrefix("/users")).toBe(3);
    expect(cache.get("GET", "/users-archive", "")?.body).toBe("/users-archive");
    expect(cache.get("GET", "/usersettings", "")?.body).toBe("/usersettings");
    expect(cache.get("GET", "/users/5", "")).toBeNull();
  });

  it("'/' invalidates everything", () => {
    const cache = new ResponseCache();
    cache.set("GET", "/a", "", ok("a"));
    cache.set("GET", "/b/c", "", ok("b"));
    expect(cache.invalidatePrefix("/")).toBe(2);
  });
});
