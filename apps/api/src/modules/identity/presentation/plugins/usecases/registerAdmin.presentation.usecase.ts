import { Container } from "@/core/container/container";

import { AdminLoginUseCase } from "@/modules/identity/application/use-cases/admin/AdminLogin.usecase";
import { AdminRefreshTokenUseCase } from "@/modules/identity/application/use-cases/admin/AdminRefreshToken.usecase";
import { CreateAdminUseCase } from "@/modules/identity/application/use-cases/admin/CreateAdmin.usecase";
import { AssignRoleToAdminUseCase } from "@/modules/identity/application/use-cases/admin/AssignRoleToAdmin.usecase";
import { RevokeRoleFromAdminUseCase } from "@/modules/identity/application/use-cases/admin/RevokeRoleFromAdmin.usecase";

import { CreateRoleUseCase } from "@/modules/identity/application/use-cases/admin/CreateRole.usecase";
import { UpdateRoleUseCase } from "@/modules/identity/application/use-cases/admin/UpdateRole.usecase";
import { DeactivateRoleUseCase } from "@/modules/identity/application/use-cases/admin/DeactivateRole.usecase";

import { AssignAbilityToRoleUseCase } from "@/modules/identity/application/use-cases/admin/AssignAbilityToRole.usecase";
import { RevokeAbilityFromRoleUseCase } from "@/modules/identity/application/use-cases/admin/RevokeAbilityFromRole.usecase";

import { VerifyAdminAbilityUseCase } from "@/modules/identity/application/use-cases/admin/VerifyAdminAbility.usecase";
import { GetAdminAbilitiesUseCase } from "@/modules/identity/application/use-cases/admin/GetAdminAbilities.usecase";
import { CreateAbilityUseCase } from "@/modules/identity/application/use-cases/admin/CreateAbility.usecase";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { BcryptPasswordHasher } from "@/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";

export function registerAdminUseCases(container: Container) {
  container.register(
    AdminLoginUseCase,
    (c) =>
      new AdminLoginUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(RS256JwtService),
        c.resolve(CryptoTokenGenerator),
        c.resolve(BcryptPasswordHasher),
      ),
  );

  container.register(
    AdminRefreshTokenUseCase,
    (c) =>
      new AdminRefreshTokenUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(RS256JwtService),
        c.resolve(CryptoTokenGenerator),
      ),
  );

  container.register(
    CreateAdminUseCase,
    (c) =>
      new CreateAdminUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(BcryptPasswordHasher),
      ),
  );

  container.register(
    AssignRoleToAdminUseCase,
    (c) => new AssignRoleToAdminUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    RevokeRoleFromAdminUseCase,
    (c) => new RevokeRoleFromAdminUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    CreateRoleUseCase,
    (c) => new CreateRoleUseCase(c.resolve(PrismaUnitOfWork)),
  );
  container.register(
    UpdateRoleUseCase,
    (c) => new UpdateRoleUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    DeactivateRoleUseCase,
    (c) => new DeactivateRoleUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    AssignAbilityToRoleUseCase,
    (c) => new AssignAbilityToRoleUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    RevokeAbilityFromRoleUseCase,
    (c) => new RevokeAbilityFromRoleUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    VerifyAdminAbilityUseCase,
    (c) => new VerifyAdminAbilityUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    GetAdminAbilitiesUseCase,
    (c) => new GetAdminAbilitiesUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    CreateAbilityUseCase,
    (c) => new CreateAbilityUseCase(c.resolve(PrismaUnitOfWork)),
  );
}
