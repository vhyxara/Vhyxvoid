// infrastructure/plugins/apiKeyPlugin.ts
// Registers all API key use cases + Redis cache on the Fastify instance.

import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
// import Redis from 'ioredis';
import { USAGE_FLUSH_INTERVAL_MS } from "@/core/constant/apikey.constant";
import { CreateApiKeyUseCase } from "@/modules/key-management/application/use-cases/CreateApiKey.usecase";
import { ExpireApiKeysWorker } from "@/modules/key-management/application/use-cases/ExpireApiKeysWorker.usecase";
import { ExpireRotationGraceWorker } from "@/modules/key-management/application/use-cases/ExpireRotationGraceWorker.usecase";
import { FlushUsageWorker } from "@/modules/key-management/application/use-cases/FlushUsageWorker.usecase";
import { GetApiKeyUsageUseCase } from "@/modules/key-management/application/use-cases/GetApiKeyUsage.usecase";
import { GetApiKeyUseCase } from "@/modules/key-management/application/use-cases/GetApiKey.usecase";
import { ListApiKeysUseCase } from "@/modules/key-management/application/use-cases/ListApiKeys.usecase";
import { RevokeApiKeyUseCase } from "@/modules/key-management/application/use-cases/RevokeApiKey.usecase";
import { RotateApiKeyUseCase } from "@/modules/key-management/application/use-cases/RotateApiKey.usecase";
import { UpdateApiKeyUseCase } from "@/modules/key-management/application/use-cases/UpdateApiKey.usecase";
import { ValidateApiKeyUseCase } from "@/modules/key-management/application/use-cases/ValidateApiKey.usecase";
import { buildValidateApiKeyUseCase, buildDbApiKeyLoader } from "@vhyxvoid/shared";
// import { PrismaApiKeyRepository } from '../../domain/repositories/ApiKeyRepository';
// import { HardcodedPlanLimitService } from '../../domain/repositories/HardcodedPlanLimitService';
// import { PrismaSecurityEventRepository } from '../../domain/repositories/SecurityEventRepository';
// import { PrismaUsageAggregateRepository } from '../../domain/repositories/UsageAggregateRepository';
// import { RedisApiKeyCacheService } from '../../domain/services/RedisApiKeyCacheService';
// import { flushInterval, graceInterval, expiryInterval } from '../../privateHelper';
import { createApiKeyInfrastructure } from "@/modules/key-management/presentation/plugins/infrastructure/api";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { apiKeyRoutes } from "@/modules/key-management/presentation/http/apiKey.routes";
// import { getRedis } from '@/core/redis/RedisClient';

// export default fp(async (fastify: FastifyInstance) => {
//   const pepper = process.env.SERVER_HMAC_PEPPER;
//   if (!pepper || pepper.length < 32) {
//     throw new Error(
//       'SERVER_HMAC_PEPPER env var is required and must be at least 32 characters. ' +
//         'Generate with: openssl rand -hex 32',
//     );
//   }

//   // Clean up intervals on shutdown
//   fastify.addHook('onClose', async () => {
//     clearInterval(flushInterval);
//     clearInterval(graceInterval);
//     clearInterval(expiryInterval);
//   });
// });

// src/modules/key-management/presentation/plugins/apiKeyPlugin.ts
// import fp from 'fastify-plugin';
// import { FastifyInstance } from 'fastify';
// import { createApiKeyInfrastructure } from './infrastructure/api';
// import { buildCachePayload } from '../../shared/buildCachePayload';

// import { CreateApiKeyUseCase } from '../../application/use-cases/CreateApiKeyUseCase';
// import { ListApiKeysUseCase } from '../../application/use-cases/ListApiKeysUseCase';
// import { GetApiKeyUseCase } from '../../application/use-cases/GetApiKeyUseCase';
// import { UpdateApiKeyUseCase } from '../../application/use-cases/UpdateApiKeyUseCase';
// import { RevokeApiKeyUseCase } from '../../application/use-cases/RevokeApiKeyUseCase';
// import { RotateApiKeyUseCase } from '../../application/use-cases/RotateApiKeyUseCase';
// import { GetApiKeyUsageUseCase } from '../../application/use-cases/GetApiKeyUsageUseCase';
// import { ValidateApiKeyUseCase } from '../../application/use-cases/ValidateApiKeyUseCase';

// import { ExpireApiKeysWorker } from '../../application/use-cases/ExpireApiKeysWorker';
// import { ExpireRotationGraceWorker } from '../../application/use-cases/ExpireRotationGraceWorker';
// import { FlushUsageWorker } from '../../application/use-cases/FlushUsageWorker';

// import { USAGE_FLUSH_INTERVAL_MS } from '@/core/constant/apiKey';

