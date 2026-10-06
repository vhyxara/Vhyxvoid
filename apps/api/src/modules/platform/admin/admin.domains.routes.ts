// /api/v1/admin/domains — every custom domain on the platform, for operators
// (abuse, support). Removing one stops routing at once.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { audit, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";
import type { HubClient } from "../shared/hubClient";
import { domainStatus } from "../domains/domains.service";

export async function adminDomainRoutes(fastify: FastifyInstance, opts: { hub: HubClient }) {
  const prisma = prismaOf(fastify);

  fastify.get("/", { onRequest: [fastify.requireAbility("tunnel.read")] }, async (request, reply) => {
    const q = pageQuerySchema.extend({ status: z.enum(["verified", "pending"]).optional() }).parse(request.query);
    const where = {
      ...(q.search ? { hostname: { contains: q.search.toLowerCase() } } : {}),
      ...(q.status === "verified" ? { verifiedAt: { not: null } } : q.status === "pending" ? { verifiedAt: null } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.customDomain.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(q), include: { account: { select: { id: true, name: true, slug: true } } } }),
      prisma.customDomain.count({ where }),
    ]);
    return page(rows.map(({ verificationToken: _t, ...d }) => ({ ...d, status: domainStatus(d) })), total, q);
  });

  fastify.delete<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("tunnel.disconnect")] }, async (request, reply) => {
    const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    if (!body.reason || body.reason.length < 3) throw new ValidationError("A reason is required");
    const reason = body.reason;
    const d = await prisma.customDomain.findUnique({ where: { id: request.params.id } });
    if (!d) throw new NotFoundError("Domain not found");
    await prisma.customDomain.delete({ where: { id: d.id } });
    await opts.hub.invalidateDomain(d.hostname);
    await audit(fastify, request, { action: "custom_domain.remove", targetType: "custom_domain", targetId: d.id, before: { hostname: d.hostname, accountId: d.accountId, label: d.label }, reason });
    return successResponse(reply, "Domain removed", 200, { id: d.id });
  });
}
