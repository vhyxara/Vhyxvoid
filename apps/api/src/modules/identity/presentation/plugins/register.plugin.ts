import { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyCompress from "@fastify/compress";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyCookie from "@fastify/cookie";
import { fastifyJwt } from "@fastify/jwt";
import { allowedOrigins } from "@/core/constant/hub.constant";
import { GLOBAL_RATE_LIMIT } from "@/core/constant/rateLimit.constant";
import prismaPlugin from "@/modules/identity/presentation/plugins/prisma.plugin";
import identity from "@/modules/identity/presentation/plugins/identity.plugin";
import userUseCases from "@/modules/identity/presentation/plugins/user.plugin";
import userAuthGuard from "@/modules/identity/presentation/plugins/guards/userAuthGuard";

import admin from "@/modules/identity/presentation/plugins/admin.plugin";
import containerPlugin from "@/core/container/container.plugin";
import { registerModules } from "./module.module";
import corePlugin from "@/modules/identity/presentation/plugins/infrastructure/core.plugin";
import { ApiKeyPlugins } from "@/modules/key-management/presentation/plugins/usecases/api-plugins";
import { billingPlugin } from "@/modules/billing/presentation/plugins/billing.plugin";
import { notificationPlugin } from "@/modules/notification/presentation/plugins/notification.plugin";
// import prismaPlugin from "./prisma.plugin";
// import servicesPlugin from "./services.plugin";

export const registerPlugins = async (server: FastifyInstance) => {
  // First: @fastify/rate-limit attaches to routes through an onRoute hook,
  // so any route registered before it is never limited (the api-keys routes
  // were not), and a per-route config.rateLimit is ignored.
  await server.register(fastifyRateLimit, GLOBAL_RATE_LIMIT);
  await server.register(containerPlugin);
  await server.register(prismaPlugin);
  await server.register(corePlugin);

  await server.register(userAuthGuard); // decorates fastify.userAuthGuard
  await server.register(notificationPlugin);

  await registerModules(server);
  await server.register(identity);
  await server.register(admin); // your existing plugin — adminLoginUseCase, requireAbility, etc.

  // ── 2. User-side services ──────────────────────────────────
  await server.register(userUseCases); // decorates use cases + fastify.uow + fastify.jwtService
  await server.register(ApiKeyPlugins);
  await server.register(billingPlugin);

  // ── 3. Admin-side services ─────────────────────────────────
  // await server.register(servicesPlugin);
  await server.register(fastifyHelmet);
  await server.register(fastifyCompress);
  await server.register(fastifyCookie);
  await server.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    cookie: { cookieName: "access_token", signed: false },
  });

  await server.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) cb(null, true);
      else cb(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });
};
