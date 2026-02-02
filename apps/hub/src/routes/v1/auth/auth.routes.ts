import { authenticate, requireRole } from '../../../middleware/auth.middleware';
import { login, register, logout } from '@/controllers/auth/auth.controller';
import { FastifyInstance } from 'fastify/types/instance';

// import { Role } from 'generated/prisma/enums';

export async function authRouter(fastify: FastifyInstance) {
  fastify.post<{ Body: { email: string; username: string; password: string } }>(
    '/register',
    { preHandler: [authenticate] },
    register,
  );
  fastify.post('/login', login);
  fastify.post('/logout', logout);
  // fastify.get('/me', { preHandler: [authenticate, requireRole([Role.ADMIN])] }, getUser);
  // fastify.get(
  //   '/me',
  //   // { preHandler: [authenticate, requireRole(['admin'])] },
  //   getProfile,
  // );

  // fastify.get(
  //   '/allusers',
  //   // { preHandler: [authenticate, requireRole(['admin'])] },
  //   listUsers,
  // );
  // fastify.put(
  //   '/updateuser/:id',
  //   // { preHandler: [authenticate, requireRole(['admin'])] },
  //   updateUser,
  // );
  // fastify.delete(
  //   '/deleteuser/:id',
  //   // { preHandler: [authenticate, requireRole(['admin'])] },
  //   deleteUser,
  // );
}
