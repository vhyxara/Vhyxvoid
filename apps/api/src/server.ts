import Fastify from "fastify";
import {
  requestIdHook,
  errorHandler,
  notFoundHandler,
} from "@/core/middleware/error-handler.middleware";
import dotenv from "dotenv";
import { registerPlugins } from "@/modules/identity/presentation/plugins/register.plugin";
import registerRoutes from "@/modules/identity/presentation/http/index";
import rawBody from "fastify-raw-body";
// import { initRedis } from '@/core/redis/RedisClient';
// import { gatewayRoutes } from './modules/key-management/presentation/http/gatewayRoutes';

dotenv.config();

export const buildServer = async () => {
  // console.log("ENV DATABASE_URL:", process.env.DATABASE_URL);
  //   const server = Fastify({ logger: true });
  const server = Fastify();
  server.register(rawBody, {
    field: "rawBody",
    global: false, // only on routes that opt-in with config.rawBody = true
    encoding: false, // keep as Buffer
    runFirst: true, // parse before other plugins
  });

  // Attach requestId context for logging
  server.addHook("onRequest", requestIdHook);

  // Register enterprise plugins
  await registerPlugins(server);

  // Register API routes
  await registerRoutes(server);

  // Gateway validation route (internal — restrict to internal network):
  // server.register(gatewayRoutes, { prefix: '/gateway/v1' });

  // Health check
  server.get("/health", async () => ({ ok: true, ts: Date.now() }));
  server.get("/", async () => ({
    message: "Welcome to VhyxVoid api",
    ok: true,
    ts: Date.now(),
  }));

  // 404 handler
  server.setNotFoundHandler(notFoundHandler);

  // Global error handler
  server.setErrorHandler(errorHandler);

  return server;
};

export const startServer = async () => {
  const PORT = Number(process.env.PORT || 9000);

  const server = await buildServer();

  // await connectDB();
  // await initRedis();

  await server.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`[hub] HTTP listening on ${PORT}`);

  // createWebSocketServer(server.server as any, { path: "/ws" });
};

// process.on('SIGINT', async () => {
//   await prisma.$disconnect();
//   logger.info('SIGINT received. Shutting down...');
//   process.exit(0);
// });

startServer().catch((e) => {
  console.error(e);
  process.exit(1);
});
