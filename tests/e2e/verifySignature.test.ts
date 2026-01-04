import { describe, it, expect } from "vitest";
import { verifySignature } from "../../apps/hub/src/auth";

describe("verifySignature", () => {
  it("rejects tampered signature", () => {
    const ok = verifySignature({
      method: "POST",
      path: "/data",
      bodyBase64: "abcd",
      requestId: "req1",
      ts: 999999,
      signature: "ffffffdeadbeef",
      frontendKey: "front-demo",
    });

    expect(ok).toBe(false);
  });
});
