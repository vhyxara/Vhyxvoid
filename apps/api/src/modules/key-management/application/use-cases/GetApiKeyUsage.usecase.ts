// ─────────────────────────────────────────────────────────────────────────────
// GET USAGE
// ─────────────────────────────────────────────────────────────────────────────

import { API_KEY_PERMISSIONS } from "@/core/constant/apikey.constant";
import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { ApiKeyDeps } from "@/core/types/api-key/apiKeys.type";
import {
  UsageAggregateRepository,
  UsagePeriod,
} from "@/core/types/api-key/usage.type";
import { toUsageDTO } from "@/modules/key-management/application/helpers/keymanagement.utils";

export class GetApiKeyUsageUseCase {
  constructor(
    private deps: Pick<ApiKeyDeps, "apiKeyRepository" | "membershipRepository">,
    private usageRepository: UsageAggregateRepository,
  ) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    keyId?: string; // if provided, returns key-level usage
    period: UsagePeriod;
  }) {
    const { membershipRepository, apiKeyRepository } = this.deps;

    const membership = await membershipRepository.findByAccountAndUser(
      params.accountId,
      params.actorUserId,
    );
    if (!membership)
      throw new ForbiddenError("You are not a member of this account");
    if (!API_KEY_PERMISSIONS.canViewUsage(membership.roleLevel)) {
      throw new ForbiddenError("Insufficient permissions to view usage");
    }

    if (params.keyId) {
      const key = await apiKeyRepository.findById(params.keyId);
      if (!key || key.accountId !== params.accountId)
        throw new NotFoundError("API key not found");

      const aggregates = await this.usageRepository.findByApiKeyAndPeriod(
        params.keyId,
        params.period,
      );
      return {
        scope: "key",
        keyId: params.keyId,
        aggregates: aggregates.map(toUsageDTO),
      };
    }

    const aggregates = await this.usageRepository.findByAccountAndPeriod(
      params.accountId,
      params.period,
    );
    return {
      scope: "account",
      accountId: params.accountId,
      aggregates: aggregates.map(toUsageDTO),
    };
  }
}
