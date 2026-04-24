// // Expose repositories on uow for direct route access (get security events, etc.)
// // This mirrors how adminAuditLogRepository is exposed

// if (!fastify.uow) {
//   fastify.decorate('uow', {});
// }

// (fastify.uow as any).apiKeyRepository = apiKeyRepository;
// (fastify.uow as any).securityEventRepository = securityRepository;

// src/modules/key-management/presentation/plugins/infrastructure/api.ts
import { PrismaApiKeyRepository } from "@/modules/key-management/domain/repositories/ApiKey.repositories";
import { HardcodedPlanLimitService } from "@/modules/key-management/domain/repositories/HardcodedPlanLimitService.repositories";
import { PrismaSecurityEventRepository } from "@/modules/key-management/domain/repositories/SecurityEvent.repositories";
import { PrismaUsageAggregateRepository } from "@/modules/key-management/domain/repositories/UsageAggregate.repositories";
import { RedisApiKeyCacheService } from "@/modules/key-management/domain/services/RedisApiKeyCache.service";
import type { PrismaClient } from "@/generated/prisma";
import type { Redis } from "@upstash/redis";

// ✅ Pure factory functions — no Fastify dependency, fully testable
export function createApiKeyInfrastructure(prisma: PrismaClient, redis: Redis) {
  const cacheService = new RedisApiKeyCacheService(redis);
  const apiKeyRepository = new PrismaApiKeyRepository(prisma);
  const usageRepository = new PrismaUsageAggregateRepository(prisma);
  const securityRepository = new PrismaSecurityEventRepository(prisma);
  const planLimitService = new HardcodedPlanLimitService(prisma);
  // console.log('API Key Infrastructure created with Redis and Prisma', cacheService);
  return {
    cacheService,
    apiKeyRepository,
    usageRepository,
    securityRepository,
    planLimitService,
  };
}

export type ApiKeyInfrastructure = ReturnType<
  typeof createApiKeyInfrastructure
>;
