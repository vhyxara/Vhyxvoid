import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { LoginUseCase } from "@/modules/identity/application/use-cases/user/Login.usecase";
import {
  LogoutAllUseCase,
  LogoutUseCase,
} from "@/modules/identity/application/use-cases/user/Logout.usecase";
import { RefreshTokenUseCase } from "@/modules/identity/application/use-cases/user/RefreshSession.usecase";
import { RegisterUserUseCase } from "@/modules/identity/application/use-cases/user/Register.usecase";
import { VerifyEmailUseCase } from "@/modules/identity/application/use-cases/user/VerifyEmail.usecase";
import { ResetPasswordUseCase } from "../../application/use-cases/user/ResetPassword.usecase";
import { RequestPasswordResetUseCase } from "../../application/use-cases/user/RequestPasswordReset.usecase";

export default fp(async (fastify: FastifyInstance) => {
  const container = fastify.container;

  fastify.decorate("loginUseCase", container.resolve(LoginUseCase));
  fastify.decorate(
    "registerUserUseCase",
    container.resolve(RegisterUserUseCase),
  );

  fastify.decorate(
    "refreshTokenUseCase",
    container.resolve(RefreshTokenUseCase),
  );

  fastify.decorate("verifyEmailUseCase", container.resolve(VerifyEmailUseCase));

  fastify.decorate("logoutUseCase", container.resolve(LogoutUseCase));

  fastify.decorate("logoutAllUseCase", container.resolve(LogoutAllUseCase));
  fastify.decorate(
    "requestPasswordResetUseCase",
    container.resolve(RequestPasswordResetUseCase),
  );
  fastify.decorate(
    "resetPasswordUseCase",
    container.resolve(ResetPasswordUseCase),
  );
});
