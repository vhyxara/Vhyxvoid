import { AccountStatus, AccountType } from "@/generated/prisma";
import {
  AccountMembership,
  AccountMembershipProps,
} from "@/modules/identity/domain/entities/account/AccountMember.entities";

import { MembershipRepository } from "@/modules/identity/domain/repositories/account/Account.repositories";
import { RoleLevel } from "@/core/constant/account.constant";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private prisma: PrismaTransactionalClient) {}
  async save(membership: AccountMembership): Promise<void> {
    console.log("Initializing PrismaMembershipRepository with prisma client:");
    const p = membership.toPersistence();
    await this.prisma.accountMember.upsert({
      where: {
        userId_accountId: { userId: p.userId, accountId: p.accountId }, // FIX: composite PK
      },
      update: {
        roleId: p.roleId,
        roleLevel: p.roleLevel,
      },
      create: {
        userId: p.userId,
        accountId: p.accountId,
        roleId: p.roleId,
        roleLevel: p.roleLevel,
        createdAt: p.createdAt,
      },
    });
  }

  async findOwnerPersonalAccount(userId: string): Promise<string | null> {
    console.log("PA PrismaMembershipRepository with prisma client:");

    const membership = await this.prisma.accountMember.findFirst({
      where: {
        userId,
        roleLevel: RoleLevel.OWNER, // FIX: use roleLevel (Int), not roleId or string enum
        account: {
          type: AccountType.PERSONAL,
          status: AccountStatus.ACTIVE,
        },
      },
      select: { accountId: true },
    });
    return membership?.accountId ?? null;
  }

  async findByAccountAndUser(
    accountId: string,
    userId: string,
  ): Promise<AccountMembership | null> {
    console.log("AU PrismaMembershipRepository with prisma client:");

    const data = await this.prisma.accountMember.findUnique({
      // FIX: accountMember not accountMembership
      where: { userId_accountId: { userId, accountId } },
    });
    return data
      ? AccountMembership.rehydrate(data as AccountMembershipProps)
      : null;
  }

  async findAllByAccount(accountId: string): Promise<AccountMembership[]> {
    console.log("AA PrismaMembershipRepository with prisma client:");

    const data = await this.prisma.accountMember.findMany({
      where: { accountId },
    });
    return data.map((d) =>
      AccountMembership.rehydrate(d as AccountMembershipProps),
    );
  }

  async findAllByUser(userId: string): Promise<AccountMembership[]> {
    console.log("fau  PrismaMembershipRepository with prisma client:");

    const data = await this.prisma.accountMember.findMany({
      where: { userId },
    });
    return data.map((d) =>
      AccountMembership.rehydrate(d as AccountMembershipProps),
    );
  }

  // For large accounts — add this method to PrismaMembershipRepository
  async findAllByAccountWithDetails(accountId: string) {
    return this.prisma.accountMember.findMany({
      where: { accountId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            isEmailVerified: true,
          },
        },
        role: {
          select: { id: true, name: true, level: true, description: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async updateRole(
    accountId: string,
    userId: string,
    roleId: string,
    roleLevel: RoleLevel,
  ): Promise<void> {
    await this.prisma.accountMember.update({
      where: {
        userId_accountId: {
          userId,
          accountId,
        },
      },
      data: { roleId: roleId, roleLevel: roleLevel }, // FIX: update both roleId and roleLevel atomically
    });
  }

  async countOwners(accountId: string): Promise<number> {
    return this.prisma.accountMember.count({
      where: {
        accountId,
        roleLevel: RoleLevel.OWNER, // FIX: was hardcoded 100 as a magic number
      },
    });
  }

  async delete(accountId: string, userId: string): Promise<void> {
    await this.prisma.accountMember.delete({
      where: { userId_accountId: { userId, accountId } },
    });
  }
}
