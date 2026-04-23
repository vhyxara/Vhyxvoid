import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Middleware to automatically log admin actions
 */
export async function createAdminAuditMiddleware(adminAuditLogRepository: any) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    // Capture original send
    const originalSend = reply.send;

    reply.send = function (payload: any) {
      const duration = Date.now() - startTime;
      const statusCode = reply.statusCode;

      // Only log on success/error responses
      if (
        request.admin &&
        (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE')
      ) {
        // Could be enhanced to extract action/target info from route
        console.log({
          admin: request.admin.id,
          method: request.method,
          url: request.url,
          status: statusCode,
          duration,
        });
      }

      return originalSend.call(this, payload);
    };

    // Continue to next handler
  };
}
