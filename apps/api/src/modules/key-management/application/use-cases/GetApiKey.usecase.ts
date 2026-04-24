// ─────────────────────────────────────────────────────────────────────────────
// GET API KEY
// ─────────────────────────────────────────────────────────────────────────────

import { API_KEY_PERMISSIONS } from "@/core/constant/apikey.constant";
import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { type ApiKey, ApiKeyDeps } from "@/core/types/api-key/apiKeys.type";
// import { ApiKey } from '@/generated/prisma/client';

export class GetApiKeyUseCase {
  constructor(
    private deps: Pick<ApiKeyDeps, "apiKeyRepository" | "membershipRepository">,
  ) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    keyId: string; // internal UUID
  }): Promise<ReturnType<ApiKey["toPublicDTO"]>> {
    const { membershipRepository, apiKeyRepository } = this.deps;

    const membership = await membershipRepository.findByAccountAndUser(
      params.accountId,
      params.actorUserId,
    );
    if (!membership)
      throw new ForbiddenError("You are not a member of this account");

    const key = await apiKeyRepository.findById(params.keyId);
    if (!key || key.accountId !== params.accountId)
      throw new NotFoundError("API key not found");

    // MEMBER can only view their own keys
    if (
      !API_KEY_PERMISSIONS.canListAll(membership.roleLevel) &&
      !key.isOwnedBy(params.actorUserId)
    ) {
      throw new ForbiddenError("You can only view your own API keys");
    }

    return key.toPublicDTO();
  }
}
