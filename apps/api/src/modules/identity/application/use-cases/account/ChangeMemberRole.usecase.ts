// application/use-cases/ChangeMemberRoleUseCase.ts

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

export class ChangeMemberRoleUseCase {
  constructor(private uow: PrismaUnitOfWork) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    newRoleLevel: RoleLevel;
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
        ); // FIX: declared before use

        if (!actor)
          throw new NotFoundError("Actor is not a member of this account");
        if (!target)
          throw new NotFoundError("Target is not a member of this account");

        const oldRoleLevel = target.roleLevel; // FIX: read after target is defined

        // Actor must be at least ADMIN
        if (!actor.isAdmin())
          throw new ForbiddenError("Only admins and owners can change roles");

        // Cannot modify equal or higher role (domain method)
        if (!actor.canManage(target)) {
          throw new ForbiddenError(
            "Cannot modify a member with equal or higher role than yours",
          );
        }

        // Cannot promote beyond your own level (domain method)
        if (!actor.canPromoteTo(params.newRoleLevel)) {
          throw new ForbiddenError(
            "Cannot assign a role equal or higher than your own",
          );
        }
        // Prevent demoting last owner
        if (target.isOwner() && params.newRoleLevel !== RoleLevel.OWNER) {
          const ownerCount = await membershipRepository.countOwners(
            params.accountId,
          );
          if (ownerCount <= 1)
            throw new ForbiddenError("Cannot demote the last owner");
        }

        // Look up the target Role entity so we update both roleId and roleLevel
        const newRole = await roleRepository.findSystemRoleByLevel(
          params.accountId,
          params.newRoleLevel,
        );
        if (!newRole)
          throw new NotFoundError("Target role not found for this account");

        // 2️⃣ Actor must be at least ADMIN
        if (actor.roleLevel < RoleLevel.ADMIN) {
          throw new Error("Not allowed to change roles");
        }

        // 3️⃣ Cannot modify someone with equal or higher role
        if (actor.roleLevel <= oldRoleLevel) {
          throw new Error("Cannot modify equal or higher role");
        }

        // 4️⃣ ADMIN cannot promote to OWNER
        if (
          actor.roleLevel === RoleLevel.ADMIN &&
          params.newRoleLevel === RoleLevel.OWNER
        ) {
          throw new Error("Admin cannot promote to owner");
        }

        // 5️⃣ Prevent demoting last OWNER
        if (
          oldRoleLevel === RoleLevel.OWNER &&
          params.newRoleLevel !== RoleLevel.OWNER
        ) {
          const ownerCount = await membershipRepository.countOwners(
            params.accountId,
          );

          if (ownerCount <= 1) {
            throw new Error("Cannot demote last owner");
          }
        }

        // 6️⃣ Update role
        await membershipRepository.updateRole(
          params.accountId,
          params.targetUserId,
          newRole.id,
          newRole.level,
          // params.newRoleLevel,
        );
        target.changeRole(newRole); // FIX: updates both roleId + roleLevel atomically

        // 7️⃣ Audit log

        await membershipRepository.save(target);

        await auditLogRepository.create({
          accountId: params.accountId,
          userId: params.actorUserId,
          targetUserId: params.targetUserId, // FIX: now populated
          action: "ACCOUNT_MEMBER_ROLE_CHANGED",
          resourceType: "AccountMembership",
          resourceId: params.targetUserId,
          metadata: { oldRoleLevel, newRoleLevel: params.newRoleLevel },
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });

        return {
          accountId: params.accountId,
          userId: params.targetUserId,
          newRoleLevel: params.newRoleLevel,
        };
      },
    );
  }
}
