import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import {
  EmailVerificationToken,
  EmailVerificationTokenProps,
} from "@/modules/identity/domain/entities/user/EmailVerificationToken.entities";

export class PrismaEmailTokenRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(token: EmailVerificationToken): Promise<void> {
    const p = token.toPersistence();
    await this.prisma.emailVerificationToken.upsert({
      where: { id: p.id },
      update: {
        tokenHash: p.tokenHash,
        expiresAt: p.expiresAt,
        usedAt: p.usedAt,
      },
      create: {
        id: p.id,
        userId: p.userId,
        tokenHash: p.tokenHash,
        expiresAt: p.expiresAt,
        usedAt: p.usedAt,
      },
    });
  }

  async findByHash(tokenHash: string): Promise<EmailVerificationToken | null> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    return record
      ? EmailVerificationToken.rehydrate(record as EmailVerificationTokenProps)
      : null;
  }
}
