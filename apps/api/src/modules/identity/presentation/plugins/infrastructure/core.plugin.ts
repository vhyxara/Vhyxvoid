import fp from "fastify-plugin";
// import path from "path";
// import fs from "fs";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { BcryptPasswordHasher } from "@/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { RS256JwtService } from "@/modules/identity/infrastructure/crypto/JwtService";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";

export default fp(async (fastify) => {
  // const privateKeyPath = path.resolve(process.env.PRIVATE_KEY!);
  // const publicKeyPath = path.resolve(process.env.PUBLIC_KEY!);

  // // Read the actual key contents
  // const privateKey = fs.readFileSync(privateKeyPath, "utf-8");
  // const publicKey = fs.readFileSync(publicKeyPath, "utf-8");
  const privateKey = process.env.PRIVATE_KEY!.replace(/\\n/g, "\n");
  const publicKey = process.env.PUBLIC_KEY!.replace(/\\n/g, "\n");
  if (!privateKey || !publicKey) {
    throw new Error("RSA keys not found in environment");
  }

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
