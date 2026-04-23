// identity/infrastructure/repositories/PrismaAdminSessionRepository.ts

import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { AdminSessionRepository } from "@/modules/identity/domain/repositories/admin/AdminSession.repositories";
// import { AdminSessionRepository } from '@/identity/domain/repositories/admin/AdminRepositories';

export class PrismaAdminSessionRepository implements AdminSessionRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(session: any): Promise<void> {
    const p = session.toPersistence?.() || session;

    await this.prisma.adminSession.upsert({
      where: { id: p.id },
      update: {
        tokenHash: p.tokenHash,
        expiresAt: p.expiresAt,
        revokedAt: p.revokedAt,
      },
      create: p,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<any | null> {
    return this.prisma.adminSession.findUnique({
      where: { tokenHash },
    });
  }

  async revokeById(id: string): Promise<void> {
    await this.prisma.adminSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllByAdminId(adminId: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async countActiveByAdminId(adminId: string, now: Date): Promise<number> {
    return this.prisma.adminSession.count({
      where: {
        adminId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
  }
}
