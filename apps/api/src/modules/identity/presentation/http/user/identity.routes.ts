import { FastifyInstance } from "fastify";
import { AUTH_RATE_LIMITS } from "@/core/constant/rateLimit.constant";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { RegisterUserDTO } from "@/modules/identity/application/dto/admin.dto";
import {
  registerSchema,
  LoginDTO,
  loginSchema,
  VerifyEmailDTO,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  ResetPasswordDTO,
  ForgotPasswordDTO,
  changePasswordSchema,
  ChangePasswordDTO,
  resendVerificationSchema,
  ResendVerificationDTO,
} from "@/modules/identity/application/dto/user.dto";
import { successResponse } from "@/core/utils/response.util";
import {
  clearRefreshCookie,
  getRefreshCookie,
  setRefreshCookie,
} from "@/core/utils/auth.util";
import { BcryptPasswordHasher } from "@/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotFoundError, ValidationError } from "@/core/errors/error.format";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { EmailVerificationToken } from "@/modules/identity/domain/entities/user/EmailVerificationToken.entities";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";

export async function identityRoutes(fastify: FastifyInstance) {
  /**
   * Register
   * POST /auth/register
   * Public
   *
   * Creates user + personal account + seeds system roles in one transaction.
   * Returns a verification token in console (dev). Wire to email in prod.
   */
  fastify.post<{ Body: RegisterUserDTO }>(
    "/register",
    { config: { rateLimit: AUTH_RATE_LIMITS.register } },
    async (request, reply) => {
      // const data = validate<RegisterUserDTO>(
      //   registerSchema,
      //   request.body,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails
      const input = registerSchema.parse(request.body);
      const result = await fastify.registerUserUseCase.execute(input);
      // return reply.code(201).send(result);

      return successResponse(
        reply,
        "Registration successful. Please verify your email.",
        201,
        result,
      );
    },
  );

  /**
   * POST /auth/resend-verification
   * Resends the email verification link to an unverified account.
   * Always returns 200 — never reveals whether the email exists.
   * No auth required — user cannot log in yet.
   *
   * Also handles the case where user tries to register again
   * with the same unverified email — RegisterUserUseCase already
   * handles that silently, but this gives the frontend a dedicated
   * button to trigger a resend without re-registering.
   */
  fastify.post<{ Body: ResendVerificationDTO }>(
    "/resend-verification",
    { config: { rateLimit: AUTH_RATE_LIMITS.resendVerification } },
    async (request, reply) => {
      const { email } = resendVerificationSchema.parse(request.body);

      const successMessage = {
        message:
          "If your account exists and is unverified, a new verification email has been sent.",
      };

      // Look up user outside transaction — no point locking if user doesn't exist
      const user = await fastify.uow.userRepository.findByEmail(
        email.toLowerCase().trim(),
      );

      // Always return success — never reveal whether email is registered
      if (!user || user.isEmailVerified) {
        return reply.send(successMessage);
      }

      await fastify.uow.execute(async ({ emailTokenRepository, afterCommit }) => {
        // Delete all existing tokens — only one active at a time
        await emailTokenRepository.deleteAllByUserId(user.id);

        // const rawToken = fastify.tokenGenerator.generate(32);
        const rawToken = fastify.container
          .resolve(CryptoTokenGenerator)
          .generate(32);
        const tokenHash = TokenHasher.hash(rawToken);

        const verificationToken = EmailVerificationToken.create({
          userId: user.id,
          tokenHash,
          ttlMs: 1000 * 60 * 60 * 24, // 24h
        });

        await emailTokenRepository.save(verificationToken);

        // Fire and forget — never block the response on email delivery
        afterCommit(() =>
          fastify.notificationService.sendEmailVerification
            .execute({
              to: user.email,
              firstName: user.firstName,
              rawToken,
            })
            .catch((err) =>
              console.error("[notifications] resend-verification failed", err),
            )
        );
      });

      return successResponse(reply, successMessage.message, 200);
    },
  );
  /**
   * Login
   * POST /auth/login
   * Public
   *
   * Returns accessToken (15 min JWT) + refreshToken (30 day opaque token).
   * Store accessToken in memory. Store refreshToken in httpOnly cookie or
   * secure storage — never localStorage.
   */
  fastify.post<{ Body: LoginDTO }>(
    "/login",
    { config: { rateLimit: AUTH_RATE_LIMITS.login } },
    async (request, reply) => {
      // const data = validate<LoginDTO>(loginSchema, request.body, reply);
      // if (!data) return errorResponse(reply, "Invalid input"); // stops execution if validation fails
      const input = loginSchema.parse(request.body);
      const result = await fastify.loginUseCase.execute(
        input.email,
        input.password,
        request.ip,
        request.headers["user-agent"] ?? "unknown",
      );
      // return reply.send(result);
      setRefreshCookie(reply, result.refreshToken);

      return successResponse(reply, "Login successful", 200, {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: result.user,
        // refreshToken intentionally omitted from body
      });
    },
  );

  /**
   * Refresh Token
   * POST /auth/refresh
   * Public (uses refresh token, not access token)
   *
   * Rotates the refresh token — old one is immediately revoked.
   * If the old token is reused after rotation, ALL sessions are revoked
   * (token reuse detection).
   */
  fastify.post("/refresh", async (request, reply) => {
    const refreshToken = getRefreshCookie(request);

    if (!refreshToken) {
      // return reply
      //   .status(401)
      //   .send({ success: false, message: "No refresh token" });
      throw new ValidationError("No refresh token");
    }

    const result = await fastify.refreshTokenUseCase.execute(refreshToken);

    // Rotate cookie — old one is replaced automatically
    setRefreshCookie(reply, result.refreshToken);

    return successResponse(reply, "Refresh successful", 200, {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      // refreshToken intentionally omitted from body
    });
  });

  /**
   * Verify Email
   * POST /auth/verify-email
   * Public
   *
   * token: the raw token logged to console after registration (dev).
   * In prod: extract from verification email link query param.
   */
  fastify.post<{ Body: VerifyEmailDTO }>(
    "/verify-email",
    async (request, reply) => {
      // const data = validate<VerifyEmailDTO>(
      //   verifyEmailSchema,
      //   request.body,
      //   reply,
      // );
      // if (!data) return errorResponse(reply, "Invalid input"); // stops execution if validation fails
      const { token } = verifyEmailSchema.parse(request.body);
      const result = await fastify.verifyEmailUseCase.execute(token);
      // return reply.send(result);

      return successResponse(
        reply,
        "Email verification successful",
        200,
        result,
      );
    },
  );

  /**
   * Logout
   * POST /auth/logout
   * Public (refresh token is the credential — no access token needed)
   *
   * Revokes the specific session identified by the refresh token.
   * Idempotent — safe to call even if already logged out.
   */
  fastify.post("/logout", async (request, reply) => {
    const refreshToken = getRefreshCookie(request);

    if (refreshToken) {
      await fastify.logoutUseCase.execute(refreshToken);
    }

    clearRefreshCookie(reply);

    return successResponse(reply, "Logged out", 200, null);
  });
  /**
   * Logout All Sessions
   * POST /auth/logout-all
   * Auth: User JWT required
   *
   * Revokes ALL active sessions for the authenticated user.
   * Forces logout on all devices.
   */
  fastify.post(
    "/logout-all",
    { onRequest: fastify.userAuthGuard },
    async (request, reply) => {
      // const data = validate<LogoutAllDTO>(logoutAllSchema, request.body, reply);
      // if (!data) return errorResponse(reply, "Invalid input"); // stops execution if validation fails
      const user = getUserContext(request);
      await fastify.logoutAllUseCase.execute(user.id);
      clearRefreshCookie(reply);
      return reply.code(204).send();
      // return successResponse(reply, "Logout all successful", 204);
    },
  );

  /**
   * POST /auth/forgot-password
   * Step 1 of password reset. Accepts an email, sends reset link.
   *
   * Security: always returns 200 with the same message whether the
   * email exists or not — prevents enumeration of registered accounts.
   * Rate limiting should be applied at the infrastructure level (nginx/gateway).
   */
  fastify.post<{ Body: ForgotPasswordDTO }>(
    "/forgot-password",
    { config: { rateLimit: AUTH_RATE_LIMITS.forgotPassword } },
    async (request, reply) => {
      const { email } = forgotPasswordSchema.parse(request.body);
      const result = await fastify.requestPasswordResetUseCase.execute({
        email,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });
      return successResponse(
        reply,
        "If an account with that email exists, a password reset link has been sent.",
        200,
        result,
      );
    },
  );

  /**
   * POST /auth/reset-password
   * Step 2 of password reset. Validates token, sets new password,
   * revokes all sessions.
   *
   * Token comes from the email link: ?token=<rawToken>
   * Frontend reads it from the URL and POSTs it here.
   */
  fastify.post<{ Body: ResetPasswordDTO }>(
    "/reset-password",
    async (request, reply) => {
      const { token, newPassword } = resetPasswordSchema.parse(request.body);

      const result = await fastify.resetPasswordUseCase.execute({
        rawToken: token,
        newPassword,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });

      // return reply.send(result);
      return successResponse(
        reply,
        "Password reset successful. Please log in with your new password.",
        200,
        result,
      );
    },
  );

  /**
   * POST /accounts/me/password
   * Change password for authenticated user.
   * Requires current password — not a reset, a deliberate change.
   * Revokes all OTHER sessions but keeps the current one active
   * so the user doesn't get logged out mid-session.
   */
  fastify.post<{ Body: ChangePasswordDTO }>(
    "/me/password",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { currentPassword, newPassword } = changePasswordSchema.parse(
        request.body,
      );
      const { id: userId } = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);
      const passwordHasher = fastify.container.resolve(BcryptPasswordHasher);
      const user = await uow.userRepository.findById(userId);
      if (!user) {
        throw new NotFoundError("User not found");
      }
      // Verify current password — must match before allowing change
      const isValid = await passwordHasher.compare(
        currentPassword,
        user.passwordHash,
      );

      if (!isValid) {
        throw new ValidationError("Current password is incorrect");
      }
      // Reject if new password is the same as current
      const isSame = await passwordHasher.compare(
        newPassword,
        user.passwordHash,
      );
      if (isSame) {
        throw new ValidationError(
          "New password must be different from current password",
        );
      }

      const newHash = await passwordHasher.hash(newPassword);
      const now = new Date();

      await uow.execute(
        async ({ userRepository, sessionRepository, auditLogRepository }) => {
          user.resetPassword(newHash, now);
          await userRepository.save(user);

          // Revoke all OTHER sessions — keep current session alive
          // The current session's refresh token is in the request cookie
          // We can't identify it server-side without the raw token, so we
          // revoke all and the frontend will use the current accessToken
          // until it expires (max 15 min), then redirect to login.
          // Simpler and safer than trying to preserve one session.
          await sessionRepository.revokeAllByUserId(userId, now);

          await auditLogRepository.create({
            userId,
            action: "PASSWORD_CHANGED",
            resourceType: "User",
            resourceId: userId,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"] ?? "unknown",
          });
        },
      );
      // resetPassword() bumped tokenVersion; drop the cached copy so every
      // access token issued before the change stops working now (audit H2).
      await fastify.authStateCache.invalidateUser(userId);

      return successResponse(
        reply,
        "Password changed successfully. Please log in again.",
        200,
        null,
      );
    },
  );
}

