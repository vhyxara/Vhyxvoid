// // identity/application/use-cases/RegisterUser.ts
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { ConflictError } from "@/core/errors/error.format";
import { BcryptPasswordHasher } from "@/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { Email } from "@/modules/identity/domain/value-objects/Email";
import { User } from "@/modules/identity/domain/entities/user/User.entities";
import { Account } from "@/modules/identity/domain/entities/account/Account.entities";
import { Role } from "@/modules/identity/domain/entities/account/Role.entities";
import { AccountMembership } from "@/modules/identity/domain/entities/account/AccountMember.entities";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { EmailVerificationToken } from "@/modules/identity/domain/entities/user/EmailVerificationToken.entities";
import { NotificationService } from "@/modules/notification/application/use-cases";

export class RegisterUserUseCase {
  constructor(
    private uow: PrismaUnitOfWork,
    private passwordHasher: BcryptPasswordHasher,
    // private jwtService: RS256JwtService,
    private tokenGenerator: CryptoTokenGenerator,

    private notificationService: NotificationService,
    // private refreshTokenTTL = 60 * 60 * 24 * 30 * 1000 // e.g., 30 days in ms
  ) {}
  async execute(dto: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }): Promise<{ email: string; requiresVerification: boolean }> {
    const emailVO = Email.create(dto.email);

    return this.uow.execute(
      async ({
        userRepository,
        emailTokenRepository,
        accountRepository,
        roleRepository,
        membershipRepository,
      }) => {
        // 1️⃣ Duplicate check
        const existing = await userRepository.findByEmail(emailVO.value);
        if (existing) throw new ConflictError("Email already registered");

        // 2️⃣ Hash password
        const passwordHash = await this.passwordHasher.hash(dto.password);

        // 3️⃣ Create and persist user
        const user = User.register({
          email: emailVO.value,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        });
        await userRepository.save(user);

        // 4. Create personal account — createdById is now properly stored
        const personalAccount = Account.createPersonal(user.id, dto.firstName);
        await accountRepository.save(personalAccount);

        // 5. Seed system roles for this account (OWNER, ADMIN, MEMBER)
        // const [ownerRole, ,] = Role.seedSystemRoles(personalAccount.id);
        const roles = Role.seedSystemRoles(personalAccount.id);
        console.log("roles-----", roles);
        await roleRepository.saveBatch(roles);
        const ownerRole = roles[0];
        // 6. Fetch persisted owner role (or use the in-memory one — same id)
        const ownership = AccountMembership.createOwner(
          personalAccount.id,
          user.id,
          ownerRole,
        );
        await membershipRepository.save(ownership);

        const rawToken = this.tokenGenerator.generate(32);
        const tokenHash = TokenHasher.hash(rawToken);

        const verificationToken = EmailVerificationToken.create({
          userId: user.id,
          tokenHash,
          ttlMs: 1000 * 60 * 60 * 24, // 24h
        });
        if (this.notificationService) {
          this.notificationService.sendEmailVerification
            .execute({
              to: user.email,
              firstName: user.firstName,
              rawToken,
            })
            .catch((err) =>
              console.error("[notifications] verify email failed", err),
            );
        } else {
          console.log("EMAIL VERIFY TOKEN:", rawToken);
        }
        await emailTokenRepository.save(verificationToken);

        // 4️⃣ Issue access token
        // const accessToken = this.jwtService.sign(
        //   { sub: user.id, email: user.email },
        //   { expiresIn: "15m" }
        // );

        // 5️⃣ Create session with hashed refresh token
        // const rawRefreshToken = this.tokenGenerator.generate();
        // const tokenHash = TokenHasher.hash(rawRefreshToken);

        // const session = Session.create({
        //   userId: user.id,
        //   tokenHash,
        //   ttlMs: this.refreshTokenTTL,
        // });

        // await sessionRepository.save(session);

        // 7️⃣ Generate Email Verification Token (can be another JWT or crypto string)
        // const emailVerificationToken = this.tokenGenerator.generate(32);

        // Optionally persist email verification token in a separate table or cache

        // return {
        //   message: "Registration successful. Please verify your email.",
        // };
        return {
          email: user.email,
          requiresVerification: true,
        };
      },
    );
  }
}
