// identity/application/use-cases/VerifyEmail.ts

// import { UserRepository } from "../../domain/repositories/UserRepository";
// import { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
// import { TokenGenerator } from "../../domain/services/TokenGenerator";
// import { EmailVerificationToken } from "../../domain/entities/EmailVerificationToken";
import { NotFoundError, ValidationError } from "@/core/errors/error.format";
import { ensurePersonalAccount } from "@/modules/identity/application/services/personalAccount";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

export class VerifyEmailUseCase {
  constructor(private uow: PrismaUnitOfWork) {}

  async execute(rawToken: string) {
    const now = new Date();
    const tokenHash = TokenHasher.hash(rawToken);

    return this.uow.execute(
      async ({
        emailTokenRepository,
        userRepository,
        accountRepository,
        roleRepository,
        membershipRepository,
      }) => {
        const token = await emailTokenRepository.findByHash(tokenHash);
        if (!token) throw new ValidationError("Invalid or expired verification link");
        token.ensureValid(now);

        const user = await userRepository.findById(token.userId);
        if (!user) throw new NotFoundError("User not found");

        // Mark email verified
        user.verifyEmail(now);
        token.markUsed(now);
        await userRepository.save(user);
        await emailTokenRepository.save(token);

        // Proven inbox ownership: create the personal workspace.
        await ensurePersonalAccount(
          user,
          { accountRepository, roleRepository, membershipRepository },
          now,
        );

        return { email: user.email };
      },
    );
  }
}
