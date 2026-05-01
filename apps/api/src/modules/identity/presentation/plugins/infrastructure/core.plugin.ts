import fp from "fastify-plugin";
// import path from "path";
// import fs from "fs";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { BcryptPasswordHasher } from "@/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { resolveRsaKey } from "@/core/utils/key.util";

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

  container.register(BcryptPasswordHasher, () => {
    return new BcryptPasswordHasher();
  });

  container.register(CryptoTokenGenerator, () => {
    return new CryptoTokenGenerator();
  });

  container.register(RS256JwtService, () => {
    return new RS256JwtService(privateKey, publicKey);
  });
});
