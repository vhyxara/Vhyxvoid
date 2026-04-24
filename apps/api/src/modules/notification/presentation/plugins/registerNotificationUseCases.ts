// src/modules/notifications/presentation/plugins/usecases/registerNotificationUseCases.ts

import { Container } from "@/core/container/container";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotificationService } from "@/modules/notification/application/use-cases";
import { buildEmailService } from "@/modules/notification/infrastructure/email/ResendEmailService";
import { PrismaNotificationRepository } from "@/modules/notification/infrastructure/prisma/PrismaNotificationRepository";

export function registerNotificationUseCases(container: Container) {
  container.register(
    PrismaNotificationRepository,
    (c) => new PrismaNotificationRepository(c.resolve(PrismaUnitOfWork).prisma),
  );

  container.register(
    NotificationService,
    (c) =>
      new NotificationService(
        buildEmailService(),
        c.resolve(PrismaNotificationRepository),
      ),
  );
}
