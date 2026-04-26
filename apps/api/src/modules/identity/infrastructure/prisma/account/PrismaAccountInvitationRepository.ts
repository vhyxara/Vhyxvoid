import { InvitationStatus } from "@/generated/prisma";
import {
  AccountInvitation,
  AccountInvitationProps,
} from "@/modules/identity/domain/entities/account/AccountInvitation.entities";
import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { InvitationRepository } from "@/modules/identity/domain/repositories/account/Account.repositories";

export class PrismaAccountInvitationRepository implements InvitationRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(invitation: AccountInvitation): Promise<void> {
    const p = invitation.toPersistence();
    await this.prisma.accountInvitation.upsert({
      where: { id: p.id },
      update: {
        status: p.status,
        acceptedAt: p.acceptedAt,
        canceledAt: p.canceledAt,
      },
      create: {
        id: p.id,
        accountId: p.accountId,
        email: p.email,
        roleId: p.roleId, // FIX: FK — was missing entirely
        roleLevel: p.roleLevel, // FIX: denormalized Int — was missing
        tokenHash: p.tokenHash,
        status: p.status,
        expiresAt: p.expiresAt,
        acceptedAt: p.acceptedAt,
        canceledAt: p.canceledAt,
        invitedById: p.invitedById,
        createdAt: p.createdAt,
      },
    });
  }

  async findById(id: string): Promise<AccountInvitation | null> {
    const data = await this.prisma.accountInvitation.findUnique({
      where: { id },
    });
    return data
      ? AccountInvitation.rehydrate(data as AccountInvitationProps)
      : null;
  }

  async findByTokenHash(tokenHash: string): Promise<AccountInvitation | null> {
    const data = await this.prisma.accountInvitation.findUnique({
      where: { tokenHash },
    });
    return data
      ? AccountInvitation.rehydrate(data as AccountInvitationProps)
      : null;
  }

  async findPendingByEmail(
    accountId: string,
    email: string,
  ): Promise<AccountInvitation | null> {
    const data = await this.prisma.accountInvitation.findFirst({
      where: {
        accountId,
        email: email.toLowerCase().trim(),
        status: InvitationStatus.PENDING,
      },
    });
    return data
      ? AccountInvitation.rehydrate(data as AccountInvitationProps)
      : null;
  }

  async findByAccountId(
    accountId: string,
    options: { status?: string; limit?: number } = {},
  ): Promise<AccountInvitation[]> {
    const rows = await this.prisma.accountInvitation.findMany({
      // where: {
      //   accountId,
      //   ...(options.status ? { status: options.status } : {}),
      // },
      where: {
        accountId,
        ...(options.status ? { status: options.status as any } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 100,
    });
    return rows.map((r) =>
      AccountInvitation.rehydrate(r as AccountInvitationProps),
    );
  }
}
