// // plugins/prisma.plugin.ts
// import { PrismaClient } from '@/generated/prisma/client';
// import fp from 'fastify-plugin';
// import { PrismaPg } from '@prisma/adapter-pg';

// export default fp(async function (fastify) {
//   const adapter = new PrismaPg({
//     connectionString: process.env.DATABASE_URL!,
//   });

//   const prisma = new PrismaClient({ adapter });
//   await prisma.$connect();

//   fastify.decorate('prisma', prisma);

//   fastify.addHook('onClose', async () => {
//     await prisma.$disconnect();
//   });
// });
