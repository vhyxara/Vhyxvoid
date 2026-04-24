// ============================================================
// RESET PASSWORD USE CASE
//
// Validates the token, hashes the new password, saves it,
// then revokes ALL existing sessions — forces re-login on
// every device. This is the correct security behaviour after
// a password change.
// ============================================================

import { NotFoundError } from "@/core/errors/error.format";

import { PasswordHasher } from "@/modules/identity/domain/services/PasswordHasher";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotificationService } from "@/modules/notification/application/use-cases";

export class ResetPasswordUseCase {
  constructor(
    private uow: PrismaUnitOfWork,
    private passwordHasher: PasswordHasher,
    private notificationService?: NotificationService, // ← add
  ) {}

  async execute(params: {
    rawToken: string;
    newPassword: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ message: string }> {
    const now = new Date();
    const tokenHash = TokenHasher.hash(params.rawToken);

    return this.uow.execute(
      async ({
        passwordResetTokenRepository,
        userRepository,
        sessionRepository,
        auditLogRepository,
      }) => {
        // 1. Find and validate token
        const token = await passwordResetTokenRepository.findByHash(tokenHash);
        if (!token) throw new NotFoundError("Invalid or expired reset token");

        token.ensureValid(now);

        // 2. Load user
        const user = await userRepository.findById(token.userId);
        if (!user) throw new NotFoundError("User not found");

        // 3. Hash new password
        const passwordHash = await this.passwordHasher.hash(params.newPassword);

        // 4. Update user password + reset lockout state
        user.resetPassword(passwordHash, now);

        // 5. Mark token used — prevents replay
        token.markUsed(now);

        // 6. Revoke ALL sessions — force re-login everywhere
        await sessionRepository.revokeAllByUserId(user.id, now);

        // 7. Persist
        await userRepository.save(user);
        await passwordResetTokenRepository.save(token);

        await auditLogRepository.create({
          userId: user.id,
          action: "PASSWORD_RESET_COMPLETED",
          resourceType: "User",
          resourceId: user.id,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });
        // ResetPassword.usecase.ts — add after audit log
        if (this.notificationService) {
          console.log(
            "[ResetPasswordUseCase] Sending password reset success notification to user:",
            {
              email: user.email,
              firstName: user.firstName,
            },
          );
          this.notificationService.sendPasswordResetSuccess
            .execute({ to: user.email, firstName: user.firstName })
            .catch((err) =>
              console.error(
                "[notifications] sendPasswordResetSuccess failed",
                err,
              ),
            );
        }

        return {
          message:
            "Password reset successfully. Please log in with your new password.",
        };
      },
    );
  }
}
