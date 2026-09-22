import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicPathUsageLimiter } from "../../apps/hub/src/services/PublicPathUsageLimiter.service";
import { PUBLIC_USAGE_SENTINEL } from "../../packages/shared/src/publicUsage";

// Covers shared/decision.md, 2026-09-22, "S5 investigation and proposal",
// Part 2: per-account rate limiting and usage counting for the public
// tunnel-URL path (E3), which has no API key to hang either mechanism on.
// Approved numbers: FREE 100/min, PRO 3,000/min, ENTERPRISE unlimited.

type AccountFixture = { status?: string; plan?: string | null };

function makeFakeSessionRepo(
  accounts: Record<string, AccountFixture>,
  opts: { failFor?: Set<string> } = {},
) {
  return {
    findPlanLimitsForAccount: vi.fn(async (accountId: string) => {
      if (opts.failFor?.has(accountId)) throw new Error("db down");
      const plan = accounts[accountId]?.plan ?? "FREE";
      return { plan, maxAgents: plan === "FREE" ? 1 : plan === "PRO" ? 5 : Infinity };
    }),
  } as any;
}

function makeFakeUsageService() {
  return { increment: vi.fn() } as any;
}

afterEach(() => vi.restoreAllMocks());

describe("PublicPathUsageLimiter — per-minute abuse limiter", () => {
  it("FREE allows 100 requests/min and refuses the 101st", async () => {
    const sessionRepo = makeFakeSessionRepo({ free1: { plan: "FREE" } });
    const limiter = new PublicPathUsageLimiter(sessionRepo, makeFakeUsageService());

    for (let i = 1; i <= 100; i++) {
      const r = await limiter.checkRequest("free1");
      expect(r.allowed, `request ${i}`).toBe(true);
      expect(r.limitPerMinute).toBe(100);
    }
    const refused = await limiter.checkRequest("free1");
    expect(refused.allowed).toBe(false);
    expect(refused.limitPerMinute).toBe(100);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("PRO allows 3,000 requests/min and refuses the 3,001st", async () => {
    const sessionRepo = makeFakeSessionRepo({ pro1: { plan: "PRO" } });
    const limiter = new PublicPathUsageLimiter(sessionRepo, makeFakeUsageService());

    for (let i = 1; i <= 3000; i++) {
      const r = await limiter.checkRequest("pro1");
      expect(r.allowed, `request ${i}`).toBe(true);
    }
    const refused = await limiter.checkRequest("pro1");
    expect(refused.allowed).toBe(false);
    expect(refused.limitPerMinute).toBe(3000);
  });

  it("ENTERPRISE has no limit (well past both FREE's and PRO's caps)", async () => {
    const sessionRepo = makeFakeSessionRepo({ ent1: { plan: "ENTERPRISE" } });
    const limiter = new PublicPathUsageLimiter(sessionRepo, makeFakeUsageService());

    for (let i = 1; i <= 4000; i++) {
      const r = await limiter.checkRequest("ent1");
      expect(r.allowed, `request ${i}`).toBe(true);
    }
  });

  it("limits are per account: FREE's cap does not bleed into PRO's headroom or vice versa", async () => {
    const sessionRepo = makeFakeSessionRepo({
      free1: { plan: "FREE" },
      pro1: { plan: "PRO" },
    });
    const limiter = new PublicPathUsageLimiter(sessionRepo, makeFakeUsageService());

    for (let i = 1; i <= 100; i++) await limiter.checkRequest("free1");
    expect((await limiter.checkRequest("free1")).allowed).toBe(false);
    // pro1 is untouched by free1 having exhausted its own limit
    expect((await limiter.checkRequest("pro1")).allowed).toBe(true);
  });

  it("the per-minute counter resets on the next minute bucket", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T10:00:59.000Z"));
    const sessionRepo = makeFakeSessionRepo({ free1: { plan: "FREE" } });
    const limiter = new PublicPathUsageLimiter(sessionRepo, makeFakeUsageService());

    for (let i = 1; i <= 100; i++) await limiter.checkRequest("free1");
    expect((await limiter.checkRequest("free1")).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-09-22T10:01:00.000Z"));
    expect((await limiter.checkRequest("free1")).allowed).toBe(true);

    vi.useRealTimers();
  });

  it("if the plan lookup fails, the PRO limit applies and the failure is logged", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const sessionRepo = makeFakeSessionRepo(
      { free1: { plan: "FREE" } },
      { failFor: new Set(["free1"]) },
    );
    const limiter = new PublicPathUsageLimiter(sessionRepo, makeFakeUsageService());

    const r = await limiter.checkRequest("free1");
    expect(r.limitPerMinute).toBe(3000); // PRO's number, not FREE's 100
    expect(
      errors.mock.calls.some((c) => String(c[1]).includes("plan lookup failed")),
    ).toBe(true);
  });
});

describe("PublicPathUsageLimiter — batched monthly counter", () => {
  it("an allowed request is accumulated in-process, not written to Redis until flush()", async () => {
    const sessionRepo = makeFakeSessionRepo({ free1: { plan: "FREE" } });
    const usageService = makeFakeUsageService();
    const limiter = new PublicPathUsageLimiter(sessionRepo, usageService);

    await limiter.checkRequest("free1");
    await limiter.checkRequest("free1");
    expect(usageService.increment).not.toHaveBeenCalled();

    limiter.flush();
    expect(usageService.increment).toHaveBeenCalledTimes(1);
    expect(usageService.increment).toHaveBeenCalledWith(
      "free1",
      PUBLIC_USAGE_SENTINEL,
      "requests",
      2,
    );
  });

  it("a 429'd (refused) request does NOT count toward the monthly usage", async () => {
    const sessionRepo = makeFakeSessionRepo({ free1: { plan: "FREE" } });
    const usageService = makeFakeUsageService();
    const limiter = new PublicPathUsageLimiter(sessionRepo, usageService);

    for (let i = 1; i <= 101; i++) await limiter.checkRequest("free1"); // 100 allowed, 1 refused

    limiter.flush();
    expect(usageService.increment).toHaveBeenCalledWith(
      "free1",
      PUBLIC_USAGE_SENTINEL,
      "requests",
      100,
    );
  });

  it("flush() clears the accumulator — a second flush with nothing new sends nothing", async () => {
    const sessionRepo = makeFakeSessionRepo({ free1: { plan: "FREE" } });
    const usageService = makeFakeUsageService();
    const limiter = new PublicPathUsageLimiter(sessionRepo, usageService);

    await limiter.checkRequest("free1");
    limiter.flush();
    expect(usageService.increment).toHaveBeenCalledTimes(1);

    limiter.flush();
    expect(usageService.increment).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it("accumulates separately per account and flushes each with its own delta", async () => {
    const sessionRepo = makeFakeSessionRepo({
      free1: { plan: "FREE" },
      pro1: { plan: "PRO" },
    });
    const usageService = makeFakeUsageService();
    const limiter = new PublicPathUsageLimiter(sessionRepo, usageService);

    await limiter.checkRequest("free1");
    await limiter.checkRequest("pro1");
    await limiter.checkRequest("pro1");

    limiter.flush();
    expect(usageService.increment).toHaveBeenCalledWith("free1", PUBLIC_USAGE_SENTINEL, "requests", 1);
    expect(usageService.increment).toHaveBeenCalledWith("pro1", PUBLIC_USAGE_SENTINEL, "requests", 2);
  });

  it("ENTERPRISE (unlimited) requests still count toward the monthly usage", async () => {
    const sessionRepo = makeFakeSessionRepo({ ent1: { plan: "ENTERPRISE" } });
    const usageService = makeFakeUsageService();
    const limiter = new PublicPathUsageLimiter(sessionRepo, usageService);

    await limiter.checkRequest("ent1");
    await limiter.checkRequest("ent1");
    await limiter.checkRequest("ent1");

    limiter.flush();
    expect(usageService.increment).toHaveBeenCalledWith("ent1", PUBLIC_USAGE_SENTINEL, "requests", 3);
  });
});

describe("PublicPathUsageLimiter — start()/stop()", () => {
  it("start() schedules a periodic flush; stop() clears it (no dangling timer)", async () => {
    vi.useFakeTimers();
    const sessionRepo = makeFakeSessionRepo({ free1: { plan: "FREE" } });
    const usageService = makeFakeUsageService();
    const limiter = new PublicPathUsageLimiter(sessionRepo, usageService);

    limiter.start();
    await limiter.checkRequest("free1");

    vi.advanceTimersByTime(30_000);
    expect(usageService.increment).toHaveBeenCalledTimes(1);

    limiter.stop();
    await limiter.checkRequest("free1");
    vi.advanceTimersByTime(60_000);
    // No new flush happened after stop() — still just the one call from before.
    expect(usageService.increment).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
