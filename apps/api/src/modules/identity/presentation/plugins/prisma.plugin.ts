// plugins/prisma.plugin.ts
import { PrismaClient } from "@/generated/prisma";
import fp from "fastify-plugin";
// import { PrismaPg } from "@prisma/adapter-pg";

// export default fp(async function (fastify) {
//   const adapter = new PrismaPg({
//     connectionString: process.env.DATABASE_URL!,
//   });

//   const prisma = new PrismaClient({ adapter });
//   await prisma.$connect();

//   fastify.decorate("prisma", prisma);

//   fastify.addHook("onClose", async () => {
//     await prisma.$disconnect();
//   });
// });

// apps/api/src/core/config/prisma.plugin.ts
// import fp from 'fastify-plugin';
// import { PrismaClient } from '@vhyxvoid/shared/generated/prisma/client';

export default fp(async function (fastify) {
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  await prisma.$connect();
  fastify.decorate("prisma", prisma);

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});

// pnpm --filter api remove @prisma/adapter-pg
