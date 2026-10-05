// /api/v1/admin/users — end users (customers), not admin users.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { audit, orderBy, page, pageQuerySchema, prismaOf, skipTake } from "../shared/http";
import { invalidateKeyCache } from "../shared/keyCache";
import { RoleLevel } from "@/core/constant/account.constant";

const listQuery = pageQuerySchema.extend({
  status: z.enum(["active", "disabled", "unverified", "locked", "deleted"]).optional(),
});

const updateBody = z
  .object({
    firstName: z.string().trim().max(50).optional(),
    lastName: z.string().trim().max(50).optional(),
    status: z.boolean().optional(),
    isEmailVerified: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const userSelect = {
  id: true, email: true, firstName: true, lastName: true, status: true, isEmailVerified: true,
  failedLoginAttempts: true, lockedUntil: true, createdAt: true, updatedAt: true, deletedAt: true,
} as const;

export async function adminUserRoutes(fastify: FastifyInstance) {
  const prisma = prismaOf(fastify);

  fastify.get("/", { onRequest: [fastify.requireAbility("user.read")] }, async (request) => {
    const q = listQuery.parse(request.query);
    const now = new Date();
    const statusWhere =
      q.status === "deleted" ? { deletedAt: { not: null } }
      : q.status === "disabled" ? { status: false, deletedAt: null }
      : q.status === "unverified" ? { isEmailVerified: false, deletedAt: null }
      : q.status === "locked" ? { lockedUntil: { gt: now }, deletedAt: null }
      : q.status === "active" ? { status: true, deletedAt: null }
      : { deletedAt: null };
    const where = {
      ...statusWhere,
      ...(q.search
        ? { OR: [{ email: { contains: q.search, mode: "insensitive" as const } }, { firstName: { contains: q.search, mode: "insensitive" as const } }, { lastName: { contains: q.search, mode: "insensitive" as const } }, { id: q.search }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: orderBy(q, ["createdAt", "email", "updatedAt"] as const, "createdAt"),
        ...skipTake(q),
        select: { ...userSelect, _count: { select: { accounts: true } } },
      }),
      prisma.user.count({ where }),
    ]);
    return page(rows.map(({ _count, ...u }) => ({ ...u, accounts: _count.accounts, locked: !!u.lockedUntil && u.lockedUntil > now })), total, q);
  });

  fastify.get<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("user.read")] }, async (request, reply) => {
    const { id } = request.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        ...userSelect,
        accounts: { select: { roleLevel: true, createdAt: true, role: { select: { name: true } }, account: { select: { id: true, name: true, type: true, status: true, slug: true } } } },
      },
    });
    if (!user) throw new NotFoundError("User not found");
    const [activeSessions, keysCreated, recentActivity, feedback] = await Promise.all([
      prisma.session.findMany({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.apiKey.count({ where: { createdById: id } }),
      prisma.auditLog.findMany({ where: { OR: [{ userId: id }, { targetUserId: id }] }, orderBy: { createdAt: "desc" }, take: 25 }),
      prisma.feedback.count({ where: { userId: id } }),
    ]);
    return successResponse(reply, "Success", 200, { ...user, activeSessions, keysCreated, recentActivity, feedbackCount: feedback });
  });

  fastify.patch<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("user.update")] }, async (request, reply) => {
    const { id } = request.params;
    const body = updateBody.parse(request.body);
    if (body.status === false && !body.reason) throw new ValidationError("A reason is required to disable a user");
    const before = await prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!before || before.deletedAt) throw new NotFoundError("User not found");
    const { reason, ...data } = body;
    const disabling = body.status === false && before.status;
    const after = await prisma.user.update({
      where: { id },
      // Disabling also bumps tokenVersion so outstanding access tokens die now.
      data: { ...data, ...(disabling ? { tokenVersion: { increment: 1 } } : {}) },
      select: userSelect,
    });
    if (disabling) await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await fastify.authStateCache.invalidateUser(id);
    await audit(fastify, request, { action: disabling ? "user.disabled" : body.status === true && !before.status ? "user.enabled" : "user.updated", targetType: "User", targetId: id, before, after, reason });
    return successResponse(reply, "User updated", 200, after);
  });

  fastify.post<{ Params: { id: string } }>("/:id/unlock", { onRequest: [fastify.requireAbility("user.update")] }, async (request, reply) => {
    const { id } = request.params;
    const user = await prisma.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null }, select: { id: true } }).catch(() => null);
    if (!user) throw new NotFoundError("User not found");
    await audit(fastify, request, { action: "user.unlocked", targetType: "User", targetId: id });
    return successResponse(reply, "User unlocked", 200, { id });
  });

  /** Sign the user out everywhere (all refresh sessions and access tokens). */
  fastify.post<{ Params: { id: string } }>("/:id/sign-out", { onRequest: [fastify.requireAbility("user.update")] }, async (request, reply) => {
    const { id } = request.params;
    const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundError("User not found");
    const [revoked] = await prisma.$transaction([
      prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } }),
    ]);
    await fastify.authStateCache.invalidateUser(id);
    await audit(fastify, request, { action: "user.signed_out", targetType: "User", targetId: id, after: { revokedSessions: revoked.count } });
    return successResponse(reply, "User signed out everywhere", 200, { revokedSessions: revoked.count });
  });

  /** Email the user a password-reset link (the same flow as "forgot password"). */
  fastify.post<{ Params: { id: string } }>("/:id/password-reset", { onRequest: [fastify.requireAbility("user.update")] }, async (request, reply) => {
    const { id } = request.params;
    const user = await prisma.user.findUnique({ where: { id }, select: { email: true, deletedAt: true } });
    if (!user || user.deletedAt) throw new NotFoundError("User not found");
    await fastify.requestPasswordResetUseCase.execute({ email: user.email, ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? "admin" });
    await audit(fastify, request, { action: "user.password_reset_sent", targetType: "User", targetId: id });
    return successResponse(reply, "Password reset email sent", 200, { email: user.email });
  });

  /**
   * Delete a user (privacy request). Personal data is erased, sessions and the
   * user's keys revoked, memberships removed. Refused while the user is the
   * only owner of an organization with other members (transfer it first).
   * Records keep the anonymized row so foreign keys and audit history hold.
   */
  fastify.delete<{ Params: { id: string } }>("/:id", { onRequest: [fastify.requireAbility("user.delete")] }, async (request, reply) => {
    const { id } = request.params;
    const reason = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body ?? {}).reason;
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, deletedAt: true, accounts: { select: { accountId: true, roleLevel: true, account: { select: { type: true, _count: { select: { members: true } } } } } } } });
    if (!user || user.deletedAt) throw new NotFoundError("User not found");
    const OWNER = RoleLevel.OWNER;
    for (const m of user.accounts) {
      if (m.account.type === "ORGANIZATION" && m.roleLevel >= OWNER && m.account._count.members > 1) {
        const otherOwners = await prisma.accountMember.count({ where: { accountId: m.accountId, roleLevel: { gte: OWNER }, userId: { not: id } } });
        if (otherOwners === 0) throw new ValidationError("This user is the only owner of an organization with other members. Transfer ownership first.");
      }
    }
    const keys = await prisma.apiKey.findMany({ where: { createdById: id, status: "ACTIVE" }, select: { keyId: true } });
    const personalAccounts = user.accounts.filter((m) => m.account.type === "PERSONAL").map((m) => m.accountId);
    const soleOrgs = user.accounts.filter((m) => m.account.type === "ORGANIZATION" && m.account._count.members === 1).map((m) => m.accountId);
    const anonymized = `deleted-${id}@deleted.invalid`;
    await prisma.$transaction([
      prisma.apiKey.updateMany({ where: { createdById: id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } }),
      prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.account.updateMany({ where: { id: { in: [...personalAccounts, ...soleOrgs] } }, data: { status: "DELETED", deletedAt: new Date(), statusReason: "owner deleted" } }),
      prisma.accountMember.deleteMany({ where: { userId: id, accountId: { notIn: [...personalAccounts, ...soleOrgs] } } }),
      prisma.user.update({
        where: { id },
        data: { email: anonymized, firstName: "Deleted", lastName: "User", password: "!", status: false, deletedAt: new Date(), tokenVersion: { increment: 1 } },
      }),
    ]);
    await invalidateKeyCache(fastify, keys);
    await fastify.authStateCache.invalidateUser(id);
    await audit(fastify, request, { action: "user.deleted", targetType: "User", targetId: id, before: { email: user.email }, after: { email: anonymized }, reason });
    return successResponse(reply, "User deleted", 200, { id, revokedKeys: keys.length });
  });
}
