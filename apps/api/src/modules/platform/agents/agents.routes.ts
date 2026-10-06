// /api/v1/agents — a workspace's agent fleet.
//
//   GET  /:accountId                     connected agents (hub, live) + recent disconnects (24 h)
//   POST /:accountId/:agentId/disconnect stop one agent (owners/admins); it exits and does not reconnect
//
// Version status comes from the console settings tunnels.recommendedAgentVersion
// and tunnels.minimumAgentVersion; health from the hub's ping bookkeeping.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError, NotFoundError, ServiceUnavailableError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { agentHealth, agentVersionStatus } from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import { HubUnavailableError, type HubAgent, type HubClient } from "../shared/hubClient";
import { tunnelUrl } from "../tunnel-access/tunnelAccess.routes";

const params = z.object({ accountId: z.string().uuid() });
const agentParams = params.extend({ agentId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid agent id") });

const RECENT_HOURS = 24;

export async function agentRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);

  async function member(request: FastifyRequest, accountId: string) {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({
      where: { userId_accountId: { userId: user.id, accountId } },
      select: { roleLevel: true, user: { select: { firstName: true, lastName: true, email: true } } },
    });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return { level: m.roleLevel, name: `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email, userId: user.id };
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const me = await member(request, accountId);
    const isAdmin = me.level >= RoleLevel.ADMIN;
    const now = Date.now();

    let live: HubAgent[] = [];
    let hubReachable = opts.hub.configured;
    if (opts.hub.configured) {
      try {
        live = await opts.hub.agents(accountId);
      } catch (err) {
        if (!(err instanceof HubUnavailableError)) throw err;
        hubReachable = false;
      }
    }

    const [recommended, minimum, account, recent] = await Promise.all([
      fastify.platformSettings.get("tunnels.recommendedAgentVersion"),
      fastify.platformSettings.get("tunnels.minimumAgentVersion"),
      prisma.account.findUnique({ where: { id: accountId }, select: { slug: true } }),
      prisma.tunnelSession.findMany({
        where: { accountId, status: { not: "CONNECTED" }, disconnectedAt: { gte: new Date(now - RECENT_HOURS * 3_600_000) } },
        orderBy: { disconnectedAt: "desc" },
        take: 20,
        select: { agentId: true, label: true, status: true, connectedAt: true, disconnectedAt: true, metadata: true, apiKey: { select: { name: true, keyId: true } } },
      }),
    ]);
    const keys = live.length
      ? await prisma.apiKey.findMany({
          // The hub's keyId is the key's row id (ApiKey.id), not the public vhyxvoid_… id.
          where: { accountId, id: { in: [...new Set(live.map((a) => a.keyId).filter((k): k is string => !!k))] } },
          select: { id: true, keyId: true, name: true, environment: true, expiresAt: true, status: true },
        })
      : [];
    const keyBy = new Map(keys.map((k) => [k.id, k]));
    const slug = account?.slug ?? "";
    const rec = String(recommended ?? "");
    const min = String(minimum ?? "");

    const agents = live
      .map((a) => {
        const key = a.keyId ? keyBy.get(a.keyId) : undefined;
        return {
          agentId: a.agentId,
          label: a.label,
          url: tunnelUrl(slug, a.label),
          version: a.agentVersion ?? null,
          versionStatus: agentVersionStatus(a.agentVersion, rec, min),
          health: agentHealth(a.lastSeenAt, a.missedPings, now),
          connectedAt: a.connectedAt,
          uptimeSeconds: Math.max(0, Math.round((now - new Date(a.connectedAt).getTime()) / 1000)),
          lastSeenAt: a.lastSeenAt,
          missedPings: a.missedPings,
          inFlight: a.inFlight ?? 0,
          capabilities: a.capabilities ?? [],
          // Where an agent runs is for owners and admins.
          ip: isAdmin ? (a.ip ?? null) : null,
          key: key
            ? {
                id: key.id,
                keyId: key.keyId,
                name: key.name,
                environment: key.environment,
                expiresAt: key.expiresAt,
                expiresSoon: !!key.expiresAt && key.expiresAt.getTime() - now < 7 * 86_400_000,
              }
            : null,
        };
      })
      .sort((x, y) => x.label.localeCompare(y.label));

    return successResponse(reply, "Success", 200, {
      hubReachable,
      canManage: isAdmin,
      recommendedVersion: rec || null,
      minimumVersion: min || null,
      summary: {
        connected: agents.length,
        outdated: agents.filter((a) => a.versionStatus === "outdated" || a.versionStatus === "unsupported").length,
        unhealthy: agents.filter((a) => a.health !== "healthy").length,
        busy: agents.reduce((n, a) => n + a.inFlight, 0),
      },
      agents,
      recent: recent.map((s) => ({
        agentId: s.agentId,
        label: s.label,
        status: s.status,
        connectedAt: s.connectedAt,
        disconnectedAt: s.disconnectedAt,
        durationSeconds: s.disconnectedAt ? Math.round((s.disconnectedAt.getTime() - s.connectedAt.getTime()) / 1000) : null,
        version: ((s.metadata as { agentVersion?: string } | null)?.agentVersion as string | undefined) ?? null,
        key: s.apiKey ? { name: s.apiKey.name, keyId: s.apiKey.keyId } : null,
      })),
    });
  });

  fastify.post("/:accountId/:agentId/disconnect", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, agentId } = agentParams.parse(request.params);
    const me = await member(request, accountId);
    if (me.level < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can stop agents");
    if (!opts.hub.configured) throw new ServiceUnavailableError("Agents cannot be stopped from here right now");
    let agent: HubAgent | undefined;
    try {
      // Only this workspace's agents: the hub list is filtered by account.
      agent = (await opts.hub.agents(accountId)).find((a) => a.agentId === agentId);
      if (!agent) throw new NotFoundError("That agent is no longer connected");
      await opts.hub.disconnect(agentId, `Stopped from the dashboard by ${me.name}`);
    } catch (err) {
      if (err instanceof HubUnavailableError) throw new ServiceUnavailableError("The hub could not be reached; try again");
      throw err;
    }
    await prisma.auditLog
      .create({
        data: {
          accountId,
          userId: me.userId,
          action: "AGENT_STOPPED",
          resourceType: "Tunnel",
          resourceId: agent.label,
          metadata: { label: agent.label, agentId, version: agent.agentVersion ?? null },
          ipAddress: request.ip,
          userAgent: String(request.headers["user-agent"] ?? "").slice(0, 300) || null,
        },
      })
      .catch((err) => console.error("[activity] AGENT_STOPPED not recorded", (err as Error).message));
    return successResponse(reply, "Agent stopped", 200, { agentId, label: agent.label });
  });
}
