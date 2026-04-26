import { Container } from "@/core/container/container";
import { PrismaClient } from "@/generated/prisma";
import { CreateBillingPortalSessionUseCase } from "@/modules/billing/application/use-cases/billing/CreateBillingPortalSession.usecase";
import { CreateCheckoutSessionUseCase } from "@/modules/billing/application/use-cases/billing/CreateCheckoutSession.usecase";
import { GetInvoicesUseCase } from "@/modules/billing/application/use-cases/billing/GetInvoices.usecase";
import { GetSubscriptionUseCase } from "@/modules/billing/application/use-cases/billing/GetSubscription.usecase";
import { HandleStripeWebhookUseCase } from "@/modules/billing/application/use-cases/webhook/HandleStripeWebhook.usecase";
import { PrismaAccountBillingRepository } from "@/modules/billing/domain/repositories/PrismaAccountBillingRepository";
import { PrismaInvoiceRepository } from "@/modules/billing/domain/repositories/PrismaInvoiceRepository";
import { PrismaSubscriptionRepository } from "@/modules/billing/domain/repositories/PrismaSubscriptionRepository";
import { CheckPlanLimitsService } from "@/modules/billing/domain/services/CheckPlanLimits.service";
import { buildStripeService } from "@/modules/billing/infrastructure/stripe";
import { StripeService } from "@/modules/billing/infrastructure/stripe/StripeService";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

export function registerBillingUseCases(container: Container) {
  // ── Stripe service ────────────────────────────────────────────────────────

  // shared deps
  //   container.register(PrismaUnitOfWork, (c) => c.resolve(PrismaUnitOfWork)); // if not already registered

  container.register(StripeService, () => buildStripeService());

  container.register(
    PrismaSubscriptionRepository,
    (c) => new PrismaSubscriptionRepository(c.resolve(PrismaClient)),
  );

  container.register(
    PrismaInvoiceRepository,
    (c) => new PrismaInvoiceRepository(c.resolve(PrismaClient)),
  );

  container.register(
    PrismaAccountBillingRepository,
    (c) => new PrismaAccountBillingRepository(c.resolve(PrismaClient)),
  );

  // use cases
  container.register(
    CreateCheckoutSessionUseCase,
    (c) =>
      new CreateCheckoutSessionUseCase(
        c.resolve(StripeService),
        c.resolve(PrismaSubscriptionRepository),
        c.resolve(PrismaAccountBillingRepository),
      ),
  );

  container.register(
    CreateBillingPortalSessionUseCase,
    (c) =>
      new CreateBillingPortalSessionUseCase(
        c.resolve(StripeService),
        c.resolve(PrismaAccountBillingRepository),
      ),
  );

  container.register(
    GetSubscriptionUseCase,
    (c) => new GetSubscriptionUseCase(c.resolve(PrismaSubscriptionRepository)),
  );

  container.register(
    GetInvoicesUseCase,
    (c) => new GetInvoicesUseCase(c.resolve(PrismaInvoiceRepository)),
  );

  container.register(
    HandleStripeWebhookUseCase,
    (c) =>
      new HandleStripeWebhookUseCase(
        c.resolve(StripeService),
        c.resolve(PrismaSubscriptionRepository),
        c.resolve(PrismaInvoiceRepository),
        c.resolve(PrismaAccountBillingRepository),
      ),
  );

  container.register(
    CheckPlanLimitsService,
    (c) => new CheckPlanLimitsService(c.resolve(PrismaSubscriptionRepository)),
  );
}
