import { describe, it, expect, vi } from "vitest";
import { verifySignature } from "../../apps/hub/src/auth";
import crypto from "crypto";
import { addFrontendKey } from "../../apps/hub/src/store";

describe("HMAC Signature → valid", () => {
  it("accepts correct signature", () => {
    vi.spyOn(Date, "now").mockReturnValue(123456);

    const secret = "secret_demo";
    addFrontendKey("front-demo", secret);
    const canonical = "GET|/hello||req1|123456";

    const signature = crypto
      .createHmac("sha256", secret)
      .update(canonical)
      .digest("hex");

    const ok = verifySignature({
      method: "GET",
      path: "/hello",
      bodyBase64: null,
      requestId: "req1",
      ts: 123456,
      signature,
      frontendKey: "front-demo",
    });

    expect(ok).toBe(true);
  });
});
