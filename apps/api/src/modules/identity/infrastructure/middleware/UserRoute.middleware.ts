// identity/presentation/infrastructure/middleware/UserRouteDecorators.ts

import { UnauthorizedError } from '@/core/errors/error.format';
import { FastifyRequest } from 'fastify';

/**
 * Extract authenticated user context from request.
 * Call this inside any route protected by userAuthGuard.
 * Mirrors getAdminContext() from AdminRouteDecorators.ts exactly.
 */
export function getUserContext(request: FastifyRequest) {
  if (!request.user) {
    throw new UnauthorizedError('Not authenticated');
  }

  return {
    id: request.user.userId,
    email: request.user.email,
  };
}

/**
 * Extract request metadata for audit logging.
 * Mirrors getAuditMetadata() from AdminRouteDecorators.ts.
 */
export function getAuditMetadata(request: FastifyRequest, statusCode: number, reason?: string) {
  return {
    ipAddress: getClientIp(request),
    userAgent: request.headers['user-agent'] ?? 'unknown',
    statusCode,
    reason,
  };
}

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }
  return request.ip ?? 'unknown';
}
