// Pure logic for custom domains (validation, DNS verification) and alerts
// (which subjects fire, what changed).
import { describe, expect, it } from "vitest";

import {
  checkCustomDomain,
  diffAlertStates,
  errorRateSubjects,
  offlineSubjects,
  staticDnsResolver,
  usageSubject,
  validateCustomHostname,
  verificationRecord,
} from "../../packages/shared/src";

describe("validateCustomHostname", () => {
  const ok = (h: string, test = false) => validateCustomHostname(h, "vhyxvoid.com", test);
  it("normalises", () => {
    expect(ok("  HTTPS://Api.Example.COM./path ")).toEqual({ ok: true, hostname: "api.example.com" });
    expect(ok("bücher.example")).toMatchObject({ ok: false }); // reserved TLD "example"
    expect(ok("bücher.de")).toEqual({ ok: true, hostname: "xn--bcher-kva.de" });
  });
  it("refuses what cannot work", () => {
    for (const bad of ["", "localhost", "example", "1.2.3.4", "api.example.com:8080", "*.example.com", "-bad.example.com", "a..b.com", "x.vhyxvoid.com", "vhyxvoid.com", "app.local", "a.test"]) {
      expect(ok(bad).ok, bad).toBe(false);
    }
  });
  it(".test only when allowed", () => {
    expect(ok("app.example.test", true)).toEqual({ ok: true, hostname: "app.example.test" });
  });
});

describe("checkCustomDomain", () => {
  const token = "tok123";
  const txt = verificationRecord("api.acme.dev", token);

  it("verified by TXT, routed by CNAME", async () => {
    const r = await checkCustomDomain(
      staticDnsResolver({ [txt.name]: { TXT: ["other", txt.value] }, "api.acme.dev": { CNAME: ["Edge.VhyxVoid.com."] } }),
      "api.acme.dev",
      token,
      "edge.vhyxvoid.com",
    );
    expect(r).toMatchObject({ verified: true, routed: true, error: null });
  });

  it("routed by matching addresses (apex / flattened records)", async () => {
    const r = await checkCustomDomain(
      staticDnsResolver({ "acme.dev": { A: ["203.0.113.9"] }, "edge.vhyxvoid.com": { A: ["203.0.113.9"] } }),
      "acme.dev",
      token,
      "edge.vhyxvoid.com",
    );
    expect(r).toMatchObject({ verified: false, routed: true });
  });

  it("nothing set up", async () => {
    const r = await checkCustomDomain(staticDnsResolver({}), "api.acme.dev", token, "edge.vhyxvoid.com");
    expect(r).toMatchObject({ verified: false, routed: false, error: null });
  });

  it("a resolver failure is reported, not thrown", async () => {
    const broken = { ...staticDnsResolver({}), resolveTxt: () => Promise.reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })) };
    const r = await checkCustomDomain(broken, "api.acme.dev", token, "edge.vhyxvoid.com");
    expect(r.error).toMatch(/timeout/);
  });
});

describe("alert evaluation", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000);
  const rule = (over = {}) => ({ type: "TUNNEL_OFFLINE" as const, label: null, threshold: null, windowMinutes: 5, minRequests: null, ...over });

  it("offline: after the window, recent tunnels only unless named", () => {
    const tunnels = [
      { label: "api", connected: false, lastDisconnectedAt: ago(6) },
      { label: "web", connected: false, lastDisconnectedAt: ago(2) },
      { label: "old", connected: false, lastDisconnectedAt: ago(60 * 48) },
      { label: "up", connected: true, lastDisconnectedAt: null },
    ];
    expect(offlineSubjects(rule(), tunnels, now)).toEqual(["api"]);
    expect(offlineSubjects(rule({ label: "old" }), tunnels, now)).toEqual(["old"]);
  });

  it("error rate: threshold and minimum volume", () => {
    const stats = [
      { label: "a", requests: 100, errors5xx: 12 },
      { label: "b", requests: 10, errors5xx: 10 },
      { label: "c", requests: 100, errors5xx: 3 },
    ];
    expect(errorRateSubjects({ ...rule(), type: "ERROR_RATE", threshold: 10, minRequests: 20 }, stats)).toEqual([{ label: "a", requests: 100, errors: 12, rate: 12 }]);
  });

  it("usage: once per month and threshold", () => {
    expect(usageSubject({ ...rule(), type: "USAGE", threshold: 80 }, 8_000, 10_000, now)).toEqual({ subject: "usage:2026-10:80", percent: 80 });
    expect(usageSubject({ ...rule(), type: "USAGE", threshold: 80 }, 7_999, 10_000, now)).toBeNull();
    expect(usageSubject({ ...rule(), type: "USAGE", threshold: 80 }, 1e9, Infinity, now)).toBeNull();
  });

  it("diff: fire new, resolve recovered, stay quiet otherwise", () => {
    expect(diffAlertStates([{ subject: "a", firing: true }, { subject: "b", firing: true }, { subject: "c", firing: false }], ["b", "c", "d"])).toEqual({
      fire: ["c", "d"],
      resolve: ["a"],
    });
  });
});
