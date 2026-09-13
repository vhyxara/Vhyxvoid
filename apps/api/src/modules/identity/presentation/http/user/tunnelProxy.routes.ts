// import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { FastifyInstance } from "fastify";
import { z } from "zod";

const proxyRequestSchema = z.object({
  label: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]),
  path: z.string().min(1).default("/"),
  headers: z.record(z.string(), z.string()).optional().default({}),
  body: z.any().optional().default(null),
  timeoutMs: z.number().min(1000).max(30000).default(10000),
});

export async function tunnelProxyRoutes(fastify: FastifyInstance) {
  /**
   * POST /tunnel/request
   * Routes an HTTP request through the hub to a connected agent.
   *
   * Auth: API Key (X-API-Key header) + API Secret (X-API-Secret header)
   * The key identifies the account and agent label to route to.
   *
   * Flow:
   *   1. Validate API key + secret
   *   2. Find connected agent session by accountId + label
   *   3. Send request to hub → hub forwards to agent → agent hits localhost
   *   4. Return response
   */
  fastify.post<{ Body: z.infer<typeof proxyRequestSchema> }>(
    "/request",
    async (request, reply) => {
      // ── 1. Extract and validate API key credentials ───────────────────────
      const keyId = request.headers["x-api-key"] as string;
      const keySecret = request.headers["x-api-secret"] as string;

      if (!keyId || !keySecret) {
        return reply.code(401).send({
          success: false,
          message: "Missing X-API-Key or X-API-Secret header",
        });
      }

      // ── 2. Validate key via existing ValidateApiKeyUseCase ────────────────
      let validatedKey: Awaited<
        ReturnType<typeof fastify.validateApiKeyUseCase.execute>
      >;
      try {
        validatedKey = await fastify.validateApiKeyUseCase.execute({
          keyId,
          signature: keySecret, // ← use keySecret as signature
          method: request.method,
          path: request.url ?? "/api/v1/tunnelproxy/request",
          body: JSON.stringify(request.body ?? ""),
          requestId: request.id,
          timestamp: Date.now(),
          requiredScope: "tunnels:write",
          ip: request.ip,
        });
      } catch (err: any) {
        return reply
          .code(401)
          .send({ success: false, message: err.message ?? "Invalid API key" });
      }

      if (!validatedKey.valid) {
        return reply.code(401).send({
          success: false,
          message: (validatedKey as any).reason ?? "Invalid API key",
        });
      }
      // ── 3. Parse and validate request body ───────────────────────────────
      const input = proxyRequestSchema.parse(request.body);
      // const uow = fastify.container.resolve(PrismaUnitOfWork)
      // ── 4. Find connected agent session for this account + label ─────────
      const session =
        await fastify.uow.tunnelSessionRepository.findConnectedByAccountAndLabel(
          validatedKey.accountId,
          input.label,
        );

      if (!session) {
        return reply.code(404).send({
          success: false,
          message: `No active tunnel found with label "${input.label}". Is the agent running?`,
        });
      }

      // ── 5. Forward request through hub to agent ───────────────────────────
      // The hub exposes an internal HTTP endpoint for proxying requests
      // This avoids needing a WebSocket connection from the API to the hub
      const hubInternalUrl =
        process.env.HUB_INTERNAL_URL ?? "http://localhost:9001";

      let hubResponse: Response;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

        hubResponse = await fetch(`${hubInternalUrl}/internal/proxy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Required by the Hub's internal/proxy auth (apps/hub's
            // HubServer.ts) — fails closed (503) without it, or 401 if it
            // doesn't match. This call never sent it until now, so this
            // route always failed downstream even with a valid API key.
            // See decision.md, 2026-09-13, "tunnelProxy route dormant-endpoint review".
            "x-hub-internal-secret": process.env.HUB_INTERNAL_SECRET ?? "",
          },
          body: JSON.stringify({
            agentId: session.agentId,
            method: input.method,
            path: input.path,
            headers: input.headers,
            body: input.body,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
      } catch (err: any) {
        if (err.name === "AbortError") {
          return reply.code(504).send({
            success: false,
            message: `Request timed out after ${input.timeoutMs}ms. The agent or local server may be slow.`,
          });
        }
        return reply.code(502).send({
          success: false,
          message: "Failed to reach the hub. Please try again.",
        });
      }

      // ── 6. Return the agent's response ────────────────────────────────────
      const responseBody = await hubResponse.json().catch(() => null);

      return reply.code(hubResponse.status).send({
        success: hubResponse.ok,
        status: hubResponse.status,
        statusText: hubResponse.statusText,
        data: responseBody,
      });
    },
  );
}
