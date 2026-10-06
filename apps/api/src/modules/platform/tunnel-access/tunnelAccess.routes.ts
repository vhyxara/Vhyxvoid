// /api/v1/tunnel-access — access rules for an account's public tunnels
// (password, IP allowlist, expiring share links). The hub enforces them
// (apps/hub TunnelPolicyCache + HttpTunnel.handler); this manages them.
//
//   GET    /:accountId                         rules + live tunnels + whether the plan allows it
//   PUT    /:accountId/:label                  set password and/or allowlist (admins, plan `accessRules`)
//   DELETE /:accountId/:label                  make the tunnel public again (admins)
//   POST   /:accountId/:label/share-links      a link that skips the password until it expires (admins)
//   POST   /:accountId/:label/revoke-links     invalidate every share link (admins)
//
// Creating or changing rules needs the plan limit `accessRules`; removing
// them never does, and rules that exist keep working after a downgrade.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  currentPlanOverrides,
  getEffectivePlanLimitsForAccount,
  hashTunnelPassword,
  MAX_SHARE_LINK_HOURS,
  SHARE_QUERY_PARAM,
  signShareToken,
  validateAllowlist,
} from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import type { HubClient } from "../shared/hubClient";

const params = z.object({ accountId: z.string().uuid() });
const labelParams = params.extend({ label: z.string().min(1).max(63).regex(/^[A-Za-z0-9._-]+$/, "Invalid tunnel label") });
const putBody = z
  .object({
    /** undefined keeps the current password, null removes it. */
    password: z.string().min(8, "Use at least 8 characters").max(128).nullable().optional(),
    ipAllowlist: z.array(z.string().trim().min(1)).max(50).optional(),
  })
  .strict();
const shareBody = z.object({ hours: z.number().int().min(1).max(MAX_SHARE_LINK_HOURS).default(24) });

function tunnelUrl(slug: string, label: string): string | null {
  const domain = process.env.HUB_DOMAIN;
  if (!domain) return null;
  const scheme = process.env.TUNNEL_URL_SCHEME ?? "https";
  return `${scheme}://${slug}--${label}.${domain}`;
}

