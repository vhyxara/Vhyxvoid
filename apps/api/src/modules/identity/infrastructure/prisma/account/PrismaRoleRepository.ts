import { RoleRepository } from "@/modules/identity/domain/repositories/account/Account.repositories";
import {
  Role,
  RoleProps,
} from "@/modules/identity/domain/entities/account/Role.entities";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";
// import { Role, RoleProps } from '@/AGradeDDD/files/files/Role';

export class PrismaRoleRepository implements RoleRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(role: Role): Promise<void> {
    const p = role.toPersistence();
    await this.prisma.role.upsert({
      where: { id: p.id },
      update: {
        name: p.name,
        description: p.description,
        level: p.level,
        isActive: p.isActive,
        updatedAt: p.updatedAt,
      },
      create: {
        id: p.id,
        accountId: p.accountId,
        name: p.name,
        description: p.description,
        level: p.level,
        isSystem: p.isSystem,
        isActive: p.isActive,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      },
    });
  }

  async saveBatch(roles: Role[]): Promise<void> {
    // Use createMany for efficient batch insert (new roles only — no upsert needed for seeding)
    await this.prisma.role.createMany({
      data: roles.map((r) => {
        const p = r.toPersistence();
        return {
          id: p.id,
          accountId: p.accountId,
          name: p.name,
          description: p.description,
          level: p.level,
          isSystem: p.isSystem,
          isActive: p.isActive,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        };
      }),
      skipDuplicates: true,
    });
  }

  async findById(id: string): Promise<Role | null> {
    const data = await this.prisma.role.findUnique({ where: { id } });
    return data ? Role.rehydrate(data as RoleProps) : null;
  }

  async findByAccountId(accountId: string): Promise<Role[]> {
    const data = await this.prisma.role.findMany({
      where: { accountId, isActive: true },
    });
    return data.map((d) => Role.rehydrate(d as RoleProps));
  }

  async findSystemRoleByLevel(
    accountId: string,
    level: number,
  ): Promise<Role | null> {
    const data = await this.prisma.role.findFirst({
      where: { accountId, level, isSystem: true, isActive: true },
    });
    return data ? Role.rehydrate(data as RoleProps) : null;
  }
}
