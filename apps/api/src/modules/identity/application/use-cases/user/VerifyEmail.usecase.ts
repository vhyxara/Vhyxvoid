// identity/application/use-cases/VerifyEmail.ts

// import { UserRepository } from "../../domain/repositories/UserRepository";
// import { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
// import { TokenGenerator } from "../../domain/services/TokenGenerator";
// import { EmailVerificationToken } from "../../domain/entities/EmailVerificationToken";
import { NotFoundError } from "@/core/errors/error.format";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

export class VerifyEmailUseCase {
  constructor(private uow: PrismaUnitOfWork) {}

  async execute(rawToken: string) {
    const now = new Date();
    const tokenHash = TokenHasher.hash(rawToken);
    // const rawToken = this.tokenGenerator.generate(32);

    return this.uow.execute(
      async ({ emailTokenRepository, userRepository }) => {
        const token = await emailTokenRepository.findByHash(tokenHash);
        if (!token) throw new Error("Invalid token");

        token.ensureValid(new Date());

        const user = await userRepository.findById(token.userId);
        if (!user) throw new NotFoundError("User not found");

        user.verifyEmail(now);
        token.markUsed(now);

        await userRepository.save(user);
        await emailTokenRepository.save(token);

        return { email: user.email };
      },
    );
  }
}
