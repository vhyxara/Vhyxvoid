import { SecurityEventType } from "@/core/constant/apikey.constant";
import {
  GatewayValidationResult,
  GatewayValidationError,
} from "@/core/types/api-key/gateway.type";
import { SecurityEventRepository } from "@/core/types/api-key/securityEvent.type";
import { SecurityEvent } from "@/modules/key-management/domain/entities/security.entities";
import type {
  IValidateApiKeyUseCase,
  ValidateApiKeyParams,
} from "@vhyxvoid/shared";

// The canonical HMAC/replay/scope/rate-limit validation logic used to be
// duplicated here and in packages/shared/src/validateApiKey.ts (the Hub's
// live gateway path) — same algorithm, independently maintained, and they
// had already silently diverged once (fail-soft/fail-open Redis handling)
// before that was caught. This class is now a thin adapter around the
// single canonical implementation: it delegates the actual validation to
// the injected IValidateApiKeyUseCase and adds only what's specific to
// apps/api — mapping the canonical (generic-string) failure code onto this
// module's SecurityEventType enum, and writing the fire-and-forget
// SecurityEvent audit row that packages/shared deliberately does not know
// how to do (it stays Prisma-free by design). See decision.md, 2026-09-13,
// "Unify ValidateApiKeyUseCase".
//
// Canonical code -> SecurityEventType. Both sides were forked from the same
// original logic and drifted to different string literals for the same two
// cases (SCOPE_MISSING/RATE_LIMITED vs SCOPE_VIOLATION/RATE_LIMIT_EXCEEDED).
// Kept as an explicit map (not a shared enum) so a future new canonical code
// fails loudly here instead of silently producing an UNKNOWN security event.
const CODE_MAP: Record<string, SecurityEventType> = {
  INVALID_SIGNATURE: SecurityEventType.INVALID_SIGNATURE,
  REPLAY_ATTACK: SecurityEventType.REPLAY_ATTACK,
  REVOKED_KEY: SecurityEventType.REVOKED_KEY,
  EXPIRED_KEY: SecurityEventType.EXPIRED_KEY,
  SUSPENDED_ACCOUNT: SecurityEventType.SUSPENDED_ACCOUNT,
  SCOPE_MISSING: SecurityEventType.SCOPE_VIOLATION,
  RATE_LIMITED: SecurityEventType.RATE_LIMIT_EXCEEDED,
};

export class ValidateApiKeyUseCase {
  constructor(
    private readonly canonical: IValidateApiKeyUseCase,
    private readonly securityRepository: SecurityEventRepository,
  ) {}

  async execute(
    params: ValidateApiKeyParams,
  ): Promise<GatewayValidationResult | GatewayValidationError> {
    const result = await this.canonical.execute(params);

    if (!result.valid) {
      const mappedCode = CODE_MAP[result.code] ?? SecurityEventType.INVALID_SIGNATURE;
      return this.reject(mappedCode, result.reason, {
        keyId: params.keyId,
        accountId: result.accountId,
        ip: params.ip,
      });
    }

    return {
      valid: true,
      apiKeyId: result.apiKeyId,
      accountId: result.accountId,
      scopes: result.scopes,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: log security event and return typed error
  // ─────────────────────────────────────────────────────────────────────────

  private async reject(
    code: SecurityEventType,
    reason: string,
    context: { keyId?: string; accountId?: string; ip?: string },
  ): Promise<GatewayValidationError> {
    // Fire-and-forget security log — never blocks response
    const event = SecurityEvent.create({
      apiKeyId: context.keyId,
      accountId: context.accountId,
      type: code,
      ip: context.ip,
      reason,
    });

    this.securityRepository.createSilent(event).catch(() => {});

    return { valid: false, code, reason };
  }
}
