// src/modules/notifications/notificationPlugin.ts

import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
// import { PrismaClient } from "@/generated/prisma";
import { NotificationService } from "@/modules/notification/application/use-cases";
import { buildEmailService } from "@/modules/notification/infrastructure/email/ResendEmailService";
import { PrismaNotificationRepository } from "@/modules/notification/infrastructure/prisma/PrismaNotificationRepository";

export const notificationPlugin = fp(
  async (fastify: FastifyInstance) => {
    if (!fastify.prisma) {
      throw new Error(
        "fastify.prisma not found — ensure prismaPlugin registers before billingPlugin",
      );
    }
    // const prisma = fastify.container.resolve<PrismaClient>("PrismaClient");

    const emailService = buildEmailService();
    const notificationRepo = new PrismaNotificationRepository(fastify.prisma);
    const notificationService = new NotificationService(
      emailService,
      notificationRepo,
    );

    fastify.decorate("notificationService", notificationService);

    fastify.log.info("[notifications] plugin registered");
  },
  { name: "notification-plugin" },
);
