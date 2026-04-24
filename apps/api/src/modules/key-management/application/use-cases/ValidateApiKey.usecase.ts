import { ApiKeyRepository } from "@/core/types/api-key/apiKeys.type";
import { ApiScope, SecurityEventType } from "@/core/constant/apikey.constant";
import { ApiKeyCacheService } from "@/core/types/api-key/cacheservice.type";
import {
  GatewayValidationResult,
  GatewayValidationError,
} from "@/core/types/api-key/gateway.type";
import { SecurityEventRepository } from "@/core/types/api-key/securityEvent.type";
import { ApiKeyStatus } from "@/generated/prisma";
import { SecurityEvent } from "@/modules/key-management/domain/entities/security.entities";
import { ApiKey } from "@/modules/key-management/domain/entities/apiKey.entities";
import { buildCachePayload } from "@/modules/key-management/application/helpers/keymanagement.utils";

export class ValidateApiKeyUseCase {
  constructor(
    private apiKeyRepository: ApiKeyRepository,
    private cacheService: ApiKeyCacheService,
    private securityRepository: SecurityEventRepository,
    private pepper: string,
  ) {}

  async execute(params: {
    keyId: string;
    signature: string;
    method: string;
    path: string;
    body: string;
    requestId: string;
    timestamp: number; // unix ms from client
    requiredScope: string;
    ip: string;
  }): Promise<GatewayValidationResult | GatewayValidationError> {
    const now = new Date();

    // ── 1. Timestamp check ──────────────────────────────────────────────────
    const SIGNATURE_WINDOW_MS = 60_000;
    const age = Math.abs(Date.now() - params.timestamp);
    if (age > SIGNATURE_WINDOW_MS) {
      return this.reject(
        SecurityEventType.INVALID_SIGNATURE,
        "Request timestamp outside acceptable window",
        { keyId: params.keyId, ip: params.ip },
      );
    }

    // ── 2. Replay protection — SET NX in Redis ───────────────────────────────
    const isNew = await this.cacheService.markRequestId(params.requestId);
    if (!isNew) {
      return this.reject(
        SecurityEventType.REPLAY_ATTACK,
        "Duplicate requestId detected",
        {
          keyId: params.keyId,
          ip: params.ip,
        },
      );
    }

    // ── 3. Load key — cache first, DB fallback ───────────────────────────────
    let cached = await this.cacheService.get(params.keyId);

    if (!cached) {
      const key = await this.apiKeyRepository.findByKeyId(params.keyId);
      if (!key) {
        return this.reject(
          SecurityEventType.INVALID_SIGNATURE,
          "Unknown API key",
          {
            ip: params.ip,
          },
        );
      }
      // Warm cache for next request
      cached = buildCachePayload(key, Infinity, key.accountId);
      await this.cacheService.set(params.keyId, cached);
    }

    // ── 4. Status checks ────────────────────────────────────────────────────
    if (cached.status === ApiKeyStatus.REVOKED) {
      return this.reject(
        SecurityEventType.REVOKED_KEY,
        "API key has been revoked",
        {
          keyId: params.keyId,
          accountId: cached.accountId,
          ip: params.ip,
        },
      );
    }

    if (cached.expiresAt && cached.expiresAt < Date.now()) {
      return this.reject(SecurityEventType.EXPIRED_KEY, "API key has expired", {
        keyId: params.keyId,
        accountId: cached.accountId,
        ip: params.ip,
      });
    }

    if (cached.accountStatus !== "ACTIVE") {
      return this.reject(
        SecurityEventType.SUSPENDED_ACCOUNT,
        "Account is not active",
        {
          keyId: params.keyId,
          accountId: cached.accountId,
          ip: params.ip,
        },
      );
    }

    // ── 5. Scope check ───────────────────────────────────────────────────────
    const hasScope =
      cached.scopes.includes(ApiScope.WILDCARD) ||
      cached.scopes.includes(params.requiredScope);

    if (!hasScope) {
      return this.reject(
        SecurityEventType.SCOPE_VIOLATION,
        `Key does not have required scope: ${params.requiredScope}`,
        { keyId: params.keyId, accountId: cached.accountId, ip: params.ip },
      );
    }

    // ── 6. HMAC signature verification ──────────────────────────────────────
    const canonical = ApiKey.buildCanonical({
      method: params.method,
      path: params.path,
      body: params.body,
      requestId: params.requestId,
      timestamp: params.timestamp,
    });

    // Reconstruct entity just enough to call verifySignature
    // We don't rehydrate the full entity — just do the HMAC check directly
    const verifyHash = (hash: string): boolean => {
      try {
        const expected = require("crypto")
          .createHmac("sha256", hash)
          .update(canonical)
          .digest("hex");
        return require("crypto").timingSafeEqual(
          Buffer.from(expected, "hex"),
          Buffer.from(params.signature, "hex"),
        );
      } catch {
        return false;
      }
    };

    const graceActive =
      cached.rotationGraceEndsAt !== null &&
      cached.rotationGraceEndsAt > Date.now();

    const signatureValid =
      verifyHash(cached.secretHash) ||
      (graceActive && cached.previousSecretHash
        ? verifyHash(cached.previousSecretHash)
        : false);

    if (!signatureValid) {
      return this.reject(
        SecurityEventType.INVALID_SIGNATURE,
        "HMAC signature verification failed",
        { keyId: params.keyId, accountId: cached.accountId, ip: params.ip },
      );
    }

    // ── 7. Rate limit check ──────────────────────────────────────────────────
    const count = await this.cacheService.incrementRateLimit(params.keyId);
    if (
      cached.rateLimitPerMinute !== Infinity &&
      count > cached.rateLimitPerMinute
    ) {
      return this.reject(
        SecurityEventType.RATE_LIMIT_EXCEEDED,
        `Rate limit exceeded: ${cached.rateLimitPerMinute} req/min`,
        { keyId: params.keyId, accountId: cached.accountId, ip: params.ip },
      );
    }

    // ── 8. Record usage — fire and forget ────────────────────────────────────
    this.cacheService
      .incrementUsage({
        accountId: cached.accountId,
        apiKeyId: params.keyId,
        metric: "requests",
        amount: 1,
      })
      .catch(() => {}); // never block the response

    return {
      valid: true,
      apiKeyId: params.keyId,
      accountId: cached.accountId,
      scopes: cached.scopes,
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
