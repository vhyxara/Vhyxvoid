// identity/application/usecases/admin/DeactivateRoleUseCase.ts

import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotFoundError } from "@/core/errors/error.format";

export class DeactivateRoleUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(roleId: string, deactivatedBy: string): Promise<void> {
    return this.uow.execute(
      async ({ adminRoleRepository, adminAuditLogRepository }) => {
        const role = await adminRoleRepository.findById(roleId);
        if (!role) {
          throw new NotFoundError("Role not found");
        }

        const before = role.toPersistence();
        role.deactivate(new Date());
        await adminRoleRepository.save(role);
        const after = role.toPersistence();

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: deactivatedBy,
          action: AuditAction.ROLE_DEACTIVATED,
          targetType: "AdminRole",
          targetId: roleId,
          changes: { before, after },
        });

        await adminAuditLogRepository.save(auditLog);
      },
    );
  }
}
