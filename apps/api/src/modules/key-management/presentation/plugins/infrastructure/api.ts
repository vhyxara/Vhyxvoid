// src/modules/key-management/presentation/plugins/infrastructure/api.ts
import { PrismaApiKeyRepository } from "@/modules/key-management/domain/repositories/ApiKey.repositories";
import { SubscriptionPlanLimitService } from "@/modules/key-management/domain/repositories/SubscriptionPlanLimitService.repositories";
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
  const planLimitService = new SubscriptionPlanLimitService(prisma);
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
