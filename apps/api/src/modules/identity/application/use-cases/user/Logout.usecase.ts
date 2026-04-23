import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

export class LogoutUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(rawRefreshToken: string) {
    const now = new Date();
    const tokenHash = TokenHasher.hash(rawRefreshToken);
    console.log("4", tokenHash);
    return this.uow.execute(async ({ sessionRepository }) => {
      const session = await sessionRepository.findByTokenHash(tokenHash);
      console.log("5", session);
      if (!session || session.isRevoked()) {
        return; // idempotent logout
      }

      session.revoke(now);
      console.log("6", session);
      await sessionRepository.save(session);
      console.log("7", session);
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
