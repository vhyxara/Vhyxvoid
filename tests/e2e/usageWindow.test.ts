// Audit M21: usage endpoints must refuse unbounded ranges.
import { describe, expect, it } from "vitest";

import { assertUsageWindow, MAX_USAGE_WINDOW_DAYS } from "../../apps/api/src/core/utils/usageWindow";

const DAY = 24 * 60 * 60 * 1000;
const to = new Date("2026-10-05T00:00:00Z");

describe("assertUsageWindow", () => {
  it("accepts the dashboard's 90-day preset", () => {
    expect(() => assertUsageWindow(new Date(to.getTime() - 90 * DAY), to)).not.toThrow();
  });

  it("refuses a window longer than the cap", () => {
    expect(() => assertUsageWindow(new Date(to.getTime() - (MAX_USAGE_WINDOW_DAYS + 1) * DAY), to)).toThrow(/at most/);
  });

  it("refuses from after to, and invalid dates", () => {
    expect(() => assertUsageWindow(to, new Date(to.getTime() - DAY))).toThrow(/before/);
    expect(() => assertUsageWindow(new Date("nope"), to)).toThrow(/ISO 8601/);
  });
});
