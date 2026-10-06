// /api/v1/domains — an account's custom domains.
//
//   GET    /:accountId               domains, DNS records to create, limits
//   POST   /:accountId               { hostname, label } claim (owners/admins)
//   PATCH  /:accountId/:id           { label } move to another tunnel (owners/admins)
//   POST   /:accountId/:id/check     read DNS now (any member)
//   DELETE /:accountId/:id           remove (owners/admins)
//
// Adding needs the setting features.customDomains, a target hostname set by
// the operator (tunnels.customDomainTarget) and the plan's customDomains +
// maxCustomDomains. Domains already added keep working after a downgrade.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { RoleLevel } from "@/core/constant/account.constant";
import { ConflictError, ForbiddenError, NotFoundError, PlanLimitExceededError, ServiceUnavailableError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import { currentPlanOverrides, getEffectivePlanLimitsForAccount, newVerificationToken, validateCustomHostname } from "@vhyxvoid/shared";
import { prismaOf } from "../shared/http";
import type { HubClient } from "../shared/hubClient";
import { domainStatus, type DomainRow, type DomainService } from "./domains.service";

const params = z.object({ accountId: z.string().uuid() });
const idParams = params.extend({ id: z.string().uuid() });
const labelSchema = z.string().trim().min(1).max(63).regex(/^[A-Za-z0-9._-]+$/, "Invalid tunnel label");

export async function domainRoutes(fastify: FastifyInstance, opts: { hub: HubClient; domains: DomainService }) {
  const prisma = prismaOf(fastify);
  const platformDomain = () => (process.env.HUB_DOMAIN ?? "vhyxvoid.com").toLowerCase();

  async function role(request: FastifyRequest, accountId: string): Promise<number> {
    const user = getUserContext(request);
    const m = await prisma.accountMember.findUnique({ where: { userId_accountId: { userId: user.id, accountId } }, select: { roleLevel: true } });
    if (!m) throw new ForbiddenError("You do not have access to this account");
    return m.roleLevel;
  }
  async function requireAdmin(request: FastifyRequest, accountId: string) {
    if ((await role(request, accountId)) < RoleLevel.ADMIN) throw new ForbiddenError("Only owners and admins can manage custom domains");
  }
  function log(request: FastifyRequest, accountId: string, action: string, hostname: string, metadata: Record<string, unknown> = {}) {
    void prisma.auditLog
      .create({ data: { accountId, userId: getUserContext(request).id, action, resourceType: "custom_domain", resourceId: hostname, metadata: metadata as object, ipAddress: request.ip } })
      .catch(() => {});
  }
  const view = (d: DomainRow, target: string) => ({
    id: d.id,
    hostname: d.hostname,
    label: d.label,
    status: domainStatus(d),
    verifiedAt: d.verifiedAt,
    routingOk: d.routingOk,
    lastCheckedAt: d.lastCheckedAt,
    lastError: d.lastError,
    createdAt: d.createdAt,
    url: `https://${d.hostname}`,
    records: opts.domains.records(d, target),
  });

  async function limits(accountId: string) {
    const l = await getEffectivePlanLimitsForAccount(prisma as never, accountId, await currentPlanOverrides());
    const max = l.customDomains ? (Number.isFinite(l.maxCustomDomains) ? l.maxCustomDomains : 10_000) : 0;
    return { plan: l.plan, max };
  }

  fastify.get("/:accountId", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const level = await role(request, accountId);
    const [rows, lim, target, enabled] = await Promise.all([
      prisma.customDomain.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } }),
      limits(accountId),
      opts.domains.target(),
      fastify.platformSettings.get("features.customDomains"),
    ]);
    return successResponse(reply, "Success", 200, {
      available: Boolean(enabled) && Boolean(target),
      target,
      maxDomains: lim.max,
      canManage: level >= RoleLevel.ADMIN,
      domains: (rows as DomainRow[]).map((d) => view(d, target)),
    });
  });

  fastify.post("/:accountId", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const body = z.object({ hostname: z.string().max(300), label: labelSchema }).parse(request.body ?? {});
    await requireAdmin(request, accountId);
    const [enabled, target] = await Promise.all([fastify.platformSettings.get("features.customDomains"), opts.domains.target()]);
    if (!enabled || !target) throw new ServiceUnavailableError("Custom domains are not available right now");
    const v = validateCustomHostname(body.hostname, platformDomain(), process.env.NODE_ENV !== "production");
    if (!v.ok) throw new ValidationError(v.error);
    const lim = await limits(accountId);
    const count = await prisma.customDomain.count({ where: { accountId } });
    if (count >= lim.max) throw new PlanLimitExceededError({ limit: lim.max, current: count, limitKey: "maxCustomDomains", plan: lim.plan });
    if (await prisma.customDomain.findFirst({ where: { hostname: v.hostname, verifiedAt: { not: null }, NOT: { accountId } } })) {
      throw new ConflictError("This hostname is already used by another workspace");
    }
    let row: DomainRow;
    try {
      row = (await prisma.customDomain.create({
        data: { accountId, hostname: v.hostname, label: body.label, verificationToken: newVerificationToken(), createdById: getUserContext(request).id },
      })) as DomainRow;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError("This workspace already has that hostname");
      throw err;
    }
    log(request, accountId, "custom_domain.added", row.hostname, { label: row.label });
    // DNS may already be in place (re-adding a domain): check straight away.
    const checked = await opts.domains.check(row).catch(() => null);
    return successResponse(reply, "Domain added", 201, view(checked?.domain ?? row, target));
  });

  fastify.patch("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    const { label } = z.object({ label: labelSchema }).parse(request.body ?? {});
    await requireAdmin(request, accountId);
    const existing = await prisma.customDomain.findFirst({ where: { id, accountId } });
    if (!existing) throw new NotFoundError("Domain not found");
    const row = (await prisma.customDomain.update({ where: { id }, data: { label } })) as DomainRow;
    await opts.hub.invalidateDomain(row.hostname);
    log(request, accountId, "custom_domain.moved", row.hostname, { from: existing.label, to: label });
    return successResponse(reply, "Domain updated", 200, view(row, await opts.domains.target()));
  });

  fastify.post("/:accountId/:id/check", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await role(request, accountId);
    const existing = (await prisma.customDomain.findFirst({ where: { id, accountId } })) as DomainRow | null;
    if (!existing) throw new NotFoundError("Domain not found");
    const r = await opts.domains.check(existing);
    return successResponse(reply, "Checked", 200, { ...view(r.domain, await opts.domains.target()), found: r.found });
  });

  fastify.delete("/:accountId/:id", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, id } = idParams.parse(request.params);
    await requireAdmin(request, accountId);
    const existing = await prisma.customDomain.findFirst({ where: { id, accountId } });
    if (!existing) throw new NotFoundError("Domain not found");
    await prisma.customDomain.delete({ where: { id } });
    await opts.hub.invalidateDomain(existing.hostname);
    log(request, accountId, "custom_domain.removed", existing.hostname);
    return successResponse(reply, "Domain removed", 200, { id });
  });
}

/**
 * GET /api/v1/public/domains/allow?domain=  — the edge's on-demand TLS "ask"
 * endpoint (Caddy): 200 only for a verified domain of a usable account, so
 * certificates are never requested for hostnames nobody verified.
 */
export async function publicDomainRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);
  fastify.get("/allow", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { domain } = z.object({ domain: z.string().min(1).max(253) }).parse(request.query);
    const enabled = await fastify.platformSettings.get("features.customDomains");
    const row = enabled
      ? await prisma.customDomain.findFirst({
          where: { hostname: domain.toLowerCase().replace(/\.$/, ""), verifiedAt: { not: null }, account: { status: { notIn: ["DELETED", "SUSPENDED"] } } },
          select: { id: true },
        })
      : null;
    if (!row) return reply.code(404).send({ allowed: false });
    return reply.send({ allowed: true });
  });
}
