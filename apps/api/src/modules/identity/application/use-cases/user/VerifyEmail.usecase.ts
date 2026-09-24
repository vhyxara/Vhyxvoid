// identity/application/use-cases/VerifyEmail.ts

// import { UserRepository } from "../../domain/repositories/UserRepository";
// import { EmailVerificationRepository } from "../../domain/repositories/EmailVerificationRepository";
// import { TokenGenerator } from "../../domain/services/TokenGenerator";
// import { EmailVerificationToken } from "../../domain/entities/EmailVerificationToken";
import { NotFoundError } from "@/core/errors/error.format";
import { generateAccountSlug } from "@/core/utils/slug.util";
import { Account } from "@/modules/identity/domain/entities/account/Account.entities";
import { AccountMembership } from "@/modules/identity/domain/entities/account/AccountMember.entities";
import { Role } from "@/modules/identity/domain/entities/account/Role.entities";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

const MAX_SLUG_ATTEMPTS = 5;

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
        if (!token) throw new Error("Invalid token");
        token.ensureValid(now);

        const user = await userRepository.findById(token.userId);
        if (!user) throw new NotFoundError("User not found");

        // Mark email verified
        user.verifyEmail(now);
        token.markUsed(now);
        await userRepository.save(user);
        await emailTokenRepository.save(token);

        // NOW create account + roles + membership
        // Only runs once — check if personal account already exists
        const existingAccounts = await accountRepository.findByUserId(user.id);
        if (existingAccounts.length === 0) {
          const personalAccount = Account.createPersonal(
            user.id,
            user.firstName,
          );

          // The slug always carries a random suffix (audit H11), so a taken
          // one is a random collision: draw again rather than fall back to a
          // name-derived slug.
          for (let attempt = 1; ; attempt++) {
            const slug = personalAccount.slug!;
            if (!(await accountRepository.findBySlug(slug))) break;
            if (attempt >= MAX_SLUG_ATTEMPTS) {
              throw new Error("Could not allocate a unique account slug");
            }
            personalAccount.setSlug(generateAccountSlug(personalAccount.name), now);
          }
          await accountRepository.save(personalAccount);

          const roles = Role.seedSystemRoles(personalAccount.id);
          await roleRepository.saveBatch(roles);

          const ownerRole = roles[0];
          const ownership = AccountMembership.createOwner(
            personalAccount.id,
            user.id,
            ownerRole,
          );
          await membershipRepository.save(ownership);
        }

        return { email: user.email };
      },
    );
  }
}
