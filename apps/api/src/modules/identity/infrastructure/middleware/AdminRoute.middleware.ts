// identity/infrastructure/middleware/AdminRouteDecorators.ts

import { UnauthorizedError } from "@/core/errors/error.format";
import { FastifyRequest } from "fastify";

/**
 * Helper to attach admin context to request
 */
export function getAdminContext(request: FastifyRequest) {
  if (!request.admin) {
    throw new UnauthorizedError("Not authenticated as admin");
  }

  return {
    id: request.admin.id,
    email: request.admin.email,
    isSuperAdmin: request.admin.isSuperAdmin,
  };
}

/**
 * Helper to add request metadata for audit logging
 */
export function getAuditMetadata(request: FastifyRequest, statusCode: number) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] || "unknown",
    statusCode,
  };
}