export async function tunnelAccessRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);
  const pepper = () => {
    const p = process.env.SERVER_HMAC_PEPPER;
    if (!p) throw new Error("SERVER_HMAC_PEPPER is not set");
    return p;
  };

  async function role(request: FastifyRequest, accountId: string): Promise<number> {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return m.roleLevel;
  }

  async function requireAdmin(request: FastifyRequest, accountId: string) {
    if ((await role(request, accountId)) < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can change tunnel access");
  }

  async function planAllows(accountId: string): Promise<boolean> {
    const limits = await getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides());
    return limits.accessRules === true;
  }

  async function requirePlan(accountId: string): Promise<void> {
    const limits = await getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides());
    if (limits.accessRules !== true) throw new PlanLimitExceededError({ limit: 0, current: 0, limitKey: "accessRules", plan: limits.plan });
  }

  function log(request: FastifyRequest, accountId: string, action: string, label: string, metadata: Record<string, unknown> = {}) {
    void prisma.auditLog
      .create({
        data: {
          accountId,
          userId: getUserContext(request).id,
          action,
          resourceType: "tunnel",
          resourceId: label,
          metadata: metadata as object,
          ipAddress: request.ip,
          userAgent: String(request.headers["user-agent"] ?? "").slice(0, 300) || null,
        },
      })
      .catch(() => {});
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const level = await role(request, accountId);
    const [rows, allowed, account, live] = await Promise.all([
      prisma.tunnelPolicy.findMany({ where: { accountId }, orderBy: { label: "asc" } }),
      planAllows(accountId),
      prisma.account.findUnique({ where: { id: accountId }, select: { slug: true } }),
      opts.hub.configured ? opts.hub.agents(accountId).catch(() => []) : Promise.resolve([]),
    ]);
    const liveLabels = [...new Set(live.map((a) => a.label))].sort();
    const slug = account?.slug ?? "";
    return successResponse(reply, "Success", 200, {
      planAllows: allowed,
      canManage: level >= RoleLevel.ADMIN,
      liveLabels,
      rules: rows.map((r) => ({
        label: r.label,
        hasPassword: Boolean(r.passwordHash),
        ipAllowlist: r.ipAllowlist,
        updatedAt: r.updatedAt,
        url: tunnelUrl(slug, r.label),
      })),
    });
  });

  fastify.put("/:accountId/:label", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    const body = putBody.parse(request.body ?? {});
    await requireAdmin(request, accountId);
    await requirePlan(accountId);
    if (body.ipAllowlist) {
      const err = validateAllowlist(body.ipAllowlist);
      if (err) throw new ValidationError(err);
    }

    const existing = await prisma.tunnelPolicy.findUnique({ where: { accountId_label: { accountId, label } } });
    const passwordHash =
      body.password === undefined ? (existing?.passwordHash ?? null) : body.password === null ? null : hashTunnelPassword(pepper(), accountId, label, body.password);
    const ipAllowlist = body.ipAllowlist ?? existing?.ipAllowlist ?? [];
    const user = getUserContext(request);

    // Nothing left to enforce: the tunnel is public again.
    if (!passwordHash && ipAllowlist.length === 0) {
      if (existing) await prisma.tunnelPolicy.delete({ where: { id: existing.id } });
      await opts.hub.invalidatePolicy(accountId, label);
      log(request, accountId, "tunnel.access.removed", label);
      return successResponse(reply, "Tunnel is public", 200, { label, hasPassword: false, ipAllowlist: [] });
    }

    const saved = await prisma.tunnelPolicy.upsert({
      where: { accountId_label: { accountId, label } },
      create: { accountId, label, passwordHash, ipAllowlist, updatedById: user.id },
      // A new password also revokes the share links made for the old one.
      update: { passwordHash, ipAllowlist, updatedById: user.id, ...(body.password !== undefined ? { version: { increment: 1 } } : {}) },
    });
    await opts.hub.invalidatePolicy(accountId, label);
    log(request, accountId, "tunnel.access.updated", label, {
      password: body.password === undefined ? "unchanged" : body.password === null ? "removed" : "set",
      ipAllowlist: saved.ipAllowlist,
    });
    return successResponse(reply, "Access rules saved", 200, { label, hasPassword: Boolean(saved.passwordHash), ipAllowlist: saved.ipAllowlist });
  });

  fastify.delete("/:accountId/:label", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    await requireAdmin(request, accountId);
    await prisma.tunnelPolicy.deleteMany({ where: { accountId, label } });
    await opts.hub.invalidatePolicy(accountId, label);
    log(request, accountId, "tunnel.access.removed", label);
    return successResponse(reply, "Tunnel is public", 200, { label });
  });

  fastify.post("/:accountId/:label/share-links", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    const { hours } = shareBody.parse(request.body ?? {});
    await requireAdmin(request, accountId);
    await requirePlan(accountId);
    const policy = await prisma.tunnelPolicy.findUnique({ where: { accountId_label: { accountId, label } } });
    if (!policy?.passwordHash) throw new NotFoundError("Set a password on this tunnel first: share links let people skip it");
    const expiresAt = new Date(Date.now() + hours * 3_600_000);
    const token = signShareToken(pepper(), { accountId, label, version: policy.version, expiresAt });
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { slug: true } });
    const base = tunnelUrl(account?.slug ?? "", label);
    log(request, accountId, "tunnel.access.share_link", label, { hours });
    return successResponse(reply, "Share link created", 201, {
      label,
      expiresAt,
      token,
      query: `${SHARE_QUERY_PARAM}=${token}`,
      url: base ? `${base}/?${SHARE_QUERY_PARAM}=${token}` : null,
    });
  });

  fastify.post("/:accountId/:label/revoke-links", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, label } = labelParams.parse(request.params);
    await requireAdmin(request, accountId);
    const res = await prisma.tunnelPolicy.updateMany({ where: { accountId, label }, data: { version: { increment: 1 } } });
    if (!res.count) throw new NotFoundError("This tunnel has no access rules");
    await opts.hub.invalidatePolicy(accountId, label);
    log(request, accountId, "tunnel.access.links_revoked", label);
    return successResponse(reply, "Share links revoked", 200, { label });
  });
}
