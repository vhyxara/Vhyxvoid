import fp from "fastify-plugin";
// import path from "path";
// import fs from "fs";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { BcryptPasswordHasher } from "@/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { resolveRsaKey } from "@/core/utils/key.util";
import { CheckPlanLimitsService } from "@/modules/billing/domain/services/CheckPlanLimits.service";

export default fp(async (fastify) => {
  // const privateKeyPath = path.resolve(process.env.PRIVATE_KEY!);
  // const publicKeyPath = path.resolve(process.env.PUBLIC_KEY!);

  // // Read the actual key contents
  // const privateKey = fs.readFileSync(privateKeyPath, "utf-8");
  // const publicKey = fs.readFileSync(publicKeyPath, "utf-8");
  const privateKey = resolveRsaKey(
    process.env.PRIVATE_KEY,
    process.env.PRIVATE_KEY_B64,
    "private",
  );
  const publicKey = resolveRsaKey(
    process.env.PUBLIC_KEY,
    process.env.PUBLIC_KEY_B64,
    "public",
  );

  const container = fastify.container;

  container.register(PrismaUnitOfWork, () => {
    if (!fastify.prisma) {
      throw new Error("Prisma client not found on Fastify instance");
    }
    return new PrismaUnitOfWork(fastify.prisma);
  });

  // Same gap as the jwtService decoration below, found by the same smoke
  // test: core/types/core/fastify.d.ts declares fastify.uow: PrismaUnitOfWork,
  // and several routes read fastify.uow.<repo> directly (most heavily
  // admin.routes.ts -- GET /me, /users, /users/:id, /roles, /roles/:id,
  // /abilities, /roles/:roleId/abilities, /audit-logs, PUT /users/:id,
  // disable/enable -- plus one regular-user route,
  // identity.routes.ts's /resend-verification), but nothing ever decorated
  // it. Every use case resolved through fastify.container (AdminLoginUseCase,
  // CreateAdminUseCase, etc.) already receives PrismaUnitOfWork correctly via
  // constructor injection -- this only affects routes that read fastify.uow
  // directly instead of going through a use case, which is why the
  // extensively-verified regular-user/member/tunnel/api-key flows never hit
  // this, while most of the admin backend does. See
  // internal-tools/api/decision.md, 2026-09-17.
  fastify.decorate("uow", container.resolve(PrismaUnitOfWork));

  container.register(BcryptPasswordHasher, () => {
    return new BcryptPasswordHasher();
  });

  // Registered here (billing has no DI registration of its own; its
  // plugin builds infrastructure directly) so the account
  // module's InviteMember/AcceptInvitation use cases can resolve it via the
  // container, the same way billing.plugin.ts decorates
  // fastify.checkPlanLimitsService for the API-key limit guard. Both now
  // construct the same class the same way, just through two different entry
  // points (DI container vs. direct fastify decoration) -- not two copies.
  container.register(CheckPlanLimitsService, () => {
    if (!fastify.prisma) {
      throw new Error("Prisma client not found on Fastify instance");
    }
    return new CheckPlanLimitsService(fastify.prisma);
  });

  container.register(CryptoTokenGenerator, () => {
    return new CryptoTokenGenerator();
  });

  container.register(RS256JwtService, () => {
    return new RS256JwtService(privateKey, publicKey);
  });

  // core/types/core/fastify.d.ts declares fastify.jwtService: RS256JwtService,
  // and adminAuthGuard.plugin.ts reads it directly (fastify.jwtService, not
  // the DI container) -- but nothing ever actually decorated it. Confirmed
  // via a real login+authenticated-request smoke test while wiring up
  // apps/admin (internal-tools/admin-frontend/decision.md, 2026-09-17):
  // every adminAuthGuard-gated route (everything except /auth/login and
  // /auth/refresh, which resolve RS256JwtService via the container inside
  // their own use cases) unconditionally threw "Server misconfiguration:
  // JWT service not registered" -> 500 -> caught and rethrown as a 403,
  // regardless of a valid token or super-admin status. The regular-user
  // guard (userAuthGuard.ts) was never affected -- it resolves
  // RS256JwtService from the container directly rather than going through
  // this decorator. See internal-tools/api/decision.md, 2026-09-17.
  fastify.decorate("jwtService", container.resolve(RS256JwtService));
});