export default fp(async (fastify: FastifyInstance) => {
  // ── 0. Validate env ────────────────────────────────────────────────────────
  const pepper = process.env.SERVER_HMAC_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error(
      "SERVER_HMAC_PEPPER must be at least 32 characters. Generate: openssl rand -hex 32",
    );
  }
  const uow = fastify.container.resolve(PrismaUnitOfWork);
  if (!uow) {
    throw new Error(
      "PrismaUnitOfWork not resolved. Check container registration order.",
    );
  }
  // console.log('PrismaUnitOfWork resolved in apiKeyPlugin:', !!uow);
  // console.log('container:', fastify.container);
  // console.log('uow:', fastify.container.resolve(PrismaUnitOfWork));
  console.log("FASTIFY KEYS:", Object.keys(fastify));
  // ── 1. Build infrastructure using the already-decorated prisma + redis ────
  // fastify.prisma and fastify.redis are available here because
  // prismaPlugin and redisPlugin registered before this plugin (see ApiKeyPlugins)
  if (!fastify.redis) {
    throw new Error(
      "fastify.redis not found — ensure redisPlugin registers before apiKeyPlugin",
    );
  }
  const infra = createApiKeyInfrastructure(fastify.prisma, fastify.redis);
  const {
    cacheService,
    apiKeyRepository,
    usageRepository,
    securityRepository,
    planLimitService,
  } = infra;

  // ── 2. Expose repositories on uow for direct route access ─────────────────
  // fastify.uow is decorated by the identity plugin — extend it here
  // if (!fastify.uow) {
  //   throw new Error('fastify.uow not found — ensure identityPlugin registers before apiKeyPlugin');
  // }
  // fastify.uow.apiKeyRepository = apiKeyRepository;
  // fastify.uow.securityEventRepository = securityRepository;

  // ── 3. Wire shared deps object ─────────────────────────────────────────────
  const deps = {
    apiKeyRepository,
    membershipRepository: uow.membershipRepository,
    planLimitService,
    cacheService,
    pepper,
  };

  // ── 4. Decorate use cases onto fastify instance ───────────────────────────
  fastify.decorate("createApiKeyUseCase", new CreateApiKeyUseCase(deps));

  fastify.decorate(
    "listApiKeysUseCase",
    new ListApiKeysUseCase({
      apiKeyRepository,
      membershipRepository: uow.membershipRepository,
    }),
  );

  fastify.decorate(
    "getApiKeyUseCase",
    new GetApiKeyUseCase({
      apiKeyRepository,
      membershipRepository: uow.membershipRepository,
    }),
  );

  fastify.decorate("updateApiKeyUseCase", new UpdateApiKeyUseCase(deps));

  fastify.decorate(
    "revokeApiKeyUseCase",
    new RevokeApiKeyUseCase(
      {
        apiKeyRepository,
        membershipRepository: uow.membershipRepository,
        cacheService,
      },
      uow.auditLogRepository,
    ),
  );

  fastify.decorate(
    "rotateApiKeyUseCase",
    new RotateApiKeyUseCase(deps, uow.auditLogRepository),
  );

  fastify.decorate(
    "getApiKeyUsageUseCase",
    new GetApiKeyUsageUseCase(
      {
        apiKeyRepository,
        membershipRepository: uow.membershipRepository,
      },
      usageRepository,
    ),
  );

  // The canonical validation logic (timestamp/replay/scope/HMAC/rate-limit)
  // now lives in packages/shared — the same code the Hub runs on every real
  // gateway request. This wiring builds the same factory the Hub uses
  // (buildValidateApiKeyUseCase + buildDbApiKeyLoader against this app's own
  // Prisma client, which points at the same generated schema/DB as the
  // Hub's) so both apps run one implementation instead of two. apps/api's
  // ValidateApiKeyUseCase is now just a thin adapter that maps failures onto
  // SecurityEventType and writes the audit row. See decision.md, 2026-09-13,
  // "Unify ValidateApiKeyUseCase".
  const canonicalValidateKeyUseCase = buildValidateApiKeyUseCase({
    redis: fastify.redis,
    loadKey: buildDbApiKeyLoader(fastify.prisma),
  });

  fastify.decorate(
    "validateApiKeyUseCase",
    new ValidateApiKeyUseCase(canonicalValidateKeyUseCase, securityRepository),
  );

  fastify.decorate("apiKeyRepository", apiKeyRepository);
  fastify.decorate("securityEventRepository", securityRepository);

  fastify.register(apiKeyRoutes, { prefix: "/api/v1/apikeys" });

  // ── 5. Background workers ─────────────────────────────────────────────────
  const flushWorker = new FlushUsageWorker(
    cacheService,
    usageRepository,
    apiKeyRepository,
  );
  const graceWorker = new ExpireRotationGraceWorker(
    apiKeyRepository,
    cacheService,
  );
  const expiryWorker = new ExpireApiKeysWorker(apiKeyRepository, cacheService);

  const flushInterval = setInterval(async () => {
    try {
      const result = await fastify.prisma.apiKey.findMany({
        where: { status: "ACTIVE" },
        select: { accountId: true },
        distinct: ["accountId"],
      });
      const accountIds = result.map((r: any) => r.accountId);
      await flushWorker.run(accountIds);
    } catch (err) {
      fastify.log.error({ err }, "[FlushUsageWorker] failed");
    }
  }, USAGE_FLUSH_INTERVAL_MS);

  const graceInterval = setInterval(
    async () => {
      try {
        await graceWorker.run();
      } catch (err) {
        fastify.log.error({ err }, "[ExpireRotationGraceWorker] failed");
      }
    },
    10 * 60 * 1000,
  );

  const expiryInterval = setInterval(
    async () => {
      try {
        await expiryWorker.run();
      } catch (err) {
        fastify.log.error({ err }, "[ExpireApiKeysWorker] failed");
      }
    },
    5 * 60 * 1000,
  );

  // ── 6. Clean up on server close ───────────────────────────────────────────
  fastify.addHook("onClose", async () => {
    clearInterval(flushInterval);
    clearInterval(graceInterval);
    clearInterval(expiryInterval);
  });
});
// const redis = getRedis();
// ── Redis client ───────────────────────────────────────────────────────────
// const redis = new Redis({
//   host: process.env.REDIS_HOST ?? 'localhost',
//   port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
//   password: process.env.REDIS_PASSWORD,
//   maxRetriesPerRequest: 3,
//   enableOfflineQueue: false, // fail fast — don't queue commands when Redis is down
//   lazyConnect: true,
// });

// await redis.connect();

// fastify.addHook('onClose', async () => {
//   await redis.;
// });

// ── Infrastructure ─────────────────────────────────────────────────────────

// ── Background workers ─────────────────────────────────────────────────────