// export async function identityRoutes(fastify: FastifyInstance) {
// Register User
// fastify.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
//   console.log('hello');
//   const input = registerSchema.parse(request.body);
//   console.log('input', input);
//   const useCase: RegisterUserUseCase = fastify.registerUserUseCase;
//   // console.log("use case", useCase)
//   const result = await useCase.execute(input);
//   return reply.code(201).send(result);
// });

// // Login User
// fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
//   const input = loginSchema.parse(request.body);
//   const useCase: LoginUseCase = fastify.loginUseCase;
//   const ipAddress = request.ip;
//   const userAgent = request.headers['user-agent'] ?? 'unknown';
//   const result = await useCase.execute(input.email, input.password, ipAddress, userAgent);
//   return reply.send(result);
// });

// Refresh Token
// fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
//   const { refreshToken } = request.body as { refreshToken: string };
//   const useCase: RefreshTokenUseCase = fastify.refreshTokenUseCase;
//   const result = await useCase.execute(refreshToken);
//   return reply.send(result);
// });

// // Email Verification
// fastify.post('/verify-email', async (request: FastifyRequest, reply: FastifyReply) => {
//   const { token } = request.body as { token: string };
//   const useCase: VerifyEmailUseCase = fastify.verifyEmailUseCase;
//   // try {
//   const result = await useCase.execute(token);
//   return reply.send(result);
//   // } catch (error) {
//   //   return reply.code(400).send({ error: 'Invalid or expired token' });
//   // }
// });

// fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
//   const { refreshToken } = request.body as { refreshToken: string };
//   const useCase: LogoutUseCase = fastify.logoutUseCase;
//   const result = await useCase.execute(refreshToken);
//   return reply.code(204).send(result);
// });

// fastify.post('/logout-all', async (request: FastifyRequest, reply: FastifyReply) => {
//   // const { refreshToken } = request.body as { refreshToken: string };
//   const useCase: LogoutAllUseCase = fastify.LogoutAllUseCase;
//   const userId = request.user.sub;
//   console.log('user id ', userId);
//   const result = await useCase.execute(userId);
//   return reply.code(204).send(result);
// });
// }
