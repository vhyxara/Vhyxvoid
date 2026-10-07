// /api/v1/platform — helpers for API-key clients (CLI, GitHub Action, VS Code).
//
//   GET /whoami         the key's workspace, scopes and the dashboard URL (any valid key)
//   GET /openapi.json   the platform API's OpenAPI 3.1 document (public), built from the routes
import type { FastifyInstance } from "fastify";

import { UnauthorizedError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { prismaOf } from "./http";
import { ANY_SCOPE } from "./apiKeyAuth";
import { buildPlatformOpenApi, type CollectedRoute } from "./platformOpenApi";

export async function platformApiRoutes(fastify: FastifyInstance, opts: { openApiRoutes?: readonly CollectedRoute[] } = {}) {
  const prisma = prismaOf(fastify);
  // The public API origin is api.<hub domain>, the same convention vhyxvoid doctor uses.
  const apiOrigin = () => `https://api.${process.env.HUB_DOMAIN ?? "vhyxvoid.com"}`;
  let cached: string | null = null;

  // Public: describes the API, holds nothing about any workspace. Built once
  // the routes are all registered, then cached.
  fastify.get("/openapi.json", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (_request, reply) => {
    cached ??= JSON.stringify(buildPlatformOpenApi(opts.openApiRoutes ?? [], { serverUrl: apiOrigin(), version: platformApiVersion() }), null, 2);
    return reply.type("application/json; charset=utf-8").header("cache-control", "public, max-age=300").send(cached);
  });

  fastify.get("/whoami", { onRequest: [fastify.userAuthGuard], config: { apiKeyScope: ANY_SCOPE, apiDoc: { summary: "The key's workspace and scopes", description: "Returns accountId, workspace name and slug, the key ID, its scopes and the dashboard URL. Use it to check a key." }, rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const key = request.apiKey;
    if (!key) throw new UnauthorizedError("Use an API key: Authorization: Bearer <keyId>.<secret>");
    const account = await prisma.account.findUnique({ where: { id: key.accountId }, select: { id: true, name: true, slug: true } });
    const appUrl = (process.env.APP_URL ?? "https://www.vhyxvoid.com").replace(/\/$/, "");
    return successResponse(reply, "Success", 200, { accountId: key.accountId, workspace: account?.name ?? null, slug: account?.slug ?? null, keyId: key.keyId, scopes: key.scopes, dashboardUrl: `${appUrl}/organizations/${key.accountId}` });
  });
}

/** The API's package version, shown as the document's version. */
function platformApiVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("../../../../package.json") as { version?: string }).version ?? "1.0.0";
  } catch {
    return "1.0.0";
  }
}
