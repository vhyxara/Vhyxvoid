// ============================================================
// REQUEST PASSWORD RESET USE CASE
//
// Always returns success regardless of whether the email exists
// — prevents user enumeration attacks.
// TTL: 1 hour. Deletes any existing tokens for the user first
// so only one active reset token exists at a time.
// ============================================================

import { PasswordResetToken } from "@/modules/identity/domain/entities/user/PasswordResetToken.entities";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotificationService } from "@/modules/notification/application/use-cases";

export class RequestPasswordResetUseCase {
  constructor(
    private uow: PrismaUnitOfWork,
    private tokenGenerator: CryptoTokenGenerator,
    private notificationService?: NotificationService,
    // {
    // sendPasswordReset: {
    //   execute(p: {
    //     to: string;
    //     firstName: string;
    //     rawToken: string;
    //   }): Promise<void>;
    // };
    // },
  ) {}

  async execute(params: {
    email: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ message: string }> {
    const email = params.email.toLowerCase().trim();
    console.log("RequestPasswordResetUseCase received email:", email);
    // Look up user OUTSIDE transaction — no point holding a TX if user doesn't exist
    const user = await this.uow.userRepository.findByEmail(email);

    // Always return the same message — never reveal whether email exists
    const successMessage =
      "If an account exists for that email, a reset link has been sent.";

    if (!user) return { message: successMessage };

    // Soft-deleted or disabled users cannot reset
    if (!user.status) return { message: successMessage };

    await this.uow.execute(
      async ({ passwordResetTokenRepository, auditLogRepository }) => {
        // Delete any existing tokens for this user — one active token at a time
        await passwordResetTokenRepository.deleteAllByUserId(user.id);

        const rawToken = this.tokenGenerator.generate(32);
        const tokenHash = TokenHasher.hash(rawToken);

        const token = PasswordResetToken.create({
          userId: user.id,
          tokenHash,
          ttlMs: 1000 * 60 * 60, // 1 hour
        });

        await passwordResetTokenRepository.save(token.toPersistence());

        await auditLogRepository.create({
          userId: user.id,
          action: "PASSWORD_RESET_REQUESTED",
          resourceType: "User",
          resourceId: user.id,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });

        // Send email — fire and forget
        // if (this.notificationService) {
        //   this.notificationService.sendPasswordReset
        //     .execute({
        //       to: user.email,
        //       firstName: user.firstName,
        //       rawToken,
        //     })
        //     .catch((err) =>
        //       console.error("[notifications] sendPasswordReset failed", err),
        //     );
        // } else {
        //   console.log("[DEV] PASSWORD RESET TOKEN:", rawToken);
        // }
        console.log("[DEV] PASSWORD RESET TOKEN:", rawToken);
      },
    );

    return { message: successMessage };
  }
}
