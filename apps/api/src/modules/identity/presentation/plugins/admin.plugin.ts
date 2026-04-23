// identity/presentation/plugins/adminPlugin.ts

import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import adminAuthGuardPlugin from "@/modules/identity/presentation/plugins/adminAuthGuard.plugin";
import requireAbilityPlugin from "@/modules/identity/presentation/plugins/requireAbility.plugin";
import requireSuperAdminPlugin from "@/modules/identity/presentation/plugins/requireSuperAdmin.plugin";
import { AdminLoginUseCase } from "@/modules/identity/application/use-cases/admin/AdminLogin.usecase";
import { AdminRefreshTokenUseCase } from "@/modules/identity/application/use-cases/admin/AdminRefreshToken.usecase";
import { CreateAbilityUseCase } from "@/modules/identity/application/use-cases/admin/CreateAbility.usecase";
import { GetAdminAbilitiesUseCase } from "@/modules/identity/application/use-cases/admin/GetAdminAbilities.usecase";
import { VerifyAdminAbilityUseCase } from "@/modules/identity/application/use-cases/admin/VerifyAdminAbility.usecase";
import { AssignAbilityToRoleUseCase } from "@/modules/identity/application/use-cases/admin/AssignAbilityToRole.usecase";
import { AssignRoleToAdminUseCase } from "@/modules/identity/application/use-cases/admin/AssignRoleToAdmin.usecase";
import { CreateAdminUseCase } from "@/modules/identity/application/use-cases/admin/CreateAdmin.usecase";
import { CreateRoleUseCase } from "@/modules/identity/application/use-cases/admin/CreateRole.usecase";
import { DeactivateRoleUseCase } from "@/modules/identity/application/use-cases/admin/DeactivateRole.usecase";
import { RevokeAbilityFromRoleUseCase } from "@/modules/identity/application/use-cases/admin/RevokeAbilityFromRole.usecase";
import { RevokeRoleFromAdminUseCase } from "@/modules/identity/application/use-cases/admin/RevokeRoleFromAdmin.usecase";
import { UpdateRoleUseCase } from "@/modules/identity/application/use-cases/admin/UpdateRole.usecase";

export default fp(async (fastify: FastifyInstance) => {
  const container = fastify.container;

  // expose usecases

  fastify.decorate("adminLoginUseCase", container.resolve(AdminLoginUseCase));

  fastify.decorate(
    "adminRefreshTokenUseCase",
    container.resolve(AdminRefreshTokenUseCase),
  );

  fastify.decorate("createAdminUseCase", container.resolve(CreateAdminUseCase));

  fastify.decorate(
    "assignRoleToAdminUseCase",
    container.resolve(AssignRoleToAdminUseCase),
  );

  fastify.decorate(
    "revokeRoleFromAdminUseCase",
    container.resolve(RevokeRoleFromAdminUseCase),
  );
  fastify.decorate("createRoleUseCase", container.resolve(CreateRoleUseCase));

  fastify.decorate("updateRoleUseCase", container.resolve(UpdateRoleUseCase));

  fastify.decorate(
    "deactivateRoleUseCase",
    container.resolve(DeactivateRoleUseCase),
  );
  fastify.decorate(
    "assignAbilityToRoleUseCase",
    container.resolve(AssignAbilityToRoleUseCase),
  );

  fastify.decorate(
    "revokeAbilityFromRoleUseCase",
    container.resolve(RevokeAbilityFromRoleUseCase),
  );

  fastify.decorate(
    "verifyAdminAbilityUseCase",
    container.resolve(VerifyAdminAbilityUseCase),
  );

  fastify.decorate(
    "getAdminAbilitiesUseCase",
    container.resolve(GetAdminAbilitiesUseCase),
  );

  fastify.decorate(
    "createAbilityUseCase",
    container.resolve(CreateAbilityUseCase),
  );
  await adminAuthGuardPlugin(fastify);
  await requireAbilityPlugin(fastify);
  await requireSuperAdminPlugin(fastify);
});
