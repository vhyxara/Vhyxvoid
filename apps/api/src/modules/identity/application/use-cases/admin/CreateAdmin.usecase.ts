// identity/application/usecases/admin/CreateAdminUseCase.ts

import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { AdminUser } from "@/modules/identity/domain/entities/admin/AdminUser.entities";
import { PasswordHasher } from "@/modules/identity/domain/services/PasswordHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { ConflictError } from "@/core/errors/error.format";

export class CreateAdminUseCase {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(
    params: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
    },
    createdBy: string, // admin ID who is creating this
  ): Promise<{ id: string; email: string; fullName: string }> {
    return this.uow.execute(
      async ({ adminUserRepository, adminAuditLogRepository }) => {
        // Check duplicate email
        const existing = await adminUserRepository.findByEmail(params.email);
        if (existing) {
          throw new ConflictError("Admin with this email already exists");
        }

        // Hash password
        const passwordHash = await this.passwordHasher.hash(params.password);

        // Create admin
        const admin = AdminUser.create({
          email: params.email,
          passwordHash,
          firstName: params.firstName,
          lastName: params.lastName,
        });

        await adminUserRepository.save(admin);

        // Audit log
        const auditLog = AdminAuditLog.create({
          adminId: createdBy,
          action: AuditAction.ADMIN_CREATED,
          targetType: "AdminUser",
          targetId: admin.id,
          changes: {
            before: null,
            after: {
              email: admin.email,
              firstName: admin.firstName,
              lastName: admin.lastName,
            },
          },
        });

        await adminAuditLogRepository.save(auditLog);

        return {
          id: admin.id,
          email: admin.email,
          fullName: admin.fullName,
        };
      },
    );
  }
}
