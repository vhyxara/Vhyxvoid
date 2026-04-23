import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { CreateOrganizationUseCase } from "@/modules/identity/application/use-cases/account/CreateOrganization.usecase";
import { InviteMemberUseCase } from "@/modules/identity/application/use-cases/account/InviteMember.usecase";
import { AcceptInvitationUseCase } from "@/modules/identity/application/use-cases/account/AcceptInvitation.usecase";
import { ChangeMemberRoleUseCase } from "@/modules/identity/application/use-cases/account/ChangeMemberRole.usecase";
import { RemoveMemberUseCase } from "@/modules/identity/application/use-cases/account/RemoveMember.usecase";
import { TransferOwnershipUseCase } from "@/modules/identity/application/use-cases/account/TransferOwnership.usecase";
import { GetAccountMembersUseCase } from "../../application/use-cases/user/GetAccountMembers.usecase";

export default fp(async (fastify: FastifyInstance) => {
  const container = fastify.container;

  fastify.decorate(
    "createOrganizationUseCase",
    container.resolve(CreateOrganizationUseCase),
  );

  fastify.decorate(
    "inviteMemberUseCase",
    container.resolve(InviteMemberUseCase),
  );

  fastify.decorate(
    "acceptInvitationUseCase",
    container.resolve(AcceptInvitationUseCase),
  );
  fastify.decorate(
    "changeMemberRoleUseCase",
    container.resolve(ChangeMemberRoleUseCase),
  );

  fastify.decorate(
    "removeMemberUseCase",
    container.resolve(RemoveMemberUseCase),
  );

  fastify.decorate(
    "transferOwnershipUseCase",
    container.resolve(TransferOwnershipUseCase),
  );
  fastify.decorate(
    "getAccountMembersUseCase",
    fastify.container.resolve(GetAccountMembersUseCase),
  );
});
