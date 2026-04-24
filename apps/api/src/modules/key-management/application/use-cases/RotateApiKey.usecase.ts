// ─────────────────────────────────────────────────────────────────────────────
// ROTATE API KEY (zero-downtime rotation)
// ─────────────────────────────────────────────────────────────────────────────

import { API_KEY_PERMISSIONS } from "@/core/constant/apikey.constant";
import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { ApiKeyDeps } from "@/core/types/api-key.types/sharedApiKeys";

export class RotateApiKeyUseCase {
  constructor(
    private deps: Pick<
      ApiKeyDeps,
      | "apiKeyRepository"
      | "membershipRepository"
      | "planLimitService"
      | "cacheService"
      | "pepper"
    >,
    private auditLogRepository: { create(data: any): Promise<void> },
  ) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    keyId: string;
  }): Promise<{ secret: string; graceEndsAt: Date }> {
    const {
      membershipRepository,
      apiKeyRepository,
      planLimitService,
      cacheService,
      pepper,
    } = this.deps;

    const membership = await membershipRepository.findByAccountAndUser(
      params.accountId,
      params.actorUserId,
    );
    if (!membership)
      throw new ForbiddenError("You are not a member of this account");

    // Rotation is a Pro+ feature
    const limits = await planLimitService.getLimitsForAccount(params.accountId);
    if (!limits.rotationAllowed) {
      throw new ForbiddenError(
        "Key rotation is not available on your plan. Upgrade to Pro.",
      );
    }

    const key = await apiKeyRepository.findById(params.keyId);
    if (!key || key.accountId !== params.accountId)
      throw new NotFoundError("API key not found");
    if (key.isRevoked())
      throw new ForbiddenError("Cannot rotate a revoked API key");

    // MEMBER can only rotate their own keys
    if (
      !API_KEY_PERMISSIONS.canRotateAny(membership.roleLevel) &&
      !key.isOwnedBy(params.actorUserId)
    ) {
      throw new ForbiddenError("You can only rotate your own API keys");
    }

    const now = new Date();
    const rawSecret = key.rotate(pepper, now);

    await apiKeyRepository.save(key);

    // Invalidate cache immediately — next gateway request re-fetches with new secret
    await cacheService.invalidate(key.keyId);

    await this.auditLogRepository.create({
      accountId: params.accountId,
      userId: params.actorUserId,
      action: "API_KEY_ROTATED",
      resourceType: "ApiKey",
      resourceId: key.id,
      metadata: { keyId: key.keyId, graceEndsAt: key.rotationGraceEndsAt },
    });

    return {
      secret: rawSecret, // shown once
      graceEndsAt: key.rotationGraceEndsAt!,
    };
  }
}
