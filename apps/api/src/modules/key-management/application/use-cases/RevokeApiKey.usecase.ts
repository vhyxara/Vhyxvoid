// ─────────────────────────────────────────────────────────────────────────────
// REVOKE API KEY
// ─────────────────────────────────────────────────────────────────────────────

import { API_KEY_PERMISSIONS } from "@/core/constant/apikey.constant";
import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { ApiKeyDeps } from "@/core/types/api-key/apiKeys.type";

export class RevokeApiKeyUseCase {
  constructor(
    private deps: Pick<
      ApiKeyDeps,
      "apiKeyRepository" | "membershipRepository" | "cacheService"
    >,
    private auditLogRepository: { create(data: any): Promise<void> },
  ) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    keyId: string;
    reason?: string;
  }): Promise<void> {
    const { membershipRepository, apiKeyRepository, cacheService } = this.deps;

    const membership = await membershipRepository.findByAccountAndUser(
      params.accountId,
      params.actorUserId,
    );
    if (!membership)
      throw new ForbiddenError("You are not a member of this account");

    const key = await apiKeyRepository.findById(params.keyId);
    if (!key || key.accountId !== params.accountId)
      throw new NotFoundError("API key not found");

    if (key.isRevoked()) return; // idempotent

    // MEMBER can only revoke their own keys
    if (
      !API_KEY_PERMISSIONS.canRevokeAny(membership.roleLevel) &&
      !key.isOwnedBy(params.actorUserId)
    ) {
      throw new ForbiddenError("You can only revoke your own API keys");
    }

    const now = new Date();
    key.revoke(params.actorUserId, now);
    await apiKeyRepository.save(key);

    // CRITICAL: invalidate cache immediately so gateway rejects this key
    await cacheService.invalidate(key.keyId);

    // Audit log
    await this.auditLogRepository.create({
      accountId: params.accountId,
      userId: params.actorUserId,
      action: "API_KEY_REVOKED",
      resourceType: "ApiKey",
      resourceId: key.id,
      metadata: { keyId: key.keyId, reason: params.reason },
    });
  }
}
