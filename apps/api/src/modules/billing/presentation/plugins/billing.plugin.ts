// ─────────────────────────────────────────────────────────────────────────────
// src/modules/billing/billingPlugin.ts
// Fastify plugin that wires everything together.
// Register this in your main app.ts.
// ─────────────────────────────────────────────────────────────────────────────
import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";

import { buildStripeService } from "@/modules/billing/infrastructure/stripe";
import { CreateCheckoutSessionUseCase } from "@/modules/billing/application/use-cases/billing/CreateCheckoutSession.usecase";
import { CreateBillingPortalSessionUseCase } from "@/modules/billing/application/use-cases/billing/CreateBillingPortalSession.usecase";
import { GetInvoicesUseCase } from "@/modules/billing/application/use-cases/billing/GetInvoices.usecase";
import { GetSubscriptionUseCase } from "@/modules/billing/application/use-cases/billing/GetSubscription.usecase";
import { HandleStripeWebhookUseCase } from "@/modules/billing/application/use-cases/webhook/HandleStripeWebhook.usecase";
import { CheckPlanLimitsService } from "@/modules/billing/domain/services/CheckPlanLimits.service";
import { GracePeriodWorker } from "@/modules/billing/infrastructure/workers/GracePeriod.worker";
import { PrismaSubscriptionRepository } from "@/modules/billing/domain/repositories/PrismaSubscriptionRepository";
import { PrismaInvoiceRepository } from "@/modules/billing/domain/repositories/PrismaInvoiceRepository";
import { PrismaAccountBillingRepository } from "@/modules/billing/domain/repositories/PrismaAccountBillingRepository";
import { NotificationService } from "@/modules/notification/application/use-cases";
import { AccountKeyCacheInvalidator } from "@/modules/billing/domain/services/AccountKeyCacheInvalidator.service";
import { PrismaApiKeyRepository } from "@/modules/key-management/domain/repositories/ApiKey.repositories";
import { RedisApiKeyCacheService } from "@/modules/key-management/domain/services/RedisApiKeyCache.service";

// export const billingPlugin = fp(
// //   async (fastify: FastifyInstance) => {
// //     const container = fastify.container;

// //     const prisma = fastify.container.resolve<PrismaClient>("PrismaClient");

// //     // ── Repositories ─────────────────────────────────────────────────────────
// //     const subscriptionRepo = new PrismaSubscriptionRepository(prisma);
// //     const invoiceRepo = new PrismaInvoiceRepository(prisma);
// //     const accountBillingRepo = new PrismaAccountBillingRepository(prisma);

// //     // ── Stripe service ────────────────────────────────────────────────────────
// //     const stripeService = buildStripeService();

// //     // ── Use cases ─────────────────────────────────────────────────────────────
// //     fastify.decorate(
// //       "createCheckoutSessionUseCase",
// //       new CreateCheckoutSessionUseCase(
// //         stripeService,
// //         subscriptionRepo,
// //         accountBillingRepo,
// //       ),
// //     );

// //     fastify.decorate(
// //       "createBillingPortalSessionUseCase",
// //       new CreateBillingPortalSessionUseCase(stripeService, accountBillingRepo),
// //     );

// //     fastify.decorate(
// //       "getSubscriptionUseCase",
// //       new GetSubscriptionUseCase(subscriptionRepo),
// //     );

// //     fastify.decorate("getInvoicesUseCase", new GetInvoicesUseCase(invoiceRepo));

// //     fastify.decorate(
// //       "handleStripeWebhookUseCase",
// //       new HandleStripeWebhookUseCase(
// //         stripeService,
// //         subscriptionRepo,
// //         invoiceRepo,
// //         accountBillingRepo,
// //       ),
// //     );

// //     fastify.decorate(
// //       "checkPlanLimitsService",
// //       new CheckPlanLimitsService(subscriptionRepo),
// //     );

// //     // ── Routes ────────────────────────────────────────────────────────────────
// //     fastify.register(billingRoutes, { prefix: "/accounts" });
// //     fastify.register(stripeWebhookRoutes); // no prefix — /billing/webhooks/stripe

// //     fastify.log.info("[billing] plugin registered");
// //   },
// //   { name: "billing-plugin" },
// );

// export const billingPlugin = fp(
//   async (fastify: FastifyInstance) => {
//     const container = fastify.container;

//     // expose usecases
//     fastify.decorate(
//       "createCheckoutSessionUseCase",
//       container.resolve(CreateCheckoutSessionUseCase),
//     );

//     fastify.decorate(
//       "createBillingPortalSessionUseCase",
//       container.resolve(CreateBillingPortalSessionUseCase),
//     );

//     fastify.decorate(
//       "getSubscriptionUseCase",
//       container.resolve(GetSubscriptionUseCase),
//     );

//     fastify.decorate(
//       "getInvoicesUseCase",
//       container.resolve(GetInvoicesUseCase),
//     );

