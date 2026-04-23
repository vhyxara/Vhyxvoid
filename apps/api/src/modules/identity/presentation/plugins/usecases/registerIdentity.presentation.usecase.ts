import { Container } from "@/core/container/container";

import { RegisterUserUseCase } from "@/modules/identity/application/use-cases/user/Register.usecase";
import { LoginUseCase } from "@/modules/identity/application/use-cases/user/Login.usecase";
import { RefreshTokenUseCase } from "@/modules/identity/application/use-cases/user/RefreshSession.usecase";
import { VerifyEmailUseCase } from "@/modules/identity/application/use-cases/user/VerifyEmail.usecase";
import {
  LogoutUseCase,
  LogoutAllUseCase,
} from "@/modules/identity/application/use-cases/user/Logout.usecase";

import { TTL } from "@/core/constant/ttl.constant";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { BcryptPasswordHasher } from "@/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { NotificationService } from "@/modules/notification/application/use-cases";
import { GetAccountMembersUseCase } from "@/modules/identity/application/use-cases/user/GetAccountMembers.usecase";
import { ResetPasswordUseCase } from "@/modules/identity/application/use-cases/user/ResetPassword.usecase";
import { RequestPasswordResetUseCase } from "@/modules/identity/application/use-cases/user/RequestPasswordReset.usecase";
export function registerIdentityUseCases(container: Container) {
  container.register(
    RegisterUserUseCase,
    (c) =>
      new RegisterUserUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(BcryptPasswordHasher),
        c.resolve(CryptoTokenGenerator),
        c.resolve(NotificationService),
      ),
  );

  container.register(
    LoginUseCase,
    (c) =>
      new LoginUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(RS256JwtService),
        c.resolve(CryptoTokenGenerator),
        c.resolve(BcryptPasswordHasher),
        TTL.ACCESS_TOKEN_SEC,
        TTL.REFRESH_TOKEN_MS,
      ),
  );

  container.register(
    RefreshTokenUseCase,
    (c) =>
      new RefreshTokenUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(RS256JwtService),
        c.resolve(CryptoTokenGenerator),
        TTL.REFRESH_TOKEN_MS,
      ),
  );

  container.register(
    VerifyEmailUseCase,
    (c) => new VerifyEmailUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    LogoutUseCase,
    (c) => new LogoutUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    LogoutAllUseCase,
    (c) => new LogoutAllUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    GetAccountMembersUseCase,
    (c) => new GetAccountMembersUseCase(c.resolve(PrismaUnitOfWork)),
  );

  container.register(
    RequestPasswordResetUseCase,
    (c) =>
      new RequestPasswordResetUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(CryptoTokenGenerator),
        c.resolve(NotificationService),
      ),
  );

  container.register(
    ResetPasswordUseCase,
    (c) =>
      new ResetPasswordUseCase(
        c.resolve(PrismaUnitOfWork),
        c.resolve(BcryptPasswordHasher),
      ),
  );
}
