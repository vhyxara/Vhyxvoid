import {
  createApiKeyController,
  getApiKeyUsage,
} from '@/controllers/keyManagement/keyManagement.controller';
import { rotateApiKey } from '@/controllers/keyManagement/rotation.controller';

import { authenticate } from '@/middleware/auth.middleware';
import { FastifyInstance } from 'fastify';

export async function keyManagementRouter(fastify: FastifyInstance) {
  fastify.post('/keys', { preHandler: [authenticate] }, createApiKeyController);
  fastify.post('/keys/:id/rotate', { preHandler: [authenticate] }, rotateApiKey);
  fastify.get('/keys/:id/usage', { preHandler: [authenticate] }, getApiKeyUsage);
}
