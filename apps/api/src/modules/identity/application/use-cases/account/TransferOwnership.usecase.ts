// application/use-cases/TransferOwnershipUseCase.ts

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

export class TransferOwnershipUseCase {
  constructor(private uow: PrismaUnitOfWork) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.uow.execute(
      async ({ membershipRepository, roleRepository, auditLogRepository }) => {
        // 1️⃣ Load memberships
        const actor = await membershipRepository.findByAccountAndUser(
          params.accountId,
          params.actorUserId,
        );

        const target = await membershipRepository.findByAccountAndUser(
          params.accountId,
          params.targetUserId,
        );

        if (!actor) throw new NotFoundError("Actor is not a member");
        if (!target) throw new NotFoundError("Target is not a member");
        // 2️⃣ Only OWNER can transfer ownership
        if (!actor.isOwner())
          throw new ForbiddenError("Only owners can transfer ownership");

        // 3️⃣ Cannot transfer to self
        if (params.actorUserId === params.targetUserId) {
          throw new ForbiddenError("Cannot transfer ownership to yourself");
        }

        // Resolve Role entities
        const ownerRole = await roleRepository.findSystemRoleByLevel(
          params.accountId,
          RoleLevel.OWNER,
        );
        const adminRole = await roleRepository.findSystemRoleByLevel(
          params.accountId,
          RoleLevel.ADMIN,
        );
        if (!ownerRole || !adminRole)
          throw new NotFoundError("System roles not found for this account");

        // Promote target to OWNER, demote actor to ADMIN
        target.changeRole(ownerRole);
        actor.changeRole(adminRole);

        // 4️⃣ Promote target to OWNER

        await membershipRepository.save(target);
        // 5️⃣ Demote actor to ADMIN (or MEMBER if you prefer)
        await membershipRepository.save(actor);

        // 6️⃣ Audit log
        await auditLogRepository.create({
          accountId: params.accountId,
          userId: params.actorUserId,
          targetUserId: params.targetUserId, // FIX: now populated
          action: "ACCOUNT_OWNERSHIP_TRANSFERRED",
          resourceType: "AccountMembership",
          resourceId: params.targetUserId,

          metadata: {
            previousOwner: params.actorUserId,
            newOwner: params.targetUserId,
          },

          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });

        return {
          accountId: params.accountId,
          previousOwner: params.actorUserId,
          newOwner: params.targetUserId,
        };
      },
    );
  }
}
