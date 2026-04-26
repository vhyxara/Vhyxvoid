// identity/application/usecases/admin/AssignRoleToAdminUseCase.ts

import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { ConflictError, NotFoundError } from "@/core/errors/error.format";

export class AssignRoleToAdminUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(
    adminId: string,
    roleId: string,
    assignedBy: string,
    reason?: string,
  ): Promise<void> {
    return this.uow.execute(
      async ({
        adminUserRepository,
        adminRoleRepository,
        adminAuditLogRepository,
        prisma,
      }) => {
        // Verify admin exists
        const admin = await adminUserRepository.findById(adminId);
        if (!admin) {
          throw new NotFoundError("Admin not found");
        }

        // Cannot assign roles to super admin
        if (admin.isSuperAdmin) {
          throw new ConflictError("Cannot assign roles to super admin");
        }

        // Verify role exists
        const role = await adminRoleRepository.findById(roleId);
        if (!role) {
          throw new NotFoundError("Role not found");
        }

        // Assign role (upsert)
        await (prisma as any).adminUserRole.upsert({
          where: { adminId_roleId: { adminId, roleId } },
          update: {},
          create: { adminId, roleId },
        });

        // Record assignment history
        await (prisma as any).adminUserRoleHistory.create({
          data: {
            adminId,
            roleId,
            assignedBy,
            action: "assigned",
            reason,
          },
        });

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: assignedBy,
          action: AuditAction.ROLE_ASSIGNED,
          targetType: "AdminUserRole",
          targetId: adminId,
          changes: {
            before: null,
            after: { roleId, assignedAt: new Date() },
          },
          metadata: { reason },
        });

        await adminAuditLogRepository.save(auditLog);
      },
    );
  }
}