//     fastify.decorate(
//       "handleStripeWebhookUseCase",
//       container.resolve(HandleStripeWebhookUseCase),
//     );

//     fastify.decorate(
//       "checkPlanLimitsService",
//       container.resolve(CheckPlanLimitsService),
//     );

//     // routes
//     fastify.register(billingRoutes, { prefix: "/accounts" });
//     fastify.register(stripeWebhookRoutes);

//     fastify.log.info("[billing] plugin registered");
//   },
//   { name: "billing-plugin" },
// );

export const billingPlugin = fp(
  async (fastify: FastifyInstance) => {
    // Guard
    if (!fastify.prisma) {
      throw new Error(
        "fastify.prisma not found — ensure prismaPlugin registers before billingPlugin",
      );
    }

    // ── Build infrastructure directly (same pattern as apiKeyPlugin) ──
    const stripeService = buildStripeService();

    const subscriptionRepo = new PrismaSubscriptionRepository(fastify.prisma);
    const invoiceRepo = new PrismaInvoiceRepository(fastify.prisma);
    const accountBillingRepo = new PrismaAccountBillingRepository(
      fastify.prisma,
    );
    const notificationService = fastify.container.resolve(NotificationService);

    // Closes context.md Known Risk #57's E6 cache-staleness gap: constructed
    // directly here rather than via the DI container, matching this
    // plugin's own established "build infrastructure directly" convention.
    const accountKeyCacheInvalidator = new AccountKeyCacheInvalidator(
      new PrismaApiKeyRepository(fastify.prisma),
      new RedisApiKeyCacheService(fastify.redis),
    );

    // ── Wire use cases ─────────────────────────────────────────
    fastify.decorate(
      "createCheckoutSessionUseCase",
      new CreateCheckoutSessionUseCase(
        stripeService,
        subscriptionRepo,
        accountBillingRepo,
      ),
    );

    fastify.decorate(
      "createBillingPortalSessionUseCase",
      new CreateBillingPortalSessionUseCase(stripeService, accountBillingRepo),
    );

    fastify.decorate(
      "getSubscriptionUseCase",
      new GetSubscriptionUseCase(subscriptionRepo),
    );

    fastify.decorate("getInvoicesUseCase", new GetInvoicesUseCase(invoiceRepo));

    fastify.decorate(
      "handleStripeWebhookUseCase",
      new HandleStripeWebhookUseCase(
        stripeService,
        subscriptionRepo,
        invoiceRepo,
        accountBillingRepo,
        notificationService,
        accountKeyCacheInvalidator,
      ),
    );

    fastify.decorate(
      "checkPlanLimitsService",
      new CheckPlanLimitsService(fastify.prisma),
    );

    // ── Background workers ───────────────────────────────────────
    // context.md risk #41: this class existed fully written but was never
    // instantiated/scheduled anywhere. start() runs an immediate sweep
    // before its hourly interval, so a restart after any downtime (first
    // deploy of this fix included) catches already-stale PAST_DUE
    // accounts the same way any other restart would — no separate
    // backfill/migration step needed. See decision.md, 2026-09-14,
    // "Schedule GracePeriodWorker".
    const gracePeriodWorker = new GracePeriodWorker(
      fastify.prisma,
      accountKeyCacheInvalidator,
    );
    gracePeriodWorker.start();
    fastify.addHook("onClose", async () => {
      gracePeriodWorker.stop();
    });

    // ── Routes ─────────────────────────────────────────────────
    // fastify.register(billingRoutes, { prefix: "/accounts" });
    fastify.log.info("[billing] plugin registered");
  },
  { name: "billing-plugin" },
);
// export const billingPlugin = fp(
//   async (fastify: FastifyInstance) => {
//     const container = fastify.container;
//     if (!fastify.prisma) {
//       throw new Error(
//         "fastify.prisma not found — ensure prismaPlugin registers before billingPlugin",
//       );
//     }

//     // expose usecases
//     fastify.decorate(
//       "createCheckoutSessionUseCase",
//       container.resolve(CreateCheckoutSessionUseCase),
//     );

//     fastify.decorate(
//       "createBillingPortalSessionUseCase",
//       container.resolve(CreateBillingPortalSessionUseCase),
//     );

//     fastify.decorate(
//       "getSubscriptionUseCase",
//       container.resolve(GetSubscriptionUseCase),
//     );

//     fastify.decorate(
//       "getInvoicesUseCase",
//       container.resolve(GetInvoicesUseCase),
//     );

//     fastify.decorate(
//       "handleStripeWebhookUseCase",
//       container.resolve(HandleStripeWebhookUseCase),
//     );

//     fastify.decorate(
//       "checkPlanLimitsService",
//       container.resolve(CheckPlanLimitsService),
//     );

//     // routes
//     fastify.register(billingRoutes, { prefix: "/accounts" });
//     fastify.register(stripeWebhookRoutes);

//     fastify.log.info("[billing] plugin registered");
//   },
//   { name: "billing-plugin" },
// );
