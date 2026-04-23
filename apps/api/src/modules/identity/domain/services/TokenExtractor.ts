// identity/infrastructure/utils/TokenExtractor.ts

import { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@/core/errors/error.format';

/**
 * Extract JWT token from request headers
 * Supports: "Authorization: Bearer <token>"
 */
export function extractToken(request: FastifyRequest): string {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    throw new UnauthorizedError('Missing authorization header');
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    throw new UnauthorizedError('Invalid authorization header format. Use: Bearer <token>');
  }

  const token = parts[1];

  if (!token || token.trim().length === 0) {
    throw new UnauthorizedError('Missing token in authorization header');
  }

  return token;
}

/**
 * Extract refresh token from request body
 */
export function extractRefreshToken(body: any): string {
  const { refreshToken } = body;

  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new UnauthorizedError('Missing or invalid refreshToken in request body');
  }

  return refreshToken;
}

/**
 * Get client IP address from request
 * Handles proxy forwarding via X-Forwarded-For
 */
export function getClientIpAddress(request: FastifyRequest): string {
  const forwardedFor = request.headers['x-forwarded-for'];

  if (forwardedFor) {
    // X-Forwarded-For can be comma-separated list, take first
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }

  return request.ip || 'unknown';
}

/**
 * Get user agent from request
 */
export function getUserAgent(request: FastifyRequest): string {
  return (request.headers['user-agent'] as string) || 'unknown';
}

/**
 * Get request metadata for audit logging
 */
export function getRequestMetadata(request: FastifyRequest, statusCode: number, reason?: string) {
  return {
    ipAddress: getClientIpAddress(request),
    userAgent: getUserAgent(request),
    statusCode,
    reason: reason || undefined,
  };
}
