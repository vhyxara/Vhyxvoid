import { describe, it, expect, afterEach } from "vitest";
import { ResponseCache } from "../../packages/agent/src/cache/ResponseCache";
import { BackendProxy } from "../../packages/agent/src/proxy/BackendProxy";
import type { TunnelForwardMsg } from "../../packages/protocol/src/messages";
import { startFakeBackendServer, FakeBackendServer } from "./testHelpers";

// Context.md Known Risk #5, reproduced live on 2026-09-19 through the
// published agent: with a backend that answers a GET with
// `Cache-Control: max-age=60`, the agent cached the response under path+query
// alone, so a second caller with different credentials received the FIRST
// caller's response without the request ever reaching the backend.
//
// The cache key must therefore include the caller's credentials, and the agent
// (a shared intermediary between many callers) must not store responses that
// are per-user by construction (Set-Cookie, Vary: *) or that vary on other
// request headers the backend named.

const ttl = { "cache-control": "max-age=60" };
const ok = (body: string, headers: Record<string, string> = ttl) => ({
  status: 200,
  headers,
  body,
  bodyEncoding: "utf8" as const,
  durationMs: 1,
});

describe("ResponseCache — callers with different credentials", () => {
  it("does not hand one caller's cached response to a caller with a different cookie", () => {
    const cache = new ResponseCache();
    cache.set("GET", "/me", "", ok("alice's page"), { cookie: "session=alice" });

    expect(cache.get("GET", "/me", "", { cookie: "session=bob" })).toBeNull();
    expect(cache.get("GET", "/me", "", { cookie: "session=alice" })?.body).toBe("alice's page");
  });

  it("separates callers by Authorization", () => {
    const cache = new ResponseCache();
    cache.set("GET", "/data", "q=1", ok("A"), { authorization: "Bearer token-a" });

    expect(cache.get("GET", "/data", "q=1", { authorization: "Bearer token-b" })).toBeNull();
    expect(cache.get("GET", "/data", "q=1", { authorization: "Bearer token-a" })?.body).toBe("A");
  });

  it.each(["x-api-key", "x-auth-token", "api-key", "x-csrf-token", "x-session-id"])(
    "separates callers by the %s header",
    (name) => {
      const cache = new ResponseCache();
      cache.set("GET", "/data", "", ok("one"), { [name]: "value-1" });

      expect(cache.get("GET", "/data", "", { [name]: "value-2" })).toBeNull();
      expect(cache.get("GET", "/data", "", { [name]: "value-1" })?.body).toBe("one");
    },
  );

  it("does not serve an anonymous response to a credentialed caller, or the reverse", () => {
    const cache = new ResponseCache();
    cache.set("GET", "/home", "", ok("public"), {});

    expect(cache.get("GET", "/home", "", { cookie: "session=alice" })).toBeNull();
    expect(cache.get("GET", "/home", "", {})?.body).toBe("public");

    cache.set("GET", "/private", "", ok("secret"), { cookie: "session=alice" });
    expect(cache.get("GET", "/private", "", {})).toBeNull();
  });

  it("still shares a response between requests that send identical credentials, and ignores header name case", () => {
    const cache = new ResponseCache();
    cache.set("GET", "/x", "", ok("shared"), { Cookie: "s=1", "X-Trace": "a" });

    expect(cache.get("GET", "/x", "", { cookie: "s=1", "x-trace": "b" })?.body).toBe("shared");
  });

  it("never stores a response that sets a cookie", () => {
    const cache = new ResponseCache();
    cache.set("GET", "/login-page", "", ok("hi", { ...ttl, "set-cookie": "sid=abc" }), {});

    expect(cache.get("GET", "/login-page", "", {})).toBeNull();
  });

  it("never stores `Vary: *`, and honours the request headers a response varies on", () => {
    const cache = new ResponseCache();
    cache.set("GET", "/star", "", ok("x", { ...ttl, vary: "*" }), {});
    expect(cache.get("GET", "/star", "", {})).toBeNull();

    cache.set("GET", "/lang", "", ok("bonjour", { ...ttl, vary: "Accept-Language" }), { "accept-language": "fr" });
    expect(cache.get("GET", "/lang", "", { "accept-language": "en" })).toBeNull();
    expect(cache.get("GET", "/lang", "", { "accept-language": "fr" })?.body).toBe("bonjour");
  });

  it("keeps invalidatePrefix working for credentialed entries", () => {
    const cache = new ResponseCache();
    cache.set("GET", "/api/items", "", ok("a"), { cookie: "s=1" });
    cache.set("GET", "/api/items", "", ok("b"), { cookie: "s=2" });

    expect(cache.invalidatePrefix("/api")).toBe(2);
  });
});

// The same scenario the docs session reproduced through the published CLI, at
// the BackendProxy level: a real local HTTP server that counts its requests.
describe("BackendProxy — the live reproduction", () => {
  let backend: FakeBackendServer;
  let proxy: BackendProxy;
  let hits = 0;

  afterEach(async () => {
    proxy.stop();
    await backend.close();
  });

  async function setup() {
    hits = 0;
    backend = await startFakeBackendServer((req, res) => {
      hits++;
      res.setHeader("content-type", "text/plain");
      if (req.url?.startsWith("/cached")) res.setHeader("cache-control", "max-age=60");
      res.end(`hit#${hits} cookie=${req.headers.cookie ?? "none"}`);
    });
    proxy = new BackendProxy(backend.port);
  }

  const get = (path: string, headers: Record<string, string> = {}): TunnelForwardMsg => ({
    v: "1",
    type: "tunnel:forward",
    requestId: `req_${Math.random()}`,
    method: "GET",
    path,
    query: "",
    headers,
    body: null,
    timeoutMs: 5000,
  });

  it("gives a second caller with a different cookie their own response, from the backend", async () => {
    await setup();

    const alice1 = await proxy.forward(get("/cached", { cookie: "user=alice" }));
    const bob = await proxy.forward(get("/cached", { cookie: "user=bob" }));

    expect(alice1.body).toBe("hit#1 cookie=user=alice");
    expect(bob.body).toBe("hit#2 cookie=user=bob");
    expect(bob.headers["x-vhyxvoid-cache"]).toBe("MISS");
    expect(hits).toBe(2);
  });

  it("still serves a repeat request from the same caller out of the cache", async () => {
    await setup();

    await proxy.forward(get("/cached", { cookie: "user=alice" }));
    const again = await proxy.forward(get("/cached", { cookie: "user=alice" }));

    expect(again.headers["x-vhyxvoid-cache"]).toBe("HIT");
    expect(again.body).toBe("hit#1 cookie=user=alice");
    expect(hits).toBe(1);
  });
});
