// ─────────────────────────────────────────────────────────────────────────────
// CREATE API KEY
// ─────────────────────────────────────────────────────────────────────────────

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError } from "@/core/errors/error.format";
import {
  ApiKeyEnvironment,
  ApiScope,
} from "@/core/types/api-key.types/apiKeys";
import { ApiKeyDeps } from "@/core/types/api-key.types/sharedApiKeys";
// import { ApiKey } from '@/generated/prisma/client';
import { MembershipRepository } from "@/modules/identity/domain/repositories/account/Account.repositories";
import { ApiKey } from "@/modules/key-management/domain/entities/apiKey.entities";
import { buildCachePayload } from "@/modules/key-management/application/helpers/keymanagement.utils";

export class CreateApiKeyUseCase {
  constructor(private deps: ApiKeyDeps) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    name: string;
    description?: string;
    environment: ApiKeyEnvironment;
    scopes: string[];
    expiresAt?: Date;
  }): Promise<{ key: ReturnType<ApiKey["toPublicDTO"]>; secret: string }> {
    const {
      membershipRepository,
      apiKeyRepository,
      planLimitService,
      cacheService,
      pepper,
    } = this.deps;
    // console.log('1. CreateApiKeyUseCase.execute called with params:', params);
    // 1. Role check — ADMIN+ can create
    await resolveMembership(
      membershipRepository,
      params.accountId,
      params.actorUserId,
      RoleLevel.ADMIN,
    );
    // console.log('2. Membership and role check passed');
    // 2. Plan limit check
    const limits = await planLimitService.getLimitsForAccount(params.accountId);

    if (
      !limits.prodKeysAllowed &&
      params.environment === ApiKeyEnvironment.PROD
    ) {
      throw new ForbiddenError(
        "Your plan does not allow PROD environment keys. Upgrade to Pro.",
      );
    }

    if (params.scopes.length > limits.maxScopesPerKey) {
      throw new ForbiddenError(
        `Your plan allows a maximum of ${limits.maxScopesPerKey} scopes per key.`,
      );
    }

    if (limits.maxApiKeys !== Infinity) {
      const activeCount = await apiKeyRepository.countActiveByAccount(
        params.accountId,
      );
      if (activeCount >= limits.maxApiKeys) {
        throw new ForbiddenError(
          `API key limit reached (${limits.maxApiKeys}). Revoke an existing key or upgrade your plan.`,
        );
      }
    }
    // console.log('3. Plan limit check passed');
    // 3. Validate scopes
    const validScopes = Object.values(ApiScope) as string[];
    const invalidScopes = params.scopes.filter((s) => !validScopes.includes(s));
    if (invalidScopes.length > 0) {
      throw new ForbiddenError(`Invalid scopes: ${invalidScopes.join(", ")}`);
    }
    // console.log('4. Scope validation passed');
    // Only OWNER-level keys can have WILDCARD scope
    if (params.scopes.includes(ApiScope.WILDCARD)) {
      const { roleLevel } = await resolveMembership(
        membershipRepository,
        params.accountId,
        params.actorUserId,
        RoleLevel.OWNER,
      );
      void roleLevel; // already throws if not owner
    }
    // console.log('5. WILDCARD scope check passed');
    // 4. Create entity
    const { key, rawSecret } = ApiKey.create({
      accountId: params.accountId,
      createdById: params.actorUserId,
      name: params.name,
      description: params.description,
      environment: params.environment,
      scopes: params.scopes,
      expiresAt: params.expiresAt,
      pepper,
    });
    // console.log('6. API key entity created:', key);
    // 5. Persist
    await apiKeyRepository.save(key);
    // console.log('7. API key saved to repository');
    // 6. Warm cache immediately — next gateway request hits cache, not DB
    // console.log('Warming cache for new API key:', key.keyId);
    // console.log('Cache payload:', buildCachePayload(key, limits.rateLimitPerMinute, 'ACTIVE'));
    // console.log('Cache Service:', cacheService);
    const cache = await cacheService.set(
      key.keyId,
      buildCachePayload(key, limits.rateLimitPerMinute, "ACTIVE"),
    );
    // console.log('Cache set result:', cache);
    return {
      key: key.toPublicDTO(),
      secret: rawSecret, // ← shown once, never stored again
    };
  }
}

async function resolveMembership(
  membershipRepository: MembershipRepository,
  accountId: string,
  actorUserId: string,
  requiredRole: RoleLevel,
): Promise<{ roleLevel: RoleLevel }> {
  const membership = await membershipRepository.findByAccountAndUser(
    accountId,
    actorUserId,
  );

  if (!membership) {
    throw new ForbiddenError("Not a member of this account");
  }

  if (membership.roleLevel < requiredRole) {
    throw new ForbiddenError("Insufficient permissions");
  }

  return {
    roleLevel: membership.roleLevel,
  };
}

// function resolveMembership(
//   membershipRepository: MembershipRepository,
//   accountId: string,
//   actorUserId: string,
//   ADMIN: RoleLevel,
// ) {
//   throw new Error('Function not implemented.');
// }

// function buildCachePayload(
//   key: any,
//   rateLimitPerMinute: number,
//   arg2: string,
// ): import('../../../../core/types/api-key/cacheService').CachedApiKeyData {
//   throw new Error('Function not implemented.');
// }

// / ─────────────────────────────────────────────────────────────────────────────
// HELPER — build the Redis cache payload from the domain entity
//
// This is NOT a stub. It maps the domain entity fields to the flat
// CachedApiKeyData shape that the gateway validation reads from Redis.
// accountStatus is passed as 'ACTIVE' at creation time — the account
// must be active for the use case to have reached this point.
// ─────────────────────────────────────────────────────────────────────────────
