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
      ),
  );

  container.register(
    AcceptInvitationUseCase,
    (c) =>
      new AcceptInvitationUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(NotificationService),
      ),
  );

  container.register(
    ChangeMemberRoleUseCase,
    (c) => new ChangeMemberRoleUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    RemoveMemberUseCase,
    (c) => new RemoveMemberUseCase(c.resolve(PrismaUnitOfWork)),
  );
  container.register(
    TransferOwnershipUseCase,
    (c) => new TransferOwnershipUseCase(c.resolve(PrismaUnitOfWork)),
  );
}
