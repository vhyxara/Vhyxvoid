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
import { TRUST_PROXY } from "@/core/constant/rateLimit.constant";
// import { initRedis } from '@/core/redis/RedisClient';

dotenv.config();

export const buildServer = async () => {
  // console.log("ENV DATABASE_URL:", process.env.DATABASE_URL);
  //   const server = Fastify({ logger: true });
  // Behind Cloudflare + nginx: without this, request.ip is nginx for every
  // request (one shared rate-limit bucket, meaningless audit IPs).
  const server = Fastify({ trustProxy: TRUST_PROXY });
  server.register(rawBody, {
    field: "rawBody",
    global: false, // only on routes that opt-in with config.rawBody = true
    encoding: false, // keep as Buffer
    runFirst: true, // parse before other plugins
  });

  // Attach requestId context for logging
  server.addHook("onRequest", requestIdHook);

  // Global error handler — MUST be registered before registerPlugins/
  // registerRoutes below. Fastify's encapsulation model resolves each
  // nested plugin's inherited error handler at the moment that plugin is
  // registered, not lazily per-request — registering this after those
  // `await server.register(...)` calls (as it previously was, at the end
  // of this function) meant every route declared inside a nested plugin
  // (i.e. everything registered via registerRoutes/registerPlugins —
  // effectively the entire API surface except the few raw `server.get()`
  // routes below) permanently inherited Fastify's default error handler
  // instead of this one. That silently broke two things app-wide: every
  // ZodError became an opaque 500 instead of the intended 400, and every
  // AppError (ForbiddenError, NotFoundError, etc.) lost its intended
  // {success, code, message, data, requestId} response shape. See
  // internal-tools/api/decision.md, 2026-09-12, "Bug 2 resolution:
  // setErrorHandler registered too late in the Fastify boot sequence".
  server.setErrorHandler(errorHandler);

  // Register enterprise plugins
  await registerPlugins(server);

  // Register API routes
  await registerRoutes(server);

  // Health check
  // server.get("/health", async () => ({ ok: true, ts: Date.now() }));
  server.get("/", async () => ({
    message: "Welcome to VhyxVoid api",
    ok: true,
    ts: Date.now(),
  }));

  server.get("/health", async () => {
    return { status: "ok" };
  });

  // 404 handler
  server.setNotFoundHandler(notFoundHandler);

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
