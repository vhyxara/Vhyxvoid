// Small helpers shared by the platform module's routes.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma";
import { getAdminContext, getAuditMetadata } from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  sortBy: z.string().trim().max(50).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export function skipTake(q: { page: number; limit: number }) {
  return { skip: (q.page - 1) * q.limit, take: q.limit };
}

/** The `{ items, meta }` envelope the admin tables read (same as tableResponse). */
export function page<T>(items: T[], total: number, q: { page: number; limit: number }, extra?: unknown) {
  return {
    success: true as const,
    message: "Success",
    items,
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
    ...(extra !== undefined ? { extra } : {}),
  };
}

/** Pick a sort field only from an allowlist. */
export function orderBy<F extends string>(q: { sortBy?: string; sortOrder: "asc" | "desc" }, allowed: readonly F[], fallback: F) {
  const field = (allowed as readonly string[]).includes(q.sortBy ?? "") ? (q.sortBy as F) : fallback;
  return { [field]: q.sortOrder } as Record<F, "asc" | "desc">;
}

export function prismaOf(fastify: FastifyInstance): PrismaClient {
  return (fastify as unknown as { prisma: PrismaClient }).prisma;
}

/**
 * Write an immutable AdminAuditLog row for an admin action. Never throws:
 * the action already happened, and a lost audit row is logged loudly.
 */
export async function audit(
  fastify: FastifyInstance,
  request: FastifyRequest,
  entry: { action: string; targetType: string; targetId?: string | null; before?: unknown; after?: unknown; reason?: string },
): Promise<void> {
  try {
    const admin = getAdminContext(request);
    await prismaOf(fastify).adminAuditLog.create({
      data: {
        adminId: admin.id,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        changes: entry.before !== undefined || entry.after !== undefined ? ({ before: entry.before ?? null, after: entry.after ?? null } as object) : undefined,
        metadata: { ...getAuditMetadata(request, 200), ...(entry.reason ? { reason: entry.reason } : {}) },
      },
    });
  } catch (err) {
    console.error("[audit] failed to write admin audit log", entry.action, (err as Error).message);
  }
}

/** Date range query (`from`/`to`), capped so aggregate queries stay cheap. */
export const rangeQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export function since(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}
