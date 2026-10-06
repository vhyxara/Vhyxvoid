// /api/v1/inspector — the dashboard's request inspector. The hub captures
// requests (apps/hub RequestInspectorService); this reads them for members of
// the account, clears them, and asks the hub to replay one.
//
//   GET    /:accountId                       which tunnels have captures + how many are kept
//   GET    /:accountId/:label                summaries, newest first (no bodies)
//   GET    /:accountId/:label/:id            one request in full
//   POST   /:accountId/:label/:id/replay     send it through the tunnel again
//   DELETE /:accountId/:label                clear (admins and owners)
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError, NotFoundError, ServiceUnavailableError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  getEffectivePlanLimitsForAccount,
  currentPlanOverrides,
  inspectorKeys,
  INSPECT_BODY_MAX_BYTES,
  INSPECT_TTL_SECONDS,
  parseInspectedRequests,
  type InspectedRequest,
} from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import { HubClient, HubUnavailableError } from "../shared/hubClient";

const params = z.object({ accountId: z.string().uuid() });
const labelParams = params.extend({ label: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/, "Invalid tunnel label") });
const idParams = labelParams.extend({ id: z.string().regex(/^req_[a-f0-9]{32}$/, "Invalid request id") });
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

type RedisLike = {
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  del(...keys: string[]): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
};

/** What the list shows: no bodies, so the page stays small. */
function summary(e: InspectedRequest) {
  return {
    id: e.id,
    at: e.at,
    method: e.method,
    path: e.path,
    status: e.response?.status ?? null,
    durationMs: e.durationMs,
    error: e.error,
    replayOf: e.replayOf,
    inboxId: e.inboxId ?? null,
    requestSize: e.request.body.size,
    responseSize: e.response?.body.size ?? 0,
    contentType: e.request.headers["content-type"] ?? null,
  };
}

export async function inspectorRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);
  const redis = (fastify as unknown as { redis: RedisLike }).redis;

  /** Any member may look; clearing needs admin or owner. */
  async function member(request: FastifyRequest, accountId: string, minLevel = RoleLevel.MEMBER) {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m || m.roleLevel < minLevel) throw new ForbiddenError("You do not have access to this account");
  }

  async function entries(accountId: string, label: string): Promise<InspectedRequest[]> {
    return parseInspectedRequests(await redis.lrange(inspectorKeys.list(accountId, label), 0, -1));
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    await member(request, accountId);
    const [enabled, limits, labels] = await Promise.all([
      fastify.platformSettings.get("features.requestInspector"),
      getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides()),
      redis.hgetall(inspectorKeys.labels(accountId)),
    ]);
    const keep = Number.isFinite(limits.inspectorRequests) ? limits.inspectorRequests : 5_000;
    return successResponse(reply, "Success", 200, {
      enabled: Boolean(enabled) && keep > 0,
      keepPerTunnel: enabled ? keep : 0,
      bodyLimitBytes: INSPECT_BODY_MAX_BYTES,
      retentionHours: INSPECT_TTL_SECONDS / 3600,
      tunnels: Object.entries(labels ?? {})
        .map(([label, lastAt]) => ({ label, lastAt: String(lastAt) }))
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
    });
  });

  fastify.get("/:accountId/:label", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    const { limit } = listQuery.parse(request.query);
    await member(request, accountId);
    const list = await redis.lrange(inspectorKeys.list(accountId, label), 0, limit - 1);
    return successResponse(reply, "Success", 200, { label, requests: parseInspectedRequests(list).map(summary) });
  });

  fastify.get("/:accountId/:label/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label, id } = idParams.parse(request.params);
    await member(request, accountId);
    const entry = (await entries(accountId, label)).find((e) => e.id === id);
    if (!entry) throw new NotFoundError("That request is no longer in the inspector");
    return successResponse(reply, "Success", 200, entry);
  });

  fastify.post("/:accountId/:label/:id/replay", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, label, id } = idParams.parse(request.params);
    await member(request, accountId);
    try {
      const res = await opts.hub.replay(accountId, label, id);
      if (res.status === 404) throw new NotFoundError(String(res.body.error ?? "Not found"));
      if (res.status === 422 || res.status === 400) throw new ValidationError(String(res.body.error ?? "Cannot replay this request"));
      if (res.status !== 200) throw new ServiceUnavailableError(String(res.body.error ?? "Replay failed"));
      return successResponse(reply, "Replayed", 200, res.body);
    } catch (err) {
      if (err instanceof HubUnavailableError) throw new ServiceUnavailableError("Replay is not available right now");
      throw err;
    }
  });

  fastify.delete("/:accountId/:label", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    await member(request, accountId, RoleLevel.ADMIN);
    await Promise.all([redis.del(inspectorKeys.list(accountId, label)), redis.hdel(inspectorKeys.labels(accountId), label)]);
    return successResponse(reply, "Cleared", 200, { cleared: true });
  });
}
