import {
  deleteUser,
  getProfile,
  listUsers,
  updateUser,
  deactivateUser,
} from '@/controllers/user/user.controller';
import { authenticate, requireRole } from '@/middleware/auth.middleware';
import { FastifyInstance } from 'fastify';

export async function userRouter(fastify: FastifyInstance) {
  // fastify.get('/me', { preHandler: [authenticate, requireRole([Role.ADMIN])] }, getUser);
  fastify.get('/me', { preHandler: [authenticate, requireRole(['user'])] }, getProfile);

  fastify.get(
    '/allusers',
    // { preHandler: [authenticate, requireRole(['admin'])] },
    listUsers,
  );
  fastify.put(
    '/updateuser/:id',
    // { preHandler: [authenticate, requireRole(['admin'])] },
    updateUser,
  );
  fastify.delete(
    '/deleteuser/:id',
    // { preHandler: [authenticate, requireRole(['admin'])] },
    deleteUser,
  );
  fastify.put(
    '/deactivateuser/:id',
    // { preHandler: [authenticate, requireRole(['admin'])] },
    deactivateUser,
  );
}
