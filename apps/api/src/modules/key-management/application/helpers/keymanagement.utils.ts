import type { CachedApiKeyData } from "@/core/types/api-key/cacheservice.type";
import { ApiKey } from "@/modules/key-management/domain/entities/apiKey.entities";

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// import { ForbiddenError } from '@/core/errors/error.format';
// import { ApiKey } from '@/generated/prisma/client';
// import { MembershipRepository } from '../identity/domain/repositories/account/AccountRepository';
// import { USAGE_FLUSH_INTERVAL_MS } from '@/core/constant/apiKey';
// import fastify from 'fastify';
// import { ExpireApiKeysWorker } from './application/use-cases/ExpireApiKeysWorker';
// import { ExpireRotationGraceWorker } from './application/use-cases/ExpireRotationGraceWorker';
// import { FlushUsageWorker } from './application/use-cases/FlushUsageWorker';
// import {
//   apiKeyRepository,
//   cacheService,
//   usageRepository,
// } from './presentation/plugins/infrastructure/api';

export function toUsageDTO(
  a: import("@/modules/key-management/domain/entities/usage.entities").UsageAggregate,
) {
  return {
    metric: a.metric,
    periodStart: a.periodStart,
    periodEnd: a.periodEnd,
    quantity: a.quantity.toString(), // BigInt → string for JSON serialization
  };
}

export async function getActiveAccountIds(prisma: any): Promise<string[]> {
  // Returns accounts that have at least one active API key
  const result = await prisma.apiKey.findMany({
    where: { status: "ACTIVE" },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  return result.map((r: any) => r.accountId);
}
// src/modules/key-management/application/helpers/buildCachePayload.ts
//
// Standalone helper — import this in every use case that needs to warm the cache.
// Kept separate so it's easy to find and there's one canonical implementation.

/**
 * Map a domain ApiKey entity to the flat Redis cache shape.
 *
 * accountStatus is passed explicitly because the entity doesn't hold the
 * account's operational status — that lives on the Account entity.
 * At creation/update time the account must be ACTIVE for the operation
 * to have reached this point, so pass 'ACTIVE'.
 * On cache refresh from DB, fetch the account status and pass it here.
 */
export function buildCachePayload(
  key: ApiKey, // ← domain entity, has .scopes, .secretHash, etc.
  rateLimitPerMinute: number,
  accountStatus: string,
): CachedApiKeyData {
  return {
    keyId: key.keyId,
    secretHash: key.secretHash,
    previousSecretHash: key.previousSecretHash,
    rotationGraceEndsAt: key.rotationGraceEndsAt?.getTime() ?? null,
    status: key.status,
    accountId: key.accountId,
    accountStatus,
    scopes: key.scopes, // ApiKey.scopes returns string[] via getter
    // Redis holds this as JSON, where Infinity becomes null and the gateway
    // would then read it as a limit of 0. -1 is the documented "unlimited".
    rateLimitPerMinute: Number.isFinite(rateLimitPerMinute)
      ? rateLimitPerMinute
      : -1,
    expiresAt: key.expiresAt?.getTime() ?? null,
  };
}

// const flushWorker = new FlushUsageWorker(cacheService, usageRepository, apiKeyRepository);
// const graceWorker = new ExpireRotationGraceWorker(apiKeyRepository, cacheService);
// const expiryWorker = new ExpireApiKeysWorker(apiKeyRepository, cacheService);

// Flush usage every 5 minutes
// export const flushInterval = setInterval(async () => {
//   try {
//     // Get all active account IDs — in production, maintain a Redis set of active accounts
//     // For now: query distinct accountIds from recent usage keys
//     const accountIds = await getActiveAccountIds(fastify.prisma);
//     await flushWorker.run(accountIds);
//   } catch (err) {
//     fastify.log.error({ err }, '[FlushUsageWorker] failed');
//   }
// }, USAGE_FLUSH_INTERVAL_MS);

// Expire rotation graces every 10 minutes
// export const graceInterval = setInterval(
//   async () => {
//     try {
//       await graceWorker.run();
//     } catch (err) {
//       fastify.log.error({ err }, '[ExpireRotationGraceWorker] failed');
//     }
//   },
//   10 * 60 * 1000,
// );

// // Expire API keys every 5 minutes
// export const expiryInterval = setInterval(
//   async () => {
//     try {
//       await expiryWorker.run();
//     } catch (err) {
//       fastify.log.error({ err }, '[ExpireApiKeysWorker] failed');
//     }
//   },
//   5 * 60 * 1000,
// );

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — resolve membership and enforce role requirement
// ─────────────────────────────────────────────────────────────────────────────

// async function resolveMembership(
//   membershipRepository: MembershipRepository,
//   accountId: string,
//   userId: string,
//   requireLevel: number,
// ): Promise<{ roleLevel: number }> {
//   const membership = await membershipRepository.findByAccountAndUser(accountId, userId);

//   if (!membership) {
//     throw new ForbiddenError('You are not a member of this account');
//   }
//   if (membership.roleLevel < requireLevel) {
//     throw new ForbiddenError('Insufficient role to perform this action');
//   }
//   return { roleLevel: membership.roleLevel };
// }
