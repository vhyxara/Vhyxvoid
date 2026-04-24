// src/modules/notifications/presentation/routes/notificationRoutes.ts

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";

const listQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(30),
  offset: z.coerce.number().min(0).default(0),
  unreadOnly: z.coerce.boolean().default(false),
});

const notifParamSchema = z.object({
  notificationId: z.string().uuid(),
});

export async function notificationRoutes(fastify: FastifyInstance) {
  /**
   * GET /notifications
   * Returns notifications + unreadCount for the bell badge.
   */
  fastify.get<{ Querystring: z.infer<typeof listQuerySchema> }>(
    "/notifications",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const user = getUserContext(request);
      const query = listQuerySchema.parse(request.query);
      const result = await fastify.notificationService.getNotifications.execute(
        user.id,
        query,
      );
      return reply.send(result);
    },
  );

  /**
   * PATCH /notifications/:notificationId/read
   * Mark a single notification read.
   */
  fastify.patch<{ Params: z.infer<typeof notifParamSchema> }>(
    "/notifications/:notificationId/read",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { notificationId } = notifParamSchema.parse(request.params);
      const user = getUserContext(request);
      await fastify.notificationService.markRead.execute(
        notificationId,
        user.id,
      );
      return reply.code(204).send();
    },
  );

  /**
   * PATCH /notifications/read-all
   * Mark all notifications read.
   */
  fastify.patch(
    "/notifications/read-all",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const user = getUserContext(request);
      await fastify.notificationService.markAllRead.execute(user.id);
      return reply.code(204).send();
    },
  );
}
