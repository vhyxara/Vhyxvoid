// import { CreateApiKeyUseCase } from '@/modules/key-management/application/use-cases/CreateApiKeyUseCase';
// import { GetApiKeyUsageUseCase } from '@/modules/key-management/application/use-cases/GetApiKeyUsageUseCase';
// import { GetApiKeyUseCase } from '@/modules/key-management/application/use-cases/GetApiKeyUseCase';
// import { ListApiKeysUseCase } from '@/modules/key-management/application/use-cases/ListApiKeysUseCase';
// import { RevokeApiKeyUseCase } from '@/modules/key-management/application/use-cases/RevokeApiKeyUseCase';
// import { RotateApiKeyUseCase } from '@/modules/key-management/application/use-cases/RotateApiKeyUseCase';
// import { UpdateApiKeyUseCase } from '@/modules/key-management/application/use-cases/UpdateApiKeyUseCase';
// import { ValidateApiKeyUseCase } from '@/modules/key-management/application/use-cases/ValidateApiKeyUseCase';
// import fastify from 'fastify';

// const deps = {
//   apiKeyRepository,
//   membershipRepository: fastify.uow.membershipRepository,
//   planLimitService,
//   cacheService,
//   pepper,
// };

// // ── Management plane use cases ─────────────────────────────────────────────
// fastify.decorate('createApiKeyUseCase', new CreateApiKeyUseCase(deps));

// fastify.decorate(
//   'listApiKeysUseCase',
//   new ListApiKeysUseCase({
//     apiKeyRepository,
//     membershipRepository: fastify.uow.membershipRepository,
//   }),
// );

// fastify.decorate(
//   'getApiKeyUseCase',
//   new GetApiKeyUseCase({
//     apiKeyRepository,
//     membershipRepository: fastify.uow.membershipRepository,
//   }),
// );

// fastify.decorate('updateApiKeyUseCase', new UpdateApiKeyUseCase(deps));

// fastify.decorate(
//   'revokeApiKeyUseCase',
//   new RevokeApiKeyUseCase(
//     { apiKeyRepository, membershipRepository: fastify.uow.membershipRepository, cacheService },
//     fastify.uow.auditLogRepository,
//   ),
// );

// fastify.decorate(
//   'rotateApiKeyUseCase',
//   new RotateApiKeyUseCase(deps, fastify.uow.auditLogRepository),
// );

// fastify.decorate(
//   'getApiKeyUsageUseCase',
//   new GetApiKeyUsageUseCase(
//     { apiKeyRepository, membershipRepository: fastify.uow.membershipRepository },
//     usageRepository,
//   ),
// );

// // ── Data plane use case ────────────────────────────────────────────────────
// fastify.decorate(
//   'validateApiKeyUseCase',
//   new ValidateApiKeyUseCase(apiKeyRepository, cacheService, securityRepository, pepper),
// );
