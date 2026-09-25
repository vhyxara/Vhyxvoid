import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanupThenReraise } from "../../packages/middleware/src/tunnel";
import { withVhyxvoid } from "../../packages/next/src/index";

// Audit part2 G6: @vhyxvoid/middleware's process.once('SIGINT'/'SIGTERM')
// replaced Node's default exit, so a plain Express app needed two Ctrl+C and
// `docker stop` hung until SIGKILL. The handler now re-raises the signal when
// nobody else listens.
describe("cleanupThenReraise", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cleans up, then re-raises the signal when no other listener exists", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const cleanup = vi.fn();
    const before = process.listeners("SIGUSR2");
    process.removeAllListeners("SIGUSR2");
    try {
      cleanupThenReraise(cleanup, "SIGUSR2");
    } finally {
      for (const l of before) process.on("SIGUSR2", l);
    }
    expect(cleanup).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGUSR2");
  });

  it("leaves shutdown to the app when it has its own handler", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const appHandler = () => {};
    process.on("SIGUSR2", appHandler);
    try {
      cleanupThenReraise(vi.fn(), "SIGUSR2");
    } finally {
      process.off("SIGUSR2", appHandler);
    }
    expect(kill).not.toHaveBeenCalled();
  });
});

// shared backlog, 2026-09-25: @vhyxvoid/next started the tunnel under
// `next dev` even with CI=true; @vhyxvoid/middleware already skipped CI.
describe("@vhyxvoid/next on CI", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    CI: process.env.CI,
    VHYXVOID_API_KEY: process.env.VHYXVOID_API_KEY,
    VHYXVOID_SECRET: process.env.VHYXVOID_SECRET,
  };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("does not start in development when CI is set, unless enabled: true", () => {
    process.env.NODE_ENV = "development";
    process.env.CI = "true";
    delete process.env.VHYXVOID_API_KEY;
    delete process.env.VHYXVOID_SECRET;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    withVhyxvoid({}, {});
    // Not started: the missing-credentials warning never printed.
    expect(warn).not.toHaveBeenCalled();

    withVhyxvoid({}, { enabled: true });
    expect(warn.mock.calls.some((c) => String(c[0]).includes("missing credentials"))).toBe(true);
  });
});
