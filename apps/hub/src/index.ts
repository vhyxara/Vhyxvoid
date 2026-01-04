import Fastify, { FastifyRequest } from 'fastify';
// import { createWebSocketServer } from './core/ws';
// import { initRedis } from './core/redis';
import dotenv from 'dotenv';
// import { initKeyStoreFromEnv } from './core/store';
// import { addRoleBasedAccessControl } from './middleware/auth.middleware';
// import { proxyController } from './controllers/gateController/proxy.controller';
// import { errorHandler, notFoundHandler } from './middleware/error-handler';
// import { userRoutes } from './routes/v1/user/user/user.route';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCompress from '@fastify/compress';
import { createWebSocketServer } from './core/ws';
import { initRedis } from './core/redis';
import { initKeyStoreFromEnv } from './core/store';
import { userRouter } from './routes/v1/user/user.routes';
import { proxyController } from './controllers/gateController/proxy.controller';
// import { addRoleBasedAccessControl } from './middleware/auth.middleware';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { connectDB } from './config/db';
import { authRouter } from './routes/v1/auth/auth.routes';
import { roleRouter } from './routes/v1/role/role.routes';
import { fastifyJwt } from '@fastify/jwt';
import { keyManagementRouter } from './routes/v1/keyManagement/keyManagement.routes';
// import { authenticate } from './middleware/auth.middleware';

dotenv.config();
initKeyStoreFromEnv();

const server = Fastify({ logger: true });
const PORT = Number(process.env.PORT || 9000);

async function start() {
  // Registering plugins for security, CORS, compression, and rate limiting
  await server.register(fastifyHelmet); // Security headers
  await server.register(fastifyCors, {
    origin: true, // Allow any origin for CORS or configure it further
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await server.register(fastifyCompress); // GZIP compression
  await server.register(fastifyRateLimit, {
    max: 100, // Max requests per time window
    timeWindow: '1 minute', // Time window for the rate limiting
  });
  server.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  });
  await initRedis(process.env.REDIS_URL || 'redis://localhost:6379');

  // server.addContentTypeParser('application/json', { parseAs: 'json' }, (req, body) => {
  //   return body;
  // });
  // server.addHook('onRequest', authenticate);
  // Define routes
  server.register(authRouter, { prefix: '/api/v1/auth' });
  server.register(roleRouter, { prefix: '/api/v1/role' });
  server.register(userRouter, { prefix: '/api/v1/user' });
  server.register(keyManagementRouter, { prefix: '/api/v1/key-management' });
  server.post('/bridge', proxyController);

  // Role-based access control (applies to all routes)
  // addRoleBasedAccessControl(server, ['USER', 'ADMIN']); // Only USER and ADMIN can access the routes

  // Health check endpoint
  server.get('/health', async () => ({ ok: true, ts: Date.now() }));

  // 404 + error handling (Fastify has built-in error handling, but you can customize it)
  server.setNotFoundHandler(notFoundHandler);
  server.setErrorHandler(errorHandler);
  // Start the HTTP server
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[hub] HTTP listening on ${PORT}`);
  await connectDB();
  // Attach WebSocket server (on the same server)
  createWebSocketServer(server.server as any, { path: '/ws' });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
