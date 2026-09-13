import { describe, it, expect } from "vitest";
import { isInternalRequestAuthorized } from "../../apps/hub/src/utils/internalAuth";

// Covers context.md risk #7 (unauthenticated /internal/proxy) and
// decision.md, 2026-09-12, "internal/proxy authentication".
describe("isInternalRequestAuthorized", () => {
  it("fails closed when no secret is configured, even with a header sent", () => {
    expect(isInternalRequestAuthorized("anything", undefined)).toBe(false);
    expect(isInternalRequestAuthorized("anything", "")).toBe(false);
  });

  it("rejects a missing header when a secret is configured", () => {
    expect(isInternalRequestAuthorized(undefined, "correct-secret")).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(isInternalRequestAuthorized("wrong-secret", "correct-secret")).toBe(false);
  });

  it("rejects a secret of different length (no length-based short circuit leak)", () => {
    expect(isInternalRequestAuthorized("short", "a-much-longer-correct-secret")).toBe(false);
  });

  it("accepts the correct secret", () => {
    expect(isInternalRequestAuthorized("correct-secret", "correct-secret")).toBe(true);
  });

  it("uses only the first value when the header is sent multiple times", () => {
    expect(
      isInternalRequestAuthorized(["correct-secret", "something-else"], "correct-secret"),
    ).toBe(true);
    expect(
      isInternalRequestAuthorized(["wrong", "correct-secret"], "correct-secret"),
    ).toBe(false);
  });
});
