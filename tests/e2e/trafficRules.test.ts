// Traffic rules engine (packages/shared/src/trafficRules.ts): matching,
// evaluation order, rewrites, validation.
import { describe, expect, it } from "vitest";

import {
  applyResponseHeaders,
  describeTrafficRule,
  evaluateTrafficRules,
  pathPatternRegex,
  rewritePath,
  trafficRuleProblem,
  trafficRulesProblem,
  type TrafficRule,
} from "../../packages/shared/src/trafficRules";

let n = 0;
const rule = (over: Partial<TrafficRule> & Pick<TrafficRule, "action">): TrafficRule => ({
  id: `r${++n}`,
  name: `rule ${n}`,
  enabled: true,
  when: "always",
  match: { path: "*" },
  ...over,
});
const req = (method: string, path: string, headers: Record<string, string> = {}) => ({ method, path, headers });

describe("matching", () => {
  it("paths: exact, prefix star, middle star, any; never the query", () => {
    expect(pathPatternRegex("/api/users").test("/api/users")).toBe(true);
    expect(pathPatternRegex("/api/users").test("/api/users/1")).toBe(false);
    expect(pathPatternRegex("/api/*").test("/api/users/1")).toBe(true);
    expect(pathPatternRegex("/a/*/b").test("/a/x/y/b")).toBe(true);
    expect(pathPatternRegex("/v1.0/*").test("/v1x0/a")).toBe(false); // dots are literal
    const r = rule({ match: { path: "/health" }, action: { type: "mock", status: 200 } });
    expect(evaluateTrafficRules([r], req("GET", "/health?x=1"), { online: true }).respond?.status).toBe(200);
  });

  it("methods and headers", () => {
    const r = rule({ match: { path: "*", methods: ["POST"], header: { name: "X-Mock", value: "yes" } }, action: { type: "mock", status: 201 } });
    expect(evaluateTrafficRules([r], req("GET", "/"), { online: true }).respond).toBeNull();
    expect(evaluateTrafficRules([r], req("POST", "/", { "x-mock": "no" }), { online: true }).respond).toBeNull();
    expect(evaluateTrafficRules([r], req("POST", "/", { "x-mock": "YES" }), { online: true }).respond?.status).toBe(201);
  });
});

