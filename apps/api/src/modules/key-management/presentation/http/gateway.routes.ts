// ─────────────────────────────────────────────────────────────────────────────
// GATEWAY VALIDATION ROUTE
// Prefix: /gateway/v1
//
// This is the data plane entry point. Called by your tunnel infrastructure
// before forwarding any request. NOT called directly by end users.
//
// Auth: X-API-Key + X-Signature headers (NOT Bearer JWT)
// ─────────────────────────────────────────────────────────────────────────────

import { successResponse } from "@/core/utils/response.util";
import { FastifyInstance } from "fastify";
import z from "zod";

const gatewayValidateSchema = z.object({
  keyId: z.string().min(1),
  signature: z
    .string()
    .length(64, "HMAC-SHA256 hex signature must be 64 chars"),
  method: z.string().min(1),
  path: z.string().min(1),
  body: z.string().default(""),
  requestId: z.string().uuid("requestId must be a UUID"),
  timestamp: z.number().int().positive(),
  requiredScope: z.string().min(1),
});

export async function gatewayRoutes(fastify: FastifyInstance) {
  /**
   * Validate API Key (Gateway data plane)
   * POST /gateway/v1/validate
   *
   * Called by tunnel infrastructure before proxying any connection.
   * Never called by end users. Should be network-restricted to internal traffic only.
   *
   * Returns 200 with context on success.
   * Returns 401 with SecurityEventType code on failure.
   *
   * Target latency: < 5ms on cache hit, < 10ms on cache miss.
   */
  fastify.post<{ Body: z.infer<typeof gatewayValidateSchema> }>(
    "/validate",
    async (request, reply) => {
      const input = gatewayValidateSchema.parse(request.body);

      const result = await fastify.validateApiKeyUseCase.execute({
        keyId: input.keyId,
        signature: input.signature,
        method: input.method,
        path: input.path,
        body: input.body,
        requestId: input.requestId,
        timestamp: input.timestamp,
        requiredScope: input.requiredScope,
        ip: request.ip,
      });

      if (!result.valid) {
        return reply.code(401).send({
          valid: false,
          code: result.code,
          reason: result.reason,
        });
      }

      return reply.code(200).send({
        valid: true,
        apiKeyId: result.apiKeyId,
        accountId: result.accountId,
        scopes: result.scopes,
      });
    },
  );
}
