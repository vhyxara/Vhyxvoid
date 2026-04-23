// application/use-cases/RemoveMemberUseCase.ts

import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

export class RemoveMemberUseCase {
  constructor(private uow: PrismaUnitOfWork) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.uow.execute(
      async ({ membershipRepository, auditLogRepository }) => {
        const actor = await membershipRepository.findByAccountAndUser(
          params.accountId,
          params.actorUserId,
        );

        const target = await membershipRepository.findByAccountAndUser(
          params.accountId,
          params.targetUserId,
        );

        if (!actor) throw new NotFoundError("Actor not member");
        if (!target) throw new NotFoundError("Target not member");

        const isSelfRemoval = params.actorUserId === params.targetUserId;

        // =========================
        // 🧍 SELF LEAVE
        // =========================
        if (isSelfRemoval) {
          if (target.isOwner()) {
            const ownerCount = await membershipRepository.countOwners(
              params.accountId,
            );

            if (ownerCount <= 1) {
              throw new ForbiddenError(
                "Cannot leave as last owner. Transfer ownership first.",
              );
            }
          }

          await membershipRepository.delete(
            params.accountId,
            params.targetUserId,
          );

          await auditLogRepository.create({
            accountId: params.accountId,
            userId: params.actorUserId,
            targetUserId: params.targetUserId,
            action: "ACCOUNT_MEMBER_LEFT",
            resourceType: "AccountMembership",
            resourceId: params.targetUserId,
            ipAddress: params.ipAddress,
            userAgent: params.userAgent,
          });

          return { success: true };
        }

        // =========================
        // 👥 REMOVE OTHER USER
        // =========================

        // 1️⃣ Must be ADMIN or OWNER
        if (!actor.isAdmin())
          throw new ForbiddenError("Only admins and owners can remove members");

        // 2️⃣ Cannot remove equal or higher
        if (!actor.canManage(target)) {
          throw new ForbiddenError(
            "Cannot remove a member with equal or higher role than yours",
          );
        }

        // 3️⃣ Prevent removing last OWNER

        if (target.isOwner()) {
          const ownerCount = await membershipRepository.countOwners(
            params.accountId,
          );
          if (ownerCount <= 1)
            throw new ForbiddenError("Cannot remove the last owner");
        }
        await membershipRepository.delete(
          params.accountId,
          params.targetUserId,
        );

        await auditLogRepository.create({
          accountId: params.accountId,
          userId: params.actorUserId,
          targetUserId: params.targetUserId, // FIX: now populated
          action: "ACCOUNT_MEMBER_REMOVED",
          resourceType: "AccountMembership",
          resourceId: params.targetUserId,
          metadata: { removedRoleLevel: target.roleLevel },
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });

        return {
          accountId: params.accountId,
          removedUserId: params.targetUserId,
        };
      },
    );
  }
}
