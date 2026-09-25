import { Container } from "@/core/container/container";

import { CreateOrganizationUseCase } from "@/modules/identity/application/use-cases/account/CreateOrganization.usecase";
import { InviteMemberUseCase } from "@/modules/identity/application/use-cases/account/InviteMember.usecase";
import { AcceptInvitationUseCase } from "@/modules/identity/application/use-cases/account/AcceptInvitation.usecase";
import { ChangeMemberRoleUseCase } from "@/modules/identity/application/use-cases/account/ChangeMemberRole.usecase";
import { RemoveMemberUseCase } from "@/modules/identity/application/use-cases/account/RemoveMember.usecase";
import { TransferOwnershipUseCase } from "@/modules/identity/application/use-cases/account/TransferOwnership.usecase";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { NotificationService } from "@/modules/notification/application/use-cases";
import { CheckPlanLimitsService } from "@/modules/billing/domain/services/CheckPlanLimits.service";
import { getRedis } from "@/core/redis/RedisClient";
import { RedisApiKeyCacheService } from "@/modules/key-management/domain/services/RedisApiKeyCache.service";

/**
 * Drops revoked keys' cache entries after a member removal (audit part2 G9).
 * Redis is read at call time: the client is initialised by a plugin that
 * registers after this container factory runs. Fail-soft like every other
 * invalidation (RedisApiKeyCacheService.invalidate logs and swallows).
 */
async function invalidateApiKeyCache(keyIds: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await new RedisApiKeyCacheService(redis).invalidateAllForAccount(keyIds);
}

export function registerAccountUseCases(container: Container) {
  container.register(
    CreateOrganizationUseCase,
    (c) => new CreateOrganizationUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    InviteMemberUseCase,
    (c) =>
      new InviteMemberUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(CryptoTokenGenerator),
        c.resolve(NotificationService),
        c.resolve(CheckPlanLimitsService),
      ),
  );

  container.register(
    AcceptInvitationUseCase,
    (c) =>
      new AcceptInvitationUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(NotificationService),
        c.resolve(CheckPlanLimitsService),
      ),
  );

  container.register(
    ChangeMemberRoleUseCase,
    (c) => new ChangeMemberRoleUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    RemoveMemberUseCase,
    (c) => new RemoveMemberUseCase(c.resolve(PrismaUnitOfWork), invalidateApiKeyCache),
  );
  container.register(
    TransferOwnershipUseCase,
    (c) => new TransferOwnershipUseCase(c.resolve(PrismaUnitOfWork)),
  );
}
