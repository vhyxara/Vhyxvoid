// /api/v1/admin/api-keys and /api/v1/admin/tunnels
import { agentVersionStatus } from "@vhyxvoid/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { audit, orderBy, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";
import { HubUnavailableError, type HubClient } from "../shared/hubClient";
import { invalidateKeyCache } from "../shared/keyCache";

export async function adminApiKeyRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  const listQuery = pageQuerySchema.extend({
    status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]).optional(),
    environment: z.enum(["DEV", "PROD"]).optional(),
    accountId: z.string().uuid().optional(),
  });

  fastify.get("/", { onRequest: [fastify.requireAbility("apikey.read")] }, async (request) => {
    const q = listQuery.parse(request.query);
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.environment ? { environment: q.environment } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.search ? { OR: [{ keyId: { contains: q.search } }, { name: { contains: q.search, mode: "insensitive" as const } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.apiKey.findMany({
        where,
        orderBy: orderBy(q, ["createdAt", "lastUsedAt", "name"] as const, "createdAt"),
        ...skipTake(q),
        select: {
          id: true, keyId: true, name: true, environment: true, status: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true,
          account: { select: { id: true, name: true, slug: true } },
          createdBy: { select: { id: true, email: true } },
          scopes: { select: { scope: true } },
        },
      }),
      prisma.apiKey.count({ where }),
    ]);
    return page(rows.map((k) => ({ ...k, scopes: k.scopes.map((s) => s.scope) })), total, q);
  });

  /** Revoke a key for any account. Connected agents using it are evicted by the hub within ~60 s. */
  fastify.post<{ Params: { id: string } }>("/:id/revoke", { onRequest: [fastify.requireAbility("apikey.revoke")] }, async (request, reply) => {
    const { id } = request.params;
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body ?? {});
    const key = await prisma.apiKey.findUnique({ where: { id }, select: { id: true, keyId: true, status: true, accountId: true, name: true } });
    if (!key) throw new NotFoundError("API key not found");
    if (key.status !== "ACTIVE") throw new ValidationError(`Key is already ${key.status.toLowerCase()}`);
    await prisma.apiKey.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } });
    await invalidateKeyCache(fastify, [key]);
    await audit(fastify, request, { action: "apikey.revoked", targetType: "ApiKey", targetId: id, before: { status: key.status }, after: { status: "REVOKED" }, reason });
    return successResponse(reply, "API key revoked", 200, { id, keyId: key.keyId });
  });
}

export async function adminTunnelRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);

  /** Agents connected right now (from the hub's memory), with account names. */
  fastify.get("/live", { onRequest: [fastify.requireAbility("tunnel.read")] }, async (request, reply) => {
    const { accountId } = z.object({ accountId: z.string().uuid().optional() }).parse(request.query);
    if (!opts.hub.configured) {
      return successResponse(reply, "Hub not configured", 200, { available: false, agents: [], message: "Set HUB_INTERNAL_URL and HUB_INTERNAL_SECRET on the api." });
    }
    try {
      const agents = await opts.hub.agents(accountId);
      const accounts = await prisma.account.findMany({ where: { id: { in: [...new Set(agents.map((a) => a.accountId))] } }, select: { id: true, name: true, slug: true } });
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const domain = process.env.HUB_DOMAIN ?? "vhyxvoid.com";
      const [recommended, minimum] = await Promise.all([
        fastify.platformSettings.get("tunnels.recommendedAgentVersion"),
        fastify.platformSettings.get("tunnels.minimumAgentVersion"),
      ]);
      const rows = agents.map((a) => {
        const account = byId.get(a.accountId) ?? null;
        return {
          ...a,
          account,
          url: account?.slug ? `https://${account.slug}--${a.label}.${domain}` : null,
          versionStatus: agentVersionStatus(a.agentVersion, String(recommended ?? ""), String(minimum ?? "")),
        };
      });
      // Which versions are out there: before raising the minimum, see who it would lock out.
      const versions: Record<string, number> = {};
      for (const a of rows) versions[a.agentVersion ?? "unknown"] = (versions[a.agentVersion ?? "unknown"] ?? 0) + 1;
      return successResponse(reply, "Success", 200, {
        available: true,
        recommendedVersion: recommended || null,
        minimumVersion: minimum || null,
        versions,
        outdated: rows.filter((a) => a.versionStatus === "outdated" || a.versionStatus === "unsupported").length,
        agents: rows,
      });
    } catch (err) {
      if (err instanceof HubUnavailableError) return successResponse(reply, "Hub unreachable", 200, { available: false, agents: [], message: err.message });
      throw err;
    }
  });

  fastify.post<{ Params: { agentId: string } }>("/live/:agentId/disconnect", { onRequest: [fastify.requireAbility("tunnel.disconnect")] }, async (request, reply) => {
    const { agentId } = request.params;
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body ?? {});
    const ok = await opts.hub.disconnect(agentId);
    if (!ok) throw new NotFoundError("That agent is not connected");
    await audit(fastify, request, { action: "tunnel.disconnected", targetType: "TunnelSession", targetId: agentId, reason });
    return successResponse(reply, "Agent disconnected", 200, { agentId });
  });

  /** Connection history (TunnelSession rows). */
  fastify.get("/sessions", { onRequest: [fastify.requireAbility("tunnel.read")] }, async (request) => {
    const q = pageQuerySchema.extend({ status: z.enum(["CONNECTED", "DISCONNECTED", "EVICTED"]).optional(), accountId: z.string().uuid().optional() }).parse(request.query);
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.search ? { OR: [{ label: { contains: q.search, mode: "insensitive" as const } }, { agentId: q.search }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.tunnelSession.findMany({
        where,
        orderBy: orderBy(q, ["connectedAt", "disconnectedAt"] as const, "connectedAt"),
        ...skipTake(q),
        select: { id: true, agentId: true, label: true, status: true, connectedAt: true, disconnectedAt: true, hubInstanceId: true, metadata: true, account: { select: { id: true, name: true, slug: true } }, apiKey: { select: { keyId: true, name: true } } },
      }),
      prisma.tunnelSession.count({ where }),
    ]);
    return page(rows, total, q);
  });
}
