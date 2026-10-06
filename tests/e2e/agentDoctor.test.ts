// `vhyxvoid doctor` (roadmap #5): each check, with fake network seams.
import { describe, expect, it } from "vitest";

import { apiOrigin, checkCredentials, checkDomain, checkNode, formatResults, hubOrigin, runDoctor, type DoctorDeps } from "../../packages/agent/src/doctor";

const KEY = "vhyxvoid_dev_0123456789abcdef0123456789abcdef";
const SECRET = "a".repeat(64);

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    nodeVersion: "v20.11.0",
    env: {},
    tcpConnect: async () => {},
    httpStatus: async () => 200,
    resolve: async (h) => (h === "edge.vhyxvoid.com" ? ["1.2.3.4"] : ["9.9.9.9"]),
    resolveCname: async () => [],
    fetchJson: async () => ({ data: { "tunnels.customDomainTarget": "edge.vhyxvoid.com" } }),
    signIn: async () => ({ ok: true }),
    ...over,
  };
}

const base = { key: KEY, secret: SECRET, label: "web", port: 3000, hub: "wss://hub.vhyxvoid.com/agent" };

describe("vhyxvoid doctor", () => {
  it("node and credential checks", () => {
    expect(checkNode("v16.20.0").status).toBe("fail");
    expect(checkNode("v22.1.0").status).toBe("ok");
    const bad = checkCredentials({ key: "sk_live_x", secret: "", label: "Bad Label!" });
    expect(bad.map((r) => r.status)).toEqual(["fail", "fail", "fail"]);
    expect(checkCredentials({ key: "vhyxvoid_live_0123456789abcdef0123456789abcdef", secret: SECRET, label: "web" }).every((r) => r.status === "ok")).toBe(true);
  });

  it("derives the hub's https origin and the api next to it", () => {
    const hub = hubOrigin("wss://hub.vhyxvoid.com/agent")!;
    expect(hub.origin).toBe("https://hub.vhyxvoid.com");
    expect(apiOrigin(hub, {})).toBe("https://api.vhyxvoid.com");
    expect(apiOrigin(hub, { VHYXVOID_API_URL: "http://localhost:9100/" })).toBe("http://localhost:9100");
    expect(hubOrigin("https://hub.vhyxvoid.com")).toBeNull();
  });

  it("all good: no failures, sign-in skipped without --connect", async () => {
    const r = await runDoctor(base, deps());
    expect(r.filter((x) => x.status === "fail")).toEqual([]);
    expect(r.find((x) => x.name === "Sign-in")?.status).toBe("skip");
    expect(formatResults(r)).toContain("Everything looks good.");
  });

  it("names the problem and the fix", async () => {
    const r = await runDoctor(
      { ...base, connect: true },
      deps({
        tcpConnect: async () => {
          throw new Error("ECONNREFUSED");
        },
        signIn: async () => ({ ok: false, code: "KEY_REVOKED", message: "API key has been revoked" }),
        env: { HTTPS_PROXY: "http://user:pw@proxy:3128" },
      }),
    );
    const byName = Object.fromEntries(r.map((x) => [x.name, x]));
    expect(byName["Local server"].status).toBe("fail");
    expect(byName["Sign-in"]).toMatchObject({ status: "fail", fix: expect.stringContaining("Create a new one") });
    expect(byName["Proxy"].detail).not.toContain("pw"); // credentials masked
    expect(formatResults(r)).toMatch(/2 problems to fix/);
  });

  it("an agent limit means the key works", async () => {
    const r = await runDoctor({ ...base, connect: true }, deps({ signIn: async () => ({ ok: false, code: "AGENT_LIMIT_REACHED", message: "x" }) }));
    expect(r.find((x) => x.name === "Sign-in")?.status).toBe("warn");
  });

  it("custom domain: CNAME, A record at the target, wrong target, missing", async () => {
    expect((await checkDomain("api.acme.dev", "edge.vhyxvoid.com", deps({ resolveCname: async () => ["edge.vhyxvoid.com."] }))).status).toBe("ok");
    expect((await checkDomain("acme.dev", "edge.vhyxvoid.com", deps({ resolve: async () => ["1.2.3.4"] }))).status).toBe("ok");
    const wrong = await checkDomain("api.acme.dev", "edge.vhyxvoid.com", deps({ resolveCname: async () => ["acme.netlify.app"] }));
    expect(wrong).toMatchObject({ status: "fail", fix: expect.stringContaining("CNAME api.acme.dev → edge.vhyxvoid.com") });
    const none = await checkDomain("x.acme.dev", "edge.vhyxvoid.com", deps({ resolve: async () => [], resolveCname: async () => [] }));
    expect(none.status).toBe("fail");
  });

  it("reads the domain target from the public settings when not given", async () => {
    const r = await runDoctor({ ...base, domain: "api.acme.dev" }, deps({ resolveCname: async () => ["edge.vhyxvoid.com"] }));
    expect(r.find((x) => x.name === "Domain api.acme.dev")?.status).toBe("ok");
  });
});
