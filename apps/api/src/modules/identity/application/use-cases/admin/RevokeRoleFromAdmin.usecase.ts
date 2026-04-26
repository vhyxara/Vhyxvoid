// identity/application/usecases/admin/RevokeRoleFromAdminUseCase.ts

import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { ConflictError, NotFoundError } from "@/core/errors/error.format";

export class RevokeRoleFromAdminUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(
    adminId: string,
    roleId: string,
    revokedBy: string,
    reason?: string,
  ): Promise<void> {
    return this.uow.execute(
      async ({ adminUserRepository, adminAuditLogRepository, prisma }) => {
        // Verify admin exists
        const admin = await adminUserRepository.findById(adminId);
        if (!admin) {
          throw new NotFoundError("Admin not found");
        }

        // Cannot revoke roles from super admin
        if (admin.isSuperAdmin) {
          throw new ConflictError("Cannot revoke roles from super admin");
        }

        // Delete assignment
        await (prisma as any).adminUserRole.delete({
          where: { adminId_roleId: { adminId, roleId } },
        });

        // Record revocation history
        await (prisma as any).adminUserRoleHistory.create({
          data: {
            adminId,
            roleId,
            assignedBy: revokedBy,
            action: "revoked",
            reason,
          },
        });

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: revokedBy,
          action: AuditAction.ROLE_REVOKED,
          targetType: "AdminUserRole",
          targetId: adminId,
          metadata: { reason: reason ?? `roleId:${roleId}` },
        });

        await adminAuditLogRepository.save(auditLog);
      },
    );
  }
}
