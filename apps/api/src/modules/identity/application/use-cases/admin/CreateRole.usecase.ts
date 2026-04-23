// identity/application/usecases/admin/CreateRoleUseCase.ts

import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { AdminRole } from "@/modules/identity/domain/entities/admin/AdminRole.entities";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { ConflictError } from "@/core/errors/error.format";
// import { NotFoundError } from '@/DDD/domain/error/error.format';

export class CreateRoleUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(
    params: { name: string; description?: string },
    createdBy: string,
  ): Promise<{ id: string; name: string; description: string | null }> {
    return this.uow.execute(
      async ({ adminRoleRepository, adminAuditLogRepository }) => {
        // Check duplicate name
        const existing = await adminRoleRepository.findByName(params.name);
        if (existing) {
          throw new ConflictError("Role with this name already exists");
        }

        // Create role
        const role = AdminRole.create({
          name: params.name,
          description: params.description,
        });

        await adminRoleRepository.save(role);

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: createdBy,
          action: AuditAction.ROLE_CREATED,
          targetType: "AdminRole",
          targetId: role.id,
          changes: {
            before: null,
            after: {
              name: role.name,
              description: role.description,
            },
          },
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
