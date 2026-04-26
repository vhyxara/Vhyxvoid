// src/modules/billing/presentation/routes/billingRoutes.ts
// Billing REST routes. Same pattern as accountRoutes.ts.
// All account-scoped routes require OWNER role (billing affects entire account).

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { FastifyInstance } from "fastify";
import z from "zod";

const accountParamSchema = z.object({
  accountId: z.string().uuid(),
});

const checkoutBodySchema = z.object({
  priceId: z.string().min(1, "priceId is required"),
  successUrl: z.string().url("successUrl must be a valid URL"),
  cancelUrl: z.string().url("cancelUrl must be a valid URL"),
  trialDays: z.number().int().min(0).max(90).optional(),
});

const portalBodySchema = z.object({
  returnUrl: z.string().url("returnUrl must be a valid URL"),
});

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
        priceId: body.priceId,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
        trialDays: body.trialDays,
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
