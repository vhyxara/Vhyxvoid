import { Prisma, PrismaClient } from "@/generated/prisma";

export type PrismaTransactionalClient = PrismaClient | Prisma.TransactionClient;
