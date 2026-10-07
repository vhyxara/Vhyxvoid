// /api/v1/platform — helpers for API-key clients (CLI, GitHub Action, VS Code).
//
//   GET /whoami   the key's workspace, scopes and the dashboard URL (any valid key)
import type { FastifyInstance } from "fastify";

import { UnauthorizedError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { prismaOf } from "./http";
import { ANY_SCOPE } from "./apiKeyAuth";

export async function platformApiRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  fastify.get("/whoami", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: ANY_SCOPE, rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const key = request.apiKey;
    if (!key) throw new UnauthorizedError("Use an API key: Authorization: Bearer <keyId>.<secret>");
    const account = await prisma.account.findUnique({ where: { id: key.accountId }, select: { id: true, name: true, slug: true } });
    const appUrl = (process.env.APP_URL ?? "https://www.vhyxvoid.com").replace(/\/$/, "");
    return successResponse(reply, "Success", 200, { accountId: key.accountId, workspace: account?.name ?? null, slug: account?.slug ?? null, keyId: key.keyId, scopes: key.scopes, dashboardUrl: `${appUrl}/organizations/${key.accountId}` });
  });
}
