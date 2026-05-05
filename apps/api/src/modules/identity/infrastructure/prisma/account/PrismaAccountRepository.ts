import {
  Account,
  AccountProps,
} from "@/modules/identity/domain/entities/account/Account.entities";
import { AccountRepository } from "@/modules/identity/domain/repositories/account/Account.repositories";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";

export class PrismaAccountRepository implements AccountRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(account: Account): Promise<void> {
    const p = account.toPersistence();
    await this.prisma.account.upsert({
      where: { id: p.id },
      update: {
        name: p.name ?? undefined, // null → undefined (Prisma skips undefined fields)
        status: p.status,
        slug: p.slug ?? undefined, // ← ADD
        graceEndsAt: p.graceEndsAt, // FIX: was missing — status changes wouldn't persist
        deletedAt: p.deletedAt, // FIX: was missing — soft delete wouldn't persist
        updatedAt: p.updatedAt,
      },
      create: {
        id: p.id,
        name: p.name ?? "", // null → empty string for NOT NULL column
        type: p.type,
        status: p.status,
        slug: p.slug, // ← ADD
        createdBy: { connect: { id: p.createdById } }, // FIX: was missing — NOT NULL constraint violation
        // createdById: p.createdById, // FIX: was missing — NOT NULL constraint violation
        graceEndsAt: p.graceEndsAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        deletedAt: p.deletedAt,
      },
    });
  }
  async findById(id: string): Promise<Account | null> {
    const data = await this.prisma.account.findUnique({ where: { id } });
    return data ? Account.rehydrate(data as AccountProps) : null;
  }

  async findBySlug(slug: string): Promise<Account | null> {
    const data = await this.prisma.account.findUnique({
      where: { slug },
    });
    return data ? Account.rehydrate(data as AccountProps) : null;
  }

  async findByUserId(userId: string): Promise<Account[]> {
    const memberships = await this.prisma.accountMember.findMany({
      where: { userId },
      include: { account: true },
    });
    return memberships.map((m) => Account.rehydrate(m.account as AccountProps));
  }
}
