// identity/application/usecases/admin/UpdateRoleUseCase.ts

import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotFoundError } from "@/core/errors/error.format";

export class UpdateRoleUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(
    roleId: string,
    params: { name?: string; description?: string },
    updatedBy: string,
  ): Promise<{ id: string; name: string; description: string | null }> {
    return this.uow.execute(
      async ({ adminRoleRepository, adminAuditLogRepository }) => {
        // Find role
        const role = await adminRoleRepository.findById(roleId);
        if (!role) {
          throw new NotFoundError("Role not found");
        }

        const before = role.toPersistence();

        // Update role
        role.update(params, new Date());

        await adminRoleRepository.save(role);

        const after = role.toPersistence();

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: updatedBy,
          action: AuditAction.ROLE_UPDATED,
          targetType: "AdminRole",
          targetId: roleId,
          changes: { before, after },
        });

        await adminAuditLogRepository.save(auditLog);

        return {
          id: role.id,
          name: role.name,
          description: role.description,
        };
      },
    );
  }
}
