import { PrismaClient } from "@/generated/prisma";
import { PasswordResetTokenRepository } from "@/modules/identity/domain/repositories/user/PasswordResetToken.repositories";

export class PrismaPasswordResetTokenRepository implements PasswordResetTokenRepository {
  constructor(private prisma: PrismaClient) {}

  async save(token: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
  }): Promise<void> {
    await this.prisma.passwordResetToken.upsert({
      where: { id: token.id },
      create: token,
      update: { usedAt: token.usedAt },
    });
  }

  async findByHash(tokenHash: string): Promise<{
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null> {
    return await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
  }

  async deleteAllByUserId(userId: string): Promise<void> {
    await this.prisma.passwordResetToken.deleteMany({ where: { userId } });
  }
}
