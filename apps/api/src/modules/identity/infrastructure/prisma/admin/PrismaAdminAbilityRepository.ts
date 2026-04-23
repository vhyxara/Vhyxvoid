// identity/infrastructure/repositories/PrismaAdminAbilityRepository.ts
import { AdminAbility } from "@/modules/identity/domain/entities/admin/AdminAbility.entities";
// import { AdminAbilityRepository } from '@/AGradeDDD/identity/domain/repositories/admin/AdminRepositories';
import { Prisma } from "@/generated/prisma";
import { AdminAbilityRepository } from "@/modules/identity/domain/repositories/admin/AdminAbility.repositories";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";

export class PrismaAdminAbilityRepository implements AdminAbilityRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(ability: AdminAbility): Promise<void> {
    const p = ability.toPersistence();

    await this.prisma.adminAbility.upsert({
      where: { id: p.id },
      update: {
        description: p.description,
        isActive: p.isActive,
        updatedAt: p.updatedAt,
      },
      create: {
        id: p.id,
        action: p.action,
        category: p.category,
        description: p.description,
        isSystem: p.isSystem,
        isActive: p.isActive,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    });
  }

  async findById(id: string): Promise<AdminAbility | null> {
    const data = await this.prisma.adminAbility.findUnique({
      where: { id },
    });

    if (!data) return null;

    return AdminAbility.rehydrate({
      id: data.id,
      action: data.action,
      category: data.category,
      description: data.description,
      isSystem: data.isSystem,
      isActive: data.isActive,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findByAction(
    category: string,
    action: string,
  ): Promise<AdminAbility | null> {
    const data = await this.prisma.adminAbility.findUnique({
      where: { category_action: { category, action } },
    });

    if (!data) return null;

    return AdminAbility.rehydrate({
      id: data.id,
      action: data.action,
      category: data.category,
      description: data.description,
      isSystem: data.isSystem,
      isActive: data.isActive,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findAll(filters?: {
    isActive?: boolean;
    category?: string;
  }): Promise<AdminAbility[]> {
    const where: Prisma.AdminAbilityWhereInput = {};

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters?.category) {
      where.category = filters.category;
    }

    const data = await this.prisma.adminAbility.findMany({ where });

    return data.map((d) =>
      AdminAbility.rehydrate({
        id: d.id,
        action: d.action,
        category: d.category,
        description: d.description,
        isSystem: d.isSystem,
        isActive: d.isActive,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }),
    );
  }

  async findByRoleId(roleId: string): Promise<AdminAbility[]> {
    const data = await this.prisma.adminAbility.findMany({
      where: {
        roles: {
          some: { roleId },
        },
      },
    });

    return data.map((d) =>
      AdminAbility.rehydrate({
        id: d.id,
        action: d.action,
        category: d.category,
        description: d.description,
        isSystem: d.isSystem,
        isActive: d.isActive,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }),
    );
  }

  async findByAdminId(adminId: string): Promise<AdminAbility[]> {
    const data = await this.prisma.adminAbility.findMany({
      where: {
        roles: {
          some: {
            role: {
              users: {
                some: { adminId },
              },
            },
          },
        },
      },
    });

    return data.map((d) =>
      AdminAbility.rehydrate({
        id: d.id,
        action: d.action,
        category: d.category,
        description: d.description,
        isSystem: d.isSystem,
        isActive: d.isActive,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      }),
    );
  }

  async delete(id: string): Promise<void> {
    await this.prisma.adminAbility.delete({
      where: { id },
    });
  }

  async adminHasAbility(adminId: string, ability: string): Promise<boolean> {
    const result = await this.prisma.adminAbility.findFirst({
      where: {
        action: ability,
        isActive: true,
        roles: {
          some: {
            role: {
              isActive: true,
              users: {
                some: {
                  adminId,
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });

    return !!result;
  }
}
