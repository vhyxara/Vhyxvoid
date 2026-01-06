import {
  createApiKeyController,
  getApiKeyUsage,
} from '@/controllers/keyManagement/keyManagement.controller';
import { rotateApiKey } from '@/controllers/keyManagement/rotation.controller';

import { authenticate } from '@/middleware/auth.middleware';
import { FastifyInstance } from 'fastify';

export async function keyManagementRouter(fastify: FastifyInstance) {
  fastify.post<{
    Body: {
      name: string;
      description?: string;
      scopes: string[];
      environment: 'DEV' | 'PROD';
      rateLimit?: number;
      expiresAt?: Date | null;
    };
  }>('/keys', { preHandler: [authenticate] }, createApiKeyController);
  fastify.post<{ Params: { id: string }; Body?: { gracePeriodHours?: number } }>(
    '/keys/:id/rotate',
    { preHandler: [authenticate] },
    rotateApiKey,
  );
  fastify.get<{ Params: { id: string } }>(
    '/keys/:id/usage',
    { preHandler: [authenticate] },
    getApiKeyUsage,
  );
}
