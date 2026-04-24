// identity/presentation/routes/user/apiKeyRoutes.ts

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  ApiKeyEnvironment,
  ApiKeyStatus,
  ApiScope,
} from "@/core/types/api-key.types/apiKeys";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { buildPlanLimitGuard } from "@/modules/billing/infrastructure/middleware/planLimitGuard.middleware";
import { successResponse, tableResponse } from "@/core/utils/response.util";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/core/errors/error.format";

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────

const validScopes = Object.values(ApiScope) as [string, ...string[]];
const validEnvironments = Object.values(ApiKeyEnvironment) as [
  string,
  ...string[],
];

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  environment: z.enum(
    validEnvironments as [ApiKeyEnvironment, ...ApiKeyEnvironment[]],
  ),
  scopes: z.array(z.enum(validScopes)).min(1, "At least one scope is required"),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  scopes: z.array(z.enum(validScopes)).min(1).optional(),
});

// const listApiKeysSchema = z.object({
//   status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]).optional(),
//   environment: z.enum(validEnvironments as [string, ...string[]]).optional(),
// });

// const usageQuerySchema = z.object({
//   keyId: z.string().uuid().optional(),
//   from: z.string().datetime({ message: 'from must be ISO 8601' }),
//   to: z.string().datetime({ message: 'to must be ISO 8601' }),
// });
const listApiKeysSchema = z.object({
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]).optional(),
  environment: z.enum(validEnvironments as [string, ...string[]]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z
    .enum(["name", "createdAt", "lastUsedAt", "status", "environment"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const usageQuerySchema = z.object({
  keyId: z.string().uuid().optional(),
  from: z
    .string()
    .datetime()
    .default(() =>
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  to: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});

const revokeSchema = z.object({
  reason: z.string().max(500).optional(),
});

const keyIdParamSchema = z.object({
  keyId: z.string().uuid(),
});

const accountKeyParamSchema = z.object({
  accountId: z.string().uuid(),
  keyId: z.string().uuid(),
});

const accountParamSchema = z.object({
  accountId: z.string().uuid(),
});

const keyParamSchema = z.object({
  accountId: z.string().uuid(),
  keyId: z.string().uuid(), // internal UUID (id), not the public keyId string
});

const listApiKeysQuerySchema = z.object({
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]).optional(),
  environment: z.enum(validEnvironments as [string, ...string[]]).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// MANAGEMENT PLANE ROUTES
// Prefix: /accounts/organizations/:accountId/api-keys
// All routes require userAuthGuard.
// ─────────────────────────────────────────────────────────────────────────────

export async function apiKeyRoutes(fastify: FastifyInstance) {
  const uow = fastify.container.resolve(PrismaUnitOfWork);

  const apiKeyLimitGuard = buildPlanLimitGuard(
    "maxApiKeys",
    async (accountId) => {
      const uow = fastify.container.resolve(PrismaUnitOfWork);
      return fastify.prisma.apiKey.count({
        where: { accountId, status: "ACTIVE" },
      });
    },
  );

  /**
   * Create API Key
   * POST /accounts/organizations/:accountId/api-keys
   * Auth: ADMIN or OWNER
   *
   * Returns the public key DTO + the raw secret (shown ONCE, never stored).
   * Client must save the secret immediately — it cannot be retrieved again.
   */
  fastify.post<{
    Params: z.infer<typeof accountParamSchema>;
    Body: z.infer<typeof createApiKeySchema>;
  }>(
    "/organizations/:accountId/api-keys",
    { onRequest: [fastify.userAuthGuard, apiKeyLimitGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const input = createApiKeySchema.parse(request.body);
      const user = getUserContext(request);
      // console.log('createApiKeyUseCase:', fastify.createApiKeyUseCase);
      const result = await fastify.createApiKeyUseCase.execute({
        accountId,
        actorUserId: user.id,
        name: input.name,
        description: input.description,
        environment: input.environment as ApiKeyEnvironment,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      });

      // ⚠ SECRET IS IN THE RESPONSE — log a warning so devs know
      request.log.warn(
        { accountId, keyId: result.key.keyId },
        "API key secret returned — shown once only",
      );

      // return reply.code(201).send({
      //   key: result.key,
      //   secret: result.secret,
      //   notice: "Save this secret immediately. It will not be shown again.",
      // });
      const formattedResult = {
        key: result.key,
        secret: result.secret,
        notice: "Save this secret immediately. It will not be shown again.",
      };
      return successResponse(reply, "API key created", 201, formattedResult);
    },
  );

  /**
   * List API Keys
   * GET /accounts/organizations/:accountId/api-keys
   * Auth: MEMBER+ (MEMBERs see own keys only; ADMIN+ see all)
   */

  fastify.get<{
    Params: z.infer<typeof accountParamSchema>;
    Querystring: z.infer<typeof listApiKeysSchema>;
  }>(
    "/organizations/:accountId/api-keys",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);
      const query = listApiKeysSchema.parse(request.query);
      const user = getUserContext(request);

      const result = await fastify.listApiKeysUseCase.execute({
        accountId,
        actorUserId: user.id,
        status: query.status as ApiKeyStatus | undefined,
        environment: query.environment as ApiKeyEnvironment | undefined,
        page: query.page,
        limit: query.limit,
        search: query.search,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      });

      return tableResponse(
        reply,
        {
          items: result.items,
          page: result.page,
          limit: result.limit,
          total: result.total,
          extra: { accountId },
        },
        "API keys listed",
      );
    },
  );

  /**
   * Get API Key
   * GET /accounts/organizations/:accountId/api-keys/:keyId
   * Auth: MEMBER (own keys) or ADMIN+ (any key)
   */
  fastify.get<{ Params: z.infer<typeof accountKeyParamSchema> }>(
    "/organizations/:accountId/api-keys/:keyId",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId, keyId } = accountKeyParamSchema.parse(request.params);
      const user = getUserContext(request);

      const key = await fastify.getApiKeyUseCase.execute({
        accountId,
        actorUserId: user.id,
        keyId,
      });

      // return reply.send(key);
      return successResponse(reply, "API key retrieved", 200, key);
    },
  );

  /**
   * Update API Key
   * PATCH /accounts/organizations/:accountId/api-keys/:keyId
   * Auth: MEMBER (own keys) or ADMIN+ (any key)
   */
  fastify.patch<{
    Params: z.infer<typeof accountKeyParamSchema>;
    Body: z.infer<typeof updateApiKeySchema>;
  }>(
    "/organizations/:accountId/api-keys/:keyId",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId, keyId } = accountKeyParamSchema.parse(request.params);
      const input = updateApiKeySchema.parse(request.body);
      const user = getUserContext(request);

      if (!input.name && input.description === undefined && !input.scopes) {
        throw new ValidationError("Provide at least one field to update");
      }

      const key = await fastify.updateApiKeyUseCase.execute({
        accountId,
        actorUserId: user.id,
        keyId,
        ...input,
      });

      // return reply.send(key);
      return successResponse(reply, "API key updated", 200, key);
    },
  );

  /**
   * Revoke API Key
   * POST /accounts/organizations/:accountId/api-keys/:keyId/revoke
   * Auth: MEMBER (own keys) or ADMIN+ (any key)
   *
   * Uses POST not DELETE because revoke is a state change, not a resource deletion.
   * The key record is preserved for audit. Cache invalidated immediately.
   */
  fastify.post<{
    Params: z.infer<typeof accountKeyParamSchema>;
    Body: z.infer<typeof revokeSchema>;
  }>(
    "/organizations/:accountId/api-keys/:keyId/revoke",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId, keyId } = accountKeyParamSchema.parse(request.params);
      const input = revokeSchema.parse(request.body ?? {});
      const user = getUserContext(request);

      await fastify.revokeApiKeyUseCase.execute({
        accountId,
        actorUserId: user.id,
        keyId,
        reason: input.reason,
      });

      // return reply.code(204).send();
      return successResponse(reply, "API key revoked", 204);
    },
  );

  /**
   * Rotate API Key Secret (zero-downtime)
   * POST /accounts/organizations/:accountId/api-keys/:keyId/rotate
   * Auth: MEMBER (own keys) or ADMIN+ (any key) — Pro plan required
   *
   * Old secret remains valid for 1 hour (rotation grace window).
   * Returns the new raw secret (shown ONCE).
   */
  fastify.post<{ Params: z.infer<typeof accountKeyParamSchema> }>(
    "/organizations/:accountId/api-keys/:keyId/rotate",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId, keyId } = accountKeyParamSchema.parse(request.params);
      const user = getUserContext(request);

      const result = await fastify.rotateApiKeyUseCase.execute({
        accountId,
        actorUserId: user.id,
        keyId,
      });
      if (!result) {
        throw new NotFoundError("API key not found");
      }
      return successResponse(reply, "API key rotated", 200, {
        secret: result.secret,
        graceEndsAt: result.graceEndsAt,
        notice:
          "Save this secret immediately. The old secret remains valid until graceEndsAt.",
      });
    },
  );

  /**
   * Get Usage
   * GET /accounts/organizations/:accountId/api-keys/usage
   * Auth: MEMBER+
   *
   * ?keyId=  (optional) — filter to a specific key
   * ?from=   ISO 8601 datetime (required)
   * ?to=     ISO 8601 datetime (required)
   */
  fastify.get<{
    Params: z.infer<typeof accountParamSchema>;
    Querystring: z.infer<typeof usageQuerySchema>;
  }>(
    "/organizations/:accountId/api-keys/usage",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountParamSchema.parse(request.params);

      const query = usageQuerySchema.parse(request.query);
      const user = getUserContext(request);
      const result = await fastify.getApiKeyUsageUseCase.execute({
        accountId,
        actorUserId: user.id,
        keyId: query.keyId,
        period: {
          start: new Date(query.from),
          end: new Date(query.to),
        },
      });

      // return reply.send(result);
      return successResponse(reply, "API key usage retrieved", 200, result);
    },
  );

  /**
   * Get Security Events
   * GET /accounts/organizations/:accountId/api-keys/:keyId/security-events
   * Auth: ADMIN+
   */
  // fastify.get<{ Params: z.infer<typeof accountKeyParamSchema> }>(
  //   "/organizations/:accountId/api-keys/:keyId/security-events",
  //   { onRequest: [fastify.userAuthGuard] },
  //   async (request, reply) => {
  //     const { accountId, keyId } = accountKeyParamSchema.parse(request.params);
  //     const user = getUserContext(request);

  //     // Verify membership + ADMIN role inline (no use case needed for a read)
  //     const membership = await uow.membershipRepository.findByAccountAndUser(
  //       accountId,
  //       user.id,
  //     );
  //     if (!membership || membership.roleLevel < 70) {
  //       // return reply.code(403).send({ error: "Admin or Owner role required" });
  //       throw new ForbiddenError("Admin or Owner role required");
  //     }

  //     const key = await uow.apiKeyRepository.findById(keyId);
  //     if (!key || key.accountId !== accountId) {
  //       // return reply.code(404).send({ error: "API key not found" });
  //       throw new NotFoundError("API key not found");
  //     }

  //     const events = await uow.securityEventRepository.findByApiKey(keyId, 100);

  //     return reply.send({
  //       keyId,
  //       events: events.map((e) => ({
  //         id: e.id,
  //         type: e.type,
  //         ip: e.ip,
  //         reason: e.reason,
  //         createdAt: e.createdAt,
  //       })),
  //     });
  //   },
  // );

  /**
   * GET /organizations/:accountId/api-keys
   * List API keys for the account.
   *
   * MEMBER: sees only their own created keys.
   * ADMIN+: sees all keys in the account.
   *
   * Returns public DTOs — no secret hashes ever leave the server.
   */
  // fastify.get<{
  //   Params: z.infer<typeof accountParamSchema>;
  //   Querystring: z.infer<typeof listApiKeysQuerySchema>;
  // }>(
  //   "/organizations/:accountId/api-keys",
  //   { onRequest: [fastify.userAuthGuard] },
  //   async (request, reply) => {
  //     const { accountId } = accountParamSchema.parse(request.params);
  //     const query = listApiKeysQuerySchema.parse(request.query);
  //     const { id: userId } = getUserContext(request);

  //     const keys = await fastify.listApiKeysUseCase.execute({
  //       accountId,
  //       actorUserId: userId,
  //       status: query.status as any,
  //       environment: query.environment as any,
  //     });

  //     return reply.send({ keys });
  //   },
  // );
}
