import { describe, it, expect, vi } from "vitest";
import { ValidateApiKeyUseCase } from "../../apps/api/src/modules/key-management/application/use-cases/ValidateApiKey.usecase";
import { SecurityEventType } from "../../apps/api/src/core/constant/apikey.constant";
import type { GatewayValidationResult } from "@vhyxvoid/shared";

// Covers decision.md, 2026-09-13, "Unify ValidateApiKeyUseCase": apps/api no
// longer reimplements the HMAC/replay/scope/rate-limit logic (that's
// packages/shared's job now, tested in validateApiKeyUseCase.test.ts). This
// file tests only what's actually specific to apps/api's adapter: mapping
// the canonical failure code onto SecurityEventType, and writing the
// SecurityEvent audit row with the right attribution.

function makeCanonical(result: GatewayValidationResult) {
  return { execute: vi.fn().mockResolvedValue(result) };
}

function makeSecurityRepo() {
  return { createSilent: vi.fn().mockResolvedValue(undefined) };
}

const PARAMS = {
  keyId: "key_1",
  signature: "sig",
  method: "POST",
  path: "/tunnel/request",
  body: "",
  requestId: "req_1",
  timestamp: Date.now(),
  requiredScope: "tunnels:write",
  ip: "127.0.0.1",
};

describe("apps/api ValidateApiKeyUseCase adapter", () => {
  it("passes through a successful canonical result without logging a security event", async () => {
    const canonical = makeCanonical({
      valid: true,
      apiKeyId: "key_1",
      accountId: "acct_1",
      scopes: ["tunnels:write"],
      rateLimitPerMinute: -1,
    });
    const securityRepo = makeSecurityRepo();
    const useCase = new ValidateApiKeyUseCase(canonical as any, securityRepo as any);

    const result = await useCase.execute(PARAMS);

    expect(result).toEqual({
      valid: true,
      apiKeyId: "key_1",
      accountId: "acct_1",
      scopes: ["tunnels:write"],
    });
    expect(securityRepo.createSilent).not.toHaveBeenCalled();
  });

  it("maps the canonical SCOPE_MISSING code onto SecurityEventType.SCOPE_VIOLATION", async () => {
    const canonical = makeCanonical({
      valid: false,
      code: "SCOPE_MISSING",
      reason: "Key missing required scope: tunnels:write",
      accountId: "acct_1",
    });
    const securityRepo = makeSecurityRepo();
    const useCase = new ValidateApiKeyUseCase(canonical as any, securityRepo as any);

    const result = await useCase.execute(PARAMS);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe(SecurityEventType.SCOPE_VIOLATION);
    expect(securityRepo.createSilent).toHaveBeenCalledOnce();
  });

  it("maps the canonical RATE_LIMITED code onto SecurityEventType.RATE_LIMIT_EXCEEDED", async () => {
    const canonical = makeCanonical({
      valid: false,
      code: "RATE_LIMITED",
      reason: "Rate limit exceeded: 60 req/min",
      accountId: "acct_1",
    });
    const securityRepo = makeSecurityRepo();
    const useCase = new ValidateApiKeyUseCase(canonical as any, securityRepo as any);

    const result = await useCase.execute(PARAMS);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe(SecurityEventType.RATE_LIMIT_EXCEEDED);
  });

  it("passes every other canonical code through unchanged (same string on both sides)", async () => {
    const canonical = makeCanonical({
      valid: false,
      code: "REVOKED_KEY",
      reason: "API key has been revoked",
      accountId: "acct_1",
    });
    const securityRepo = makeSecurityRepo();
    const useCase = new ValidateApiKeyUseCase(canonical as any, securityRepo as any);

    const result = await useCase.execute(PARAMS);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe(SecurityEventType.REVOKED_KEY);
  });

  it("records the SecurityEvent with the canonical result's accountId and the request's keyId/ip", async () => {
    const canonical = makeCanonical({
      valid: false,
      code: "REVOKED_KEY",
      reason: "API key has been revoked",
      accountId: "acct_1",
    });
    const securityRepo = makeSecurityRepo();
    const useCase = new ValidateApiKeyUseCase(canonical as any, securityRepo as any);

    await useCase.execute(PARAMS);

    expect(securityRepo.createSilent).toHaveBeenCalledOnce();
    const event = securityRepo.createSilent.mock.calls[0][0];
    expect(event.accountId).toBe("acct_1");
    expect(event.apiKeyId).toBe("key_1");
    expect(event.type).toBe(SecurityEventType.REVOKED_KEY);
  });

  it("still logs a security event (with accountId undefined) for a pre-cache-load rejection", async () => {
    const canonical = makeCanonical({
      valid: false,
      code: "REPLAY_ATTACK",
      reason: "Duplicate requestId — possible replay attack",
      // no accountId — canonical never got far enough to load the key
    });
    const securityRepo = makeSecurityRepo();
    const useCase = new ValidateApiKeyUseCase(canonical as any, securityRepo as any);

    const result = await useCase.execute(PARAMS);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe(SecurityEventType.REPLAY_ATTACK);
    const event = securityRepo.createSilent.mock.calls[0][0];
    expect(event.accountId).toBeNull();
  });
});
