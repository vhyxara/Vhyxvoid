import { describe, it, expect } from "vitest";
import {
  buildCanonical,
  signCanonical,
  verifyCanonical,
} from "../../packages/protocol/src/canonical";

// REPLACED 2026-09-12 (broken-test-repair session). The original file
// imported verifySignature/addFrontendKey from apps/hub/src/auth and
// apps/hub/src/store — neither exists; both were replaced by
// HubAuthService (raw-secret HMAC, agent registration) and
// ValidateApiKeyUseCase (canonical-signature verification, SDK/API
// requests) long before this repair, per context.md's Architecture
// section. Neither of those has a "frontendKey" concept, so there is no
// like-for-like REPAIR possible — the closest real, currently-live
// equivalent of "a pure HMAC signature verification function, rejection
// path" is packages/protocol/src/canonical.ts's verifyCanonical(), used by
// both the Hub and the SDK/Agent to verify/sign canonical strings. See
// context.md risk #38 and decision.md, 2026-09-12, "Broken e2e test suite
// repair".
describe("verifyCanonical — rejection paths", () => {
  it("rejects a tampered/garbage signature", () => {
    const canonical = buildCanonical({
      method: "POST",
      path: "/data",
      query: "",
      body: "",
      requestId: "req1",
      ts: 999999,
    });

    const ok = verifyCanonical(canonical, "ffffffdeadbeef", "secret-hash-demo");
    expect(ok).toBe(false);
  });

  it("rejects a signature computed with a different secret", () => {
    const canonical = buildCanonical({
      method: "GET",
      path: "/hello",
      query: "",
      body: "",
      requestId: "req1",
      ts: 123456,
    });

    const wrongSignature = signCanonical(canonical, "wrong-secret");
    expect(verifyCanonical(canonical, wrongSignature, "correct-secret")).toBe(false);
  });

  it("rejects when the canonical string was tampered with after signing", () => {
    const original = buildCanonical({
      method: "GET",
      path: "/hello",
      query: "",
      body: "",
      requestId: "req1",
      ts: 123456,
    });
    const signature = signCanonical(original, "secret");

    // Same secret, same signature — but the verifier is asked to check a
    // canonical string built from a different path than the one signed.
    const tampered = buildCanonical({
      method: "GET",
      path: "/goodbye",
      query: "",
      body: "",
      requestId: "req1",
      ts: 123456,
    });

    expect(verifyCanonical(tampered, signature, "secret")).toBe(false);
  });
});
