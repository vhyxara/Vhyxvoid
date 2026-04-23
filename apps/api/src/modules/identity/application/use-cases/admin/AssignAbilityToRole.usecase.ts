// identity/application/usecases/admin/AssignAbilityToRoleUseCase.ts

import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotFoundError } from "@/core/errors/error.format";

export class AssignAbilityToRoleUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(
    roleId: string,
    abilityId: string,
    assignedBy: string,
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

        // Assign ability to role
        await (prisma as any).adminRoleAbility.upsert({
          where: { roleId_abilityId: { roleId, abilityId } },
          update: {},
          create: { roleId, abilityId },
        });

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: assignedBy,
          action: AuditAction.ABILITY_ASSIGNED,
          targetType: "AdminRoleAbility",
          targetId: roleId,
          changes: {
            before: null,
            after: { abilityId },
          },
        });

        await adminAuditLogRepository.save(auditLog);
      },
    );
  }
}
