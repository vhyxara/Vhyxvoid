import { PrismaClient } from "@/generated/prisma";
import { PasswordResetToken } from "@/modules/identity/domain/entities/user/PasswordResetToken.entities";
import { PasswordResetTokenRepository } from "@/modules/identity/domain/repositories/user/PasswordResetToken.repositories";

export class PrismaPasswordResetTokenRepository implements PasswordResetTokenRepository {
  constructor(private prisma: PrismaClient) {}

  async save(token: PasswordResetToken): Promise<void> {
    const p = token.toPersistence();

    await this.prisma.passwordResetToken.upsert({
      where: { id: p.id },
      create: p,
      update: { usedAt: p.usedAt },
    });
  }

  async findByHash(tokenHash: string): Promise<PasswordResetToken | null> {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    // ← rehydrate into entity so ensureValid/markUsed exist
    return row ? PasswordResetToken.rehydrate(row) : null;
  }

  async deleteAllByUserId(userId: string): Promise<void> {
    await this.prisma.passwordResetToken.deleteMany({ where: { userId } });
  }
}
