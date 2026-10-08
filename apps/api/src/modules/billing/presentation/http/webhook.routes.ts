// ─────────────────────────────────────────────────────────────────────────────
// src/modules/billing/presentation/routes/webhookRoutes.ts
// Stripe webhook endpoint — NO auth guard, but Stripe signature verification.
// MUST receive the raw body as Buffer — do NOT parse as JSON before this.
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyInstance } from "fastify";
import { ValidationError } from "@/core/errors/error.format";

export async function stripeWebhookRoutes(fastify: FastifyInstance) {
  /**
   * POST /billing/webhooks/stripe
   * Stripe webhook endpoint.
   * Stripe signature header: stripe-signature
   *
   * ⚠ This route MUST have addContentTypeParser for raw body access.
   * See billingPlugin.ts for the content type parser setup.
   */
  fastify.post(
    "/api/v1/billing/webhooks/stripe",
    {
      config: {
        rawBody: true, // tells fastify-raw-body plugin to attach raw body
      },
      // Before anything reads the body. Stripe always sends JSON; any other
      // content type made fastify's text parser and fastify-raw-body (which
      // reads the raw stream first) read it together, and raw-body threw an
      // uncaught TypeError that ended the whole process.
      onRequest: async (request, reply) => {
        const type = String(request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        if (type !== "application/json") return reply.code(415).send({ success: false, message: "Stripe webhooks are sent as application/json", code: "VALIDATION_ERROR", data: null });
        if (!request.headers["stripe-signature"]) throw new ValidationError("Missing stripe-signature header");
      },
    },
    async (request: any, reply) => {
      const signature = request.headers["stripe-signature"];

      if (!signature) {
        throw new ValidationError("Missing stripe-signature header");
      }

      // rawBody is the Buffer — never JSON.parse it before here
      const payload = request.rawBody as Buffer;

      const result = await fastify.handleStripeWebhookUseCase.execute(
        payload,
        signature,
      );

      // Always return 200 quickly — Stripe retries on non-2xx
      return reply.code(200).send(result);
    },
  );
}
