import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

export class LogoutUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(rawRefreshToken: string) {
    const now = new Date();
    const tokenHash = TokenHasher.hash(rawRefreshToken);
    return this.uow.execute(async ({ sessionRepository }) => {
      const session = await sessionRepository.findByTokenHash(tokenHash);
      if (!session || session.isRevoked()) {
        return; // idempotent logout
      }

      session.revoke(now);
      await sessionRepository.save(session);
      return;
    });
  }
}

export class LogoutAllUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(userId: string) {
    const now = new Date();

    return this.uow.execute(async ({ sessionRepository }) => {
      await sessionRepository.revokeAllByUserId(userId, now);
      return { success: true };
    });
  }
}
