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
        replacedById: p.replacedById ?? null,
        replacementTokenCipher: p.replacementTokenCipher ?? null,
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

  /**
   * findByTokenHash with the row locked (SELECT ... FOR UPDATE) until the
   * surrounding transaction ends. Two concurrent refreshes of the same token
   * used to both read it as not-yet-rotated and both mint a successor; the
   * second now waits and then sees the first's rotation. Audit H10.
   */
  async findByTokenHashForUpdate(tokenHash: string): Promise<Session | null> {
    await this.prisma.$queryRaw`SELECT id FROM "Session" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
    return this.findByTokenHash(tokenHash);
  }

  async findById(id: string): Promise<Session | null> {
    const data = await this.prisma.session.findUnique({ where: { id } });
    return data ? Session.rehydrate(data as SessionProps) : null;
  }

  /** Drop successor ciphertexts older than the grace window: they are never read again. */
  async purgeRotationCiphers(userId: string, olderThan: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, replacementTokenCipher: { not: null }, revokedAt: { lt: olderThan } },
      data: { replacementTokenCipher: null },
    });
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
    // No successor is live after a revoke-all, so no ciphertext is useful.
    await this.prisma.session.updateMany({
      where: { userId, replacementTokenCipher: { not: null } },
      data: { replacementTokenCipher: null },
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
