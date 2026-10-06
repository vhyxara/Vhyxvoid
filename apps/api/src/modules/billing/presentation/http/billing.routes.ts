// src/modules/billing/presentation/routes/billingRoutes.ts
// Billing REST routes. Same pattern as accountRoutes.ts.
// All account-scoped routes require OWNER role (billing affects entire account).

import { RoleLevel } from "@/core/constant/account.constant";
import { currentStripePrices } from "@vhyxvoid/shared";
import { ForbiddenError, NotFoundError, ValidationError } from "@/core/errors/error.format";
import { isOwnOrigin } from "@/core/constant/hub.constant";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { FastifyInstance } from "fastify";
import z from "zod";

const accountParamSchema = z.object({
  accountId: z.string().uuid(),
});

// Return URLs must be our own origins: arbitrary ones turned the Stripe page
// into an open redirect (audit M16). The trial length is decided server-side
// (settings: billing.trialDays, first subscription only); a client-sent
// trialDays is accepted for compatibility and ignored.
const ownUrl = (field: string) =>
  z.string().url(`${field} must be a valid URL`).refine(isOwnOrigin, `${field} must point at this site`);

const checkoutBodySchema = z
  .object({
    plan: z.enum(["PRO", "ENTERPRISE"]).optional(),
    priceId: z.string().min(1).optional(),
    successUrl: ownUrl("successUrl"),
    cancelUrl: ownUrl("cancelUrl"),
    trialDays: z.number().int().min(0).max(90).optional(),
  })
  .refine((b) => b.plan || b.priceId, "plan is required");

const portalBodySchema = z.object({
  returnUrl: ownUrl("returnUrl"),
});

/** Only the configured Stripe prices can be bought (audit M16). */
async function resolvePriceId(body: { plan?: "PRO" | "ENTERPRISE"; priceId?: string }): Promise<string> {
  const prices = await currentStripePrices();
  if (body.plan) {
    const id = prices[body.plan];
    if (!id) throw new ValidationError(`The ${body.plan} plan is not available`);
    return id;
  }
  if (!body.priceId || !Object.values(prices).includes(body.priceId)) throw new ValidationError("Unknown price");
  return body.priceId;
}

/** Billing mode "paid" and upgrades switched on, both from the admin panel. */
async function assertCheckoutOpen(fastify: FastifyInstance): Promise<void> {
  const [mode, enabled] = await Promise.all([
    fastify.platformSettings.get("billing.mode"),
    fastify.platformSettings.get("billing.checkoutEnabled"),
  ]);
  if (mode !== "paid") throw new ForbiddenError("Paid plans are not available yet.");
  if (!enabled) throw new ForbiddenError("Upgrades are temporarily unavailable. Please try again later.");
}

export async function billingRoutes(fastify: FastifyInstance) {
  /**
   * POST /accounts/organizations/:accountId/billing/checkout
   * Create a Stripe Checkout session URL.
   * OWNER only — billing affects the entire account.
   */
  fastify.post<{
    Params: z.infer<typeof accountParamSchema>;
    Body: z.infer<typeof checkoutBodySchema>;
  }>(
    "/organizations/:accountId/billing/checkout",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const body = checkoutBodySchema.parse(request.body);
      await assertCheckoutOpen(fastify);
      const priceId = await resolvePriceId(body);
      const user = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      // Verify OWNER membership
      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        user.id,
      );
      if (!membership || membership.roleLevel < RoleLevel.OWNER) {
        throw new ForbiddenError("Only owners can manage billing");
      }

      // Get account name for Stripe customer
      const account = await uow.accountRepository.findById(accountId);
      if (!account) throw new NotFoundError("Account not found");

      const result = await fastify.createCheckoutSessionUseCase.execute({
        accountId,
        accountName: account.name ?? user.email,
        userEmail: user.email,
        priceId,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
        trialDays: await fastify.platformSettings.get("billing.trialDays"),
      });

      return successResponse(reply, "Checkout session created", 201, result);
    },
  );

  /**
   * POST /accounts/organizations/:accountId/billing/portal
   * Create a Stripe Billing Portal session URL.
   * OWNER only — allows managing subscription, payment methods, invoices.
   */
  fastify.post<{
    Params: z.infer<typeof accountParamSchema>;
    Body: z.infer<typeof portalBodySchema>;
  }>(
    "/organizations/:accountId/billing/portal",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const body = portalBodySchema.parse(request.body);
      const user = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        user.id,
      );
      if (!membership || membership.roleLevel < RoleLevel.OWNER) {
        throw new ForbiddenError("Only owners can manage billing");
      }

      const result = await fastify.createBillingPortalSessionUseCase.execute({
        accountId,
        returnUrl: body.returnUrl,
      });
      return successResponse(
        reply,
        "Billing portal session created",
        201,
        result,
      );
      // return reply.code(201).send(result);
    },
  );

  /**
   * GET /accounts/organizations/:accountId/billing/subscription
   * Get the current subscription for an account.
   * MEMBER+ — all members can see the plan they're on.
   */
  fastify.get<{ Params: z.infer<typeof accountParamSchema> }>(
    "/organizations/:accountId/billing/subscription",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const user = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        user.id,
      );
      if (!membership) {
        // return reply.code(403).send({ error: "Not a member of this account" });
        throw new ForbiddenError("Not a member of this account");
      }

      const subscription =
        await fastify.getSubscriptionUseCase.execute(accountId);
      return successResponse(reply, "Subscription fetched successfully", 200, {
        accountId,
        subscription,
      });
    },
  );

  /**
   * GET /accounts/organizations/:accountId/billing/invoices
   * Get billing history (invoices) for an account.
   * OWNER only — financial data.
   */
  fastify.get<{ Params: z.infer<typeof accountParamSchema> }>(
    "/organizations/:accountId/billing/invoices",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const user = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        user.id,
      );
      if (!membership || membership.roleLevel < RoleLevel.OWNER) {
        // return reply.code(403).send({ error: "Only owners can view invoices" });
        throw new ForbiddenError("Only owners can view invoices");
      }

      const result = await fastify.getInvoicesUseCase.execute(accountId);
      return successResponse(reply, "Invoices fetched successfully", 200, {
        accountId,
        ...result,
      });
    },
  );
}
