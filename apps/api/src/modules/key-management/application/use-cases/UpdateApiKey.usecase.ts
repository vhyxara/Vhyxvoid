// ─────────────────────────────────────────────────────────────────────────────
// UPDATE API KEY (name / description / scopes)
// ─────────────────────────────────────────────────────────────────────────────

import { API_KEY_PERMISSIONS } from "@/core/constant/apikey.constant";
import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { ApiScope } from "@/core/types/api-key.types/apiKeys";
import { ApiKey, ApiKeyDeps } from "@/core/types/api-key.types/sharedApiKeys";

export class UpdateApiKeyUseCase {
  constructor(
    private deps: Pick<
      ApiKeyDeps,
      | "apiKeyRepository"
      | "membershipRepository"
      | "planLimitService"
      | "cacheService"
      | "pepper"
    >,
  ) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    keyId: string;
    name?: string;
    description?: string;
    scopes?: string[];
  }): Promise<ReturnType<ApiKey["toPublicDTO"]>> {
    const {
      membershipRepository,
      apiKeyRepository,
      planLimitService,
      cacheService,
    } = this.deps;

    const membership = await membershipRepository.findByAccountAndUser(
      params.accountId,
      params.actorUserId,
    );
    if (!membership)
      throw new ForbiddenError("You are not a member of this account");

    const key = await apiKeyRepository.findById(params.keyId);
    if (!key || key.accountId !== params.accountId)
      throw new NotFoundError("API key not found");

    if (key.isRevoked())
      throw new ForbiddenError("Cannot update a revoked API key");

    // MEMBER can only update their own keys
    const canManageAny = API_KEY_PERMISSIONS.canManageScopesAny(
      membership.roleLevel,
    );
    if (!canManageAny && !key.isOwnedBy(params.actorUserId)) {
      throw new ForbiddenError("You can only update your own API keys");
    }

    const now = new Date();

    // Update basic fields
    if (params.name || params.description !== undefined) {
      key.update({ name: params.name, description: params.description }, now);
    }

    // Update scopes — validate against plan limits
    if (params.scopes) {
      const limits = await planLimitService.getLimitsForAccount(
        params.accountId,
      );
      if (params.scopes.length > limits.maxScopesPerKey) {
        throw new ForbiddenError(
          `Plan allows max ${limits.maxScopesPerKey} scopes per key`,
        );
      }
      const validScopes = Object.values(ApiScope) as string[];
      const invalid = params.scopes.filter((s) => !validScopes.includes(s));
      if (invalid.length > 0)
        throw new ForbiddenError(`Invalid scopes: ${invalid.join(", ")}`);

      key.updateScopes(params.scopes, now);
    }

    await apiKeyRepository.save(key);

    // Invalidate cache — scope/name changes must propagate immediately
    await cacheService.invalidate(key.keyId);

    return key.toPublicDTO();
  }
}
