import { describe, it, expect, afterEach } from "vitest";
import { resolveConfig } from "../../packages/middleware/src/config";

// Audit part2 G7 (shared/audit-2026-09-24-part2.md): @vhyxvoid/middleware
// enabled the tunnel whenever NODE_ENV was not "production", so a staging
// server, a CI runner or a container with NODE_ENV unset (or "test",
// "staging") that happened to have VHYXVOID_API_KEY/SECRET in its environment
// silently exposed itself on a public URL. It now matches @vhyxvoid/next: on
// only when NODE_ENV is "development", never on CI unless forced, and
// `enabled: true` forces it on anywhere.

const saved = { NODE_ENV: process.env.NODE_ENV, CI: process.env.CI };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function envWith(nodeEnv: string | undefined, ci?: string) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  if (ci === undefined) delete process.env.CI;
  else process.env.CI = ci;
}

describe("@vhyxvoid/middleware enabled default", () => {
  it("is on when NODE_ENV is development", () => {
    envWith("development");
    expect(resolveConfig().enabled).toBe(true);
  });

  it.each([
    ["unset", undefined],
    ["test", "test"],
    ["staging", "staging"],
    ["production", "production"],
  ])("is off when NODE_ENV is %s", (_label, value) => {
    envWith(value);
    expect(resolveConfig().enabled).toBe(false);
  });

  it("is off on CI even in development", () => {
    envWith("development", "true");
    expect(resolveConfig().enabled).toBe(false);
  });

  it("treats CI=1 like CI=true, and CI=false as not CI", () => {
    envWith("development", "1");
    expect(resolveConfig().enabled).toBe(false);
    envWith("development", "false");
    expect(resolveConfig().enabled).toBe(true);
  });

  it("enabled: true forces it on anywhere, including CI", () => {
    envWith(undefined, "true");
    expect(resolveConfig({ enabled: true }).enabled).toBe(true);
    envWith("production");
    expect(resolveConfig({ enabled: true }).enabled).toBe(true);
  });

  it("enabled: false forces it off in development", () => {
    envWith("development");
    expect(resolveConfig({ enabled: false }).enabled).toBe(false);
  });
});
