// identity/infrastructure/repositories/PrismaAdminRoleRepository.ts

// import { AdminRoleRepository } from '@/AGradeDDD/identity/domain/repositories/admin/AdminRepositories';
// import { PrismaTransactionalClient } from './PrismaAdminRepositories';
import { PrismaTransactionalClient } from "@/core/types/core/prisma";

import { AdminRole } from "@/modules/identity/domain/entities/admin/AdminRole.entities";
import { AdminRoleRepository } from "@/modules/identity/domain/repositories/admin/AdminRole.repositories";
import { Prisma } from "@/generated/prisma";

export class PrismaAdminRoleRepository implements AdminRoleRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(role: AdminRole): Promise<void> {
    const p = role.toPersistence();

    await this.prisma.adminRole.upsert({
      where: { id: p.id },
      update: {
        name: p.name,
        description: p.description,
        isActive: p.isActive,
        updatedAt: p.updatedAt,
      },
      create: {
        id: p.id,
        name: p.name,
        description: p.description,
        isSystem: p.isSystem,
        isActive: p.isActive,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    });
  }

  async findById(id: string): Promise<AdminRole | null> {
    const data = await this.prisma.adminRole.findUnique({
      where: { id },
    });

    if (!data) return null;

    return AdminRole.rehydrate({
      id: data.id,
      name: data.name,
      description: data.description,
      isSystem: data.isSystem,
      isActive: data.isActive,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findByName(name: string): Promise<AdminRole | null> {
    const data = await this.prisma.adminRole.findUnique({
      where: { name },
    });

    if (!data) return null;

    return AdminRole.rehydrate({
      id: data.id,
      name: data.name,
      description: data.description,
      isSystem: data.isSystem,
      isActive: data.isActive,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findAll(filters?: {
    isActive?: boolean;
    isSystem?: boolean;
  }): Promise<AdminRole[]> {
    const where: Prisma.AdminRoleWhereInput = {};

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters?.isSystem !== undefined) {
      where.isSystem = filters.isSystem;
    }

    const data = await this.prisma.adminRole.findMany({ where });

    return data.map((d) =>
      AdminRole.rehydrate({
        id: d.id,
        name: d.name,
        description: d.description,
        isSystem: d.isSystem,
        isActive: d.isActive,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }),
    );
  }

  async findByAdminId(adminId: string): Promise<AdminRole[]> {
    const data = await this.prisma.adminRole.findMany({
      where: {
        users: {
          some: { adminId },
        },
      },
    });

    return data.map((d) =>
      AdminRole.rehydrate({
        id: d.id,
        name: d.name,
        description: d.description,
        isSystem: d.isSystem,
        isActive: d.isActive,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }),
    );
  }

  async delete(id: string): Promise<void> {
    // In real code, you'd verify it's not a system role
    await this.prisma.adminRole.delete({
      where: { id },
    });
  }
}
