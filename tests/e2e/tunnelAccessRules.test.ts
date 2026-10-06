// Tunnel access rules: IP allowlist, password (HTTP Basic), share links.
import { describe, expect, it } from "vitest";

import {
  evaluateTunnelAccess,
  hashTunnelPassword,
  ipAllowed,
  signShareToken,
  stripAccessCookie,
  validateAllowlist,
  verifyShareToken,
  type TunnelPolicyRecord,
} from "../../packages/shared/src/tunnelAccess";

const PEPPER = "pepper-0123456789";
const basic = (pw: string) => `Basic ${Buffer.from(`anyone:${pw}`).toString("base64")}`;
const policy = (over: Partial<TunnelPolicyRecord> = {}): TunnelPolicyRecord => ({
  accountId: "acc1",
  label: "app",
  passwordHash: hashTunnelPassword(PEPPER, "acc1", "app", "s3cret"),
  ipAllowlist: [],
  version: 1,
  ...over,
});

describe("IP allowlist", () => {
  it("matches addresses and CIDRs, v4 and v6", () => {
    const list = ["10.0.0.0/8", "203.0.113.7", "2001:db8::/32"];
    expect(ipAllowed(list, "10.1.2.3")).toBe(true);
    expect(ipAllowed(list, "::ffff:203.0.113.7")).toBe(true);
    expect(ipAllowed(list, "2001:db8::1")).toBe(true);
    expect(ipAllowed(list, "11.0.0.1")).toBe(false);
    expect(ipAllowed(list, null)).toBe(false);
    expect(ipAllowed([], null)).toBe(true);
  });

  it("validates entries", () => {
    expect(validateAllowlist(["1.2.3.4", "10.0.0.0/8", "::1"])).toBeUndefined();
    expect(validateAllowlist(["1.2.3.4/33"])).toMatch(/not an IP/);
    expect(validateAllowlist(["example.com"])).toMatch(/not an IP/);
  });
});

describe("share links", () => {
  const exp = new Date(Date.now() + 3600_000);

  it("verify until expiry, for this policy version only", () => {
    const t = signShareToken(PEPPER, { accountId: "acc1", label: "app", version: 1, expiresAt: exp });
    expect(verifyShareToken(PEPPER, policy(), t)).toBeGreaterThan(3500);
    expect(verifyShareToken(PEPPER, policy({ version: 2 }), t)).toBe(0); // revoked
    expect(verifyShareToken(PEPPER, policy({ label: "other" }), t)).toBe(0);
    expect(verifyShareToken(PEPPER, policy(), t, exp.getTime() + 1000)).toBe(0); // expired
    expect(verifyShareToken(PEPPER, policy(), t.slice(0, -2) + "xx")).toBe(0); // tampered
  });
});

describe("evaluateTunnelAccess", () => {
  const req = (over = {}) => ({ ip: "1.1.1.1", url: "/", ...over });

  it("no policy: public", () => {
    expect(evaluateTunnelAccess(null, req(), PEPPER)).toEqual({ allow: true, stripAuthorization: false });
  });

  it("password: Basic credentials pass and are stripped; wrong or missing is 401", () => {
    expect(evaluateTunnelAccess(policy(), req({ authorization: basic("s3cret") }), PEPPER)).toEqual({ allow: true, stripAuthorization: true });
    expect(evaluateTunnelAccess(policy(), req({ authorization: basic("nope") }), PEPPER)).toMatchObject({ allow: false, status: 401 });
    expect(evaluateTunnelAccess(policy(), req(), PEPPER)).toMatchObject({ allow: false, status: 401 });
  });

  it("a share token in the URL redirects to the clean URL with a cookie; the cookie then passes", () => {
    const t = signShareToken(PEPPER, { accountId: "acc1", label: "app", version: 1, expiresAt: new Date(Date.now() + 60_000) });
    const d = evaluateTunnelAccess(policy(), req({ url: `/page?x=1&vv_share=${t}` }), PEPPER);
    expect(d).toMatchObject({ allow: false, status: 302, location: "/page?x=1", cookie: { value: t } });
    expect(evaluateTunnelAccess(policy(), req({ cookie: `a=1; vv_access=${t}` }), PEPPER)).toMatchObject({ allow: true, stripAuthorization: false });
  });

  it("the IP allowlist applies even with the password", () => {
    const p = policy({ ipAllowlist: ["10.0.0.0/8"] });
    expect(evaluateTunnelAccess(p, req({ authorization: basic("s3cret") }), PEPPER)).toMatchObject({ allow: false, status: 403 });
    expect(evaluateTunnelAccess(p, req({ ip: "10.9.9.9", authorization: basic("s3cret") }), PEPPER)).toMatchObject({ allow: true });
    expect(evaluateTunnelAccess(policy({ passwordHash: null, ipAllowlist: ["10.0.0.0/8"] }), req({ ip: "10.0.0.1" }), PEPPER)).toMatchObject({ allow: true });
  });

  it("the tunnel cookie is not forwarded", () => {
    expect(stripAccessCookie("a=1; vv_access=tok; b=2")).toBe("a=1; b=2");
    expect(stripAccessCookie("vv_access=tok")).toBeUndefined();
  });
});
