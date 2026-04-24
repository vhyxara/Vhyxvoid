// ─────────────────────────────────────────────────────────────────────────────
// src/modules/billing/presentation/routes/webhookRoutes.ts
// Stripe webhook endpoint — NO auth guard, but Stripe signature verification.
// MUST receive the raw body as Buffer — do NOT parse as JSON before this.
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyInstance } from "fastify";

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
    },
    async (request: any, reply) => {
      const signature = request.headers["stripe-signature"];

      if (!signature) {
        return reply
          .code(400)
          .send({ error: "Missing stripe-signature header" });
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
