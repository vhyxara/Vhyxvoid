// identity/infrastructure/prisma/PrismaSessionRepository.ts
import { Prisma, PrismaClient } from "@/generated/prisma";
import {
  Session,
  SessionProps,
} from "@/modules/identity/domain/entities/user/Session.entities";
import { SessionRepository } from "@/modules/identity/domain/repositories/user/Session.repositories";

type PrismaTransactionalClient = PrismaClient | Prisma.TransactionClient;

export class PrismaSessionRepository implements SessionRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(session: Session): Promise<void> {
    const p = session.toPersistence();
    await this.prisma.session.upsert({
      where: { id: p.id },
      update: {
        tokenHash: p.tokenHash,
        expiresAt: p.expiresAt,
        revokedAt: p.revokedAt,
      },
      create: {
        id: p.id,
        userId: p.userId,
        tokenHash: p.tokenHash,
        expiresAt: p.expiresAt,
        revokedAt: p.revokedAt,
        createdAt: p.createdAt,
        ipAddress: p.ipAddress,
        userAgent: p.userAgent,
      },
    });
  }
  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const data = await this.prisma.session.findUnique({
      where: { tokenHash },
    });
    // if (!data) return null;
    // return Session.rehydrate(data);
    return data ? Session.rehydrate(data as SessionProps) : null;
  }

  async revokeById(id: string): Promise<void> {
    await this.prisma.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllByUserId(userId: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });
  }

  async countActiveByUserId(userId: string, now: Date): Promise<number> {
    return this.prisma.session.count({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
  }

  async revokeOldestActiveSession(userId: string, now: Date): Promise<void> {
    const oldest = await this.prisma.session.findFirst({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "asc" },
    });

    if (oldest) {
      await this.prisma.session.update({
        where: { id: oldest.id },
        data: { revokedAt: now },
      });
    }
  }
  // PrismaSessionRepository — atomic oldest-session eviction
  async evictIfOverLimit(
    userId: string,
    maxSessions: number,
    now: Date,
  ): Promise<void> {
    // Find IDs to keep (newest N)
    const activeSessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (activeSessions.length >= maxSessions) {
      const toRevoke = activeSessions.slice(maxSessions - 1).map((s) => s.id);
      await this.prisma.session.updateMany({
        where: { id: { in: toRevoke } },
        data: { revokedAt: now },
      });
    }
  }
}