describe("evaluation", () => {
  it("changes add up until the first answering rule; later rules are not reached", () => {
    const rules = [
      rule({ action: { type: "delay", ms: 200 } }),
      rule({ action: { type: "responseHeaders", set: { "Access-Control-Allow-Origin": "*" } } }),
      rule({ match: { path: "/old/*" }, action: { type: "rewrite", to: "/new" } }),
      rule({ match: { path: "/new/*" }, action: { type: "requestHeaders", set: { "X-Env": "preview" }, remove: ["Cookie"] } }),
      rule({ match: { path: "/new/stop" }, action: { type: "mock", status: 418, body: "teapot" } }),
      rule({ action: { type: "mock", status: 500 } }),
    ];
    const p = evaluateTrafficRules(rules, req("GET", "/old/x?q=1"), { online: true });
    // /new/x is not /new/stop, so the catch-all 500 (last) answers; without it nothing answers.
    const p2 = evaluateTrafficRules(rules.slice(0, 5), req("GET", "/old/x?q=1"), { online: true });
    expect(p2).toMatchObject({ delayMs: 200, path: "/new/x?q=1", setRequestHeaders: { "x-env": "preview" }, removeRequestHeaders: ["cookie"], setResponseHeaders: { "access-control-allow-origin": "*" }, respond: null });
    const p3 = evaluateTrafficRules(rules, req("GET", "/old/stop"), { online: true });
    expect(p3.respond).toMatchObject({ status: 418, body: "teapot", kind: "mock" });
    expect(p.respond?.status).toBe(500);
  });

  it("fail fires for its percentage only", () => {
    const r = rule({ action: { type: "fail", status: 503, percent: 25 } });
    expect(evaluateTrafficRules([r], req("GET", "/"), { online: true, random: () => 0.1 }).respond?.status).toBe(503);
    expect(evaluateTrafficRules([r], req("GET", "/"), { online: true, random: () => 0.3 }).respond).toBeNull();
  });

  it("offline rules apply only without an agent; disabled rules never", () => {
    const off = rule({ when: "offline", action: { type: "mock", status: 200, body: "we are back soon" } });
    const disabled = rule({ enabled: false, action: { type: "mock", status: 500 } });
    expect(evaluateTrafficRules([disabled, off], req("GET", "/"), { online: true }).respond).toBeNull();
    expect(evaluateTrafficRules([disabled, off], req("GET", "/"), { online: false }).respond?.body).toBe("we are back soon");
  });

  it("redirects can carry the original path; delay is capped", () => {
    const r = rule({ action: { type: "redirect", status: 302, location: "https://staging.acme.dev{path}" } });
    expect(evaluateTrafficRules([r], req("GET", "/a?b=1"), { online: true }).respond?.headers.location).toBe("https://staging.acme.dev/a?b=1");
    const d = evaluateTrafficRules([rule({ action: { type: "delay", ms: 25_000 } }), rule({ action: { type: "delay", ms: 25_000 } })], req("GET", "/"), { online: true });
    expect(d.delayMs).toBe(30_000);
  });

  it("rewrites keep the rest of the path and the query", () => {
    expect(rewritePath("/api/v1/*", "/v2", "/api/v1/users/7?x=1")).toBe("/v2/users/7?x=1");
    expect(rewritePath("/api/v1/*", "/v2/", "/api/v1/")).toBe("/v2/");
    expect(rewritePath("/old", "/new", "/old?a=b")).toBe("/new?a=b");
  });

  it("response headers replace case-insensitively", () => {
    const h: Record<string, string | string[]> = { "Content-Type": "text/html", "X-Powered-By": "Express" };
    applyResponseHeaders(h, { setResponseHeaders: { "content-type": "application/json" }, removeResponseHeaders: ["x-powered-by"] });
    expect(h).toEqual({ "content-type": "application/json" });
  });
});

describe("validation", () => {
  const ok = rule({ match: { path: "/api/*", methods: ["GET"] }, action: { type: "mock", status: 200, headers: { "Content-Type": "application/json" }, body: "{}" } });

  it("accepts good rules and describes them", () => {
    expect(trafficRuleProblem(ok)).toBeUndefined();
    expect(describeTrafficRule(ok)).toBe("GET /api/* → answer 200");
  });

  it("refuses bad shapes with messages a user can act on", () => {
    expect(trafficRuleProblem({ ...ok, match: { path: "api" } })).toMatch(/must start with \//);
    expect(trafficRuleProblem({ ...ok, action: { type: "mock", status: 99 } })).toMatch(/status/);
    expect(trafficRuleProblem({ ...ok, action: { type: "mock", status: 200, headers: { "Content-Length": "1" } } })).toMatch(/managed by VhyxVoid/);
    expect(trafficRuleProblem({ ...ok, action: { type: "requestHeaders", set: { "X-A": "a\r\nInjected: 1" } } })).toMatch(/line breaks/);
    expect(trafficRuleProblem({ ...ok, action: { type: "mock", status: 200, body: "x".repeat(70_000) } })).toMatch(/64 KB/);
    expect(trafficRuleProblem({ ...ok, when: "offline", action: { type: "delay", ms: 10 } })).toMatch(/offline tunnel can only answer/);
    expect(trafficRuleProblem({ ...ok, action: { type: "redirect", status: 302, location: "javascript:alert(1)" } })).toMatch(/location/);
    expect(trafficRuleProblem({ ...ok, action: { type: "fail", status: 503, percent: 0 } })).toMatch(/percent/);
    expect(trafficRuleProblem({ ...ok, action: { type: "nope" } })).toMatch(/unknown action/);
  });

  it("list checks: plan limit, duplicate ids", () => {
    expect(trafficRulesProblem([ok], 0)).toMatch(/not available on this plan/);
    expect(trafficRulesProblem([ok, { ...ok }], 5)).toMatch(/share the id/);
    expect(trafficRulesProblem([ok], 5)).toBeUndefined();
  });
});
