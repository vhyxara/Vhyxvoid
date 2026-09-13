import { describe, it, expect } from "vitest";
import {
  buildCanonical,
  signCanonical,
  verifyCanonical,
} from "../../packages/protocol/src/canonical";

// REPLACED 2026-09-12 (broken-test-repair session). See verifySignature.test.ts
// for the full explanation of why this maps onto packages/protocol's
// canonical-string signing/verification, not a resurrected "frontendKey"
// store. This file keeps the original's "success path" framing/split.
describe("verifyCanonical — success path", () => {
  it("accepts a correctly-signed canonical string", () => {
    const secret = "secret_demo";
    const canonical = buildCanonical({
      method: "GET",
      path: "/hello",
      query: "",
      body: "",
      requestId: "req1",
      ts: 123456,
    });

    const signature = signCanonical(canonical, secret);

    expect(verifyCanonical(canonical, signature, secret)).toBe(true);
  });

  it("still accepts correctly when the request has a body (body hash included in the canonical string)", () => {
    const secret = "secret_demo";
    const canonical = buildCanonical({
      method: "POST",
      path: "/tunnel/forward",
      query: "page=2",
      body: JSON.stringify({ hello: "world" }),
      requestId: "req2",
      ts: 987654,
    });

    const signature = signCanonical(canonical, secret);

    expect(verifyCanonical(canonical, signature, secret)).toBe(true);
  });
});
