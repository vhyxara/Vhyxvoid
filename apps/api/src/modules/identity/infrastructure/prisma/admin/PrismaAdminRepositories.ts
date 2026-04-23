// identity/infrastructure/repositories/PrismaAdminUserRepository.ts

// import { AdminAuditLog } from '@/AGradeDDD/identity/domain/entities/admin/AdminAuditLog';
// import { AdminAuditLogRepository } from '@/AGradeDDD/identity/domain/repositories/admin/AdminRepositories';
import { Prisma } from "@/generated/prisma";
import {
  // AdminAbilityRepository,
  // AdminRoleRepository,
  // AdminSessionRepository,
  AdminUserRepository,
} from "@/modules/identity/domain/repositories/admin/Admin.repositories";
import { AdminUser } from "@/modules/identity/domain/entities/admin/AdminUser.entities";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";
// import { AdminRole } from '@/AGradeDDD/identity/domain/entities/admin/AdminRole';
// import { AdminAbility } from '@/AGradeDDD/identity/domain/entities/admin/AdminAbility';

export class PrismaAdminUserRepository implements AdminUserRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(admin: AdminUser): Promise<void> {
    const p = admin.toPersistence();

    await this.prisma.adminUser.upsert({
      where: { id: p.id },
      update: {
        firstName: p.firstName,
        lastName: p.lastName,
        status: p.status,
        lastLoginAt: p.lastLoginAt,
        deletedAt: p.deletedAt,
        updatedAt: p.updatedAt,
        // ⚠️ Never allow isSuperAdmin to be changed in update
      },
      create: {
        id: p.id,
        email: p.email,
        passwordHash: p.passwordHash,
        firstName: p.firstName,
        lastName: p.lastName,
        isSuperAdmin: p.isSuperAdmin,
        status: p.status,
        lastLoginAt: p.lastLoginAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        deletedAt: p.deletedAt,
      },
    });
  }

  async findById(id: string): Promise<AdminUser | null> {
    const data = await this.prisma.adminUser.findUnique({
      where: { id },
    });

    if (!data) return null;

    return AdminUser.rehydrate({
      id: data.id,
      email: data.email,
      passwordHash: data.passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      isSuperAdmin: data.isSuperAdmin,
      status: data.status,
      lastLoginAt: data.lastLoginAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      deletedAt: data.deletedAt,
    });
  }

  async findByEmail(email: string): Promise<AdminUser | null> {
    const data = await this.prisma.adminUser.findUnique({
      where: { email },
    });

    if (!data) return null;

    return AdminUser.rehydrate({
      id: data.id,
      email: data.email,
      passwordHash: data.passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      isSuperAdmin: data.isSuperAdmin,
      status: data.status,
      lastLoginAt: data.lastLoginAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      deletedAt: data.deletedAt,
    });
  }

  async findAll(filters?: {
    isDeleted?: boolean;
    status?: boolean;
  }): Promise<AdminUser[]> {
    const where: Prisma.AdminUserWhereInput = {};
    console.log("PrismaAdminUserRepository.findAll - filters", filters);
    if (filters?.isDeleted === true) {
      where.deletedAt = { not: null };
    } else if (filters?.isDeleted === false) {
      where.deletedAt = null;
    }

    if (filters?.status !== undefined) {
      where.status = filters.status;
    }

    const data = await this.prisma.adminUser.findMany({ where });
    console.log("PrismaAdminUserRepository.findAll - data from DB", data);
    return data.map((d) =>
      AdminUser.rehydrate({
        id: d.id,
        email: d.email,
        passwordHash: d.passwordHash,
        firstName: d.firstName,
        lastName: d.lastName,
        isSuperAdmin: d.isSuperAdmin,
        status: d.status,
        lastLoginAt: d.lastLoginAt,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        deletedAt: d.deletedAt,
      }),
    );
  }

  async countTotal(): Promise<number> {
    return this.prisma.adminUser.count();
  }
}
