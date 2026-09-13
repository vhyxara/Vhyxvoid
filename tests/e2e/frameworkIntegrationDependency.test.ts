import { describe, it, expect } from "vitest";
import { vhyxvoid } from "../../packages/middleware/src/index";
import { withVhyxvoid } from "../../packages/next/src/index";

// Covers context.md risk #15: packages/middleware and packages/next both
// imported AgentClient from "@vhyxvoid/agent" without declaring it as a
// real dependency in package.json, which broke `tsc -b` for both from a
// clean install ("'disableQueue' does not exist in type 'AgentConfig'" —
// confirmed 2026-09-13, see decision.md). Fixed by declaring
// "@vhyxvoid/agent": "workspace:*" in both package.json files.
//
// IMPORTANT SCOPE NOTE: vitest transpiles TypeScript via esbuild and does
// NOT type-check — a regression of the missing-dependency bug (which was a
// pure type-resolution failure, not a runtime one; esbuild bundles
// AgentClient's code directly into dist/ regardless of the dependency
// declaration) would NOT be caught by this test alone. The actual
// regression guard for the type-level bug is CI's build step
// (.github/workflows/ci.yml runs `tsc -b` for both packages via their own
// build scripts, now un-excluded). This test instead covers the runtime
// behavior: importing and invoking each package's public wrapper against
// a real @vhyxvoid/agent resolution, with no credentials configured, must
// not throw and must take the documented safe/no-op path.
describe("packages/middleware — vhyxvoid()", () => {
  it("imports and runs without throwing when no credentials are configured", () => {
    const originalKey = process.env.VHYXVOID_API_KEY;
    const originalSecret = process.env.VHYXVOID_SECRET;
    delete process.env.VHYXVOID_API_KEY;
    delete process.env.VHYXVOID_SECRET;

    try {
      const middleware = vhyxvoid({ enabled: true });
      // Express middleware signature: (req, res, next) => void
      expect(typeof middleware).toBe("function");

      let nextCalled = false;
      middleware({} as any, {} as any, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    } finally {
      if (originalKey !== undefined) process.env.VHYXVOID_API_KEY = originalKey;
      if (originalSecret !== undefined) process.env.VHYXVOID_SECRET = originalSecret;
    }
  });
});

describe("packages/next — withVhyxvoid()", () => {
  it("imports and runs without throwing when no credentials are configured, returning the config unchanged", () => {
    const originalKey = process.env.VHYXVOID_API_KEY;
    const originalSecret = process.env.VHYXVOID_SECRET;
    delete process.env.VHYXVOID_API_KEY;
    delete process.env.VHYXVOID_SECRET;

    try {
      const nextConfig = { reactStrictMode: true };
      const result = withVhyxvoid(nextConfig, { enabled: true });

      expect(result).toBe(nextConfig);
    } finally {
      if (originalKey !== undefined) process.env.VHYXVOID_API_KEY = originalKey;
      if (originalSecret !== undefined) process.env.VHYXVOID_SECRET = originalSecret;
    }
  });
});
