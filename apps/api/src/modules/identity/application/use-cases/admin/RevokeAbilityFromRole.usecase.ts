// identity/application/usecases/admin/RevokeAbilityFromRoleUseCase.ts

import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotFoundError } from "@/core/errors/error.format";

export class RevokeAbilityFromRoleUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(
    roleId: string,
    abilityId: string,
    revokedBy: string,
  ): Promise<void> {
    return this.uow.execute(
      async ({
        adminRoleRepository,
        adminAbilityRepository,
        adminAuditLogRepository,
        prisma,
      }) => {
        // Verify role exists
        const role = await adminRoleRepository.findById(roleId);
        if (!role) {
          throw new NotFoundError("Role not found");
        }

        // Verify ability exists
        const ability = await adminAbilityRepository.findById(abilityId);
        if (!ability) {
          throw new NotFoundError("Ability not found");
        }

        // Delete assignment
        await (prisma as any).adminRoleAbility.delete({
          where: { roleId_abilityId: { roleId, abilityId } },
        });

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: revokedBy,
          action: AuditAction.ABILITY_REVOKED,
          targetType: "AdminRoleAbility",
          targetId: roleId,
          metadata: { reason: `abilityId:${abilityId}` },
        });

        await adminAuditLogRepository.save(auditLog);
      },
    );
  }
}
