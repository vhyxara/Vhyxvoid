// identity/infrastructure/repositories/PrismaAdminAuditLogRepository.ts

import { PrismaTransactionalClient } from "@/core/types/core/prisma";
import { AdminAuditLog } from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { AdminAuditLogRepository } from "@/modules/identity/domain/repositories/admin/AdminAuditLog.repositories";

export class PrismaAdminAuditLogRepository implements AdminAuditLogRepository {
  constructor(private prisma: PrismaTransactionalClient) {}

  async save(log: AdminAuditLog): Promise<void> {
    const p = log.toPersistence();

    await this.prisma.adminAuditLog.create({
      data: {
        id: p.id,
        adminId: p.adminId,
        action: p.action,
        targetType: p.targetType,
        targetId: p.targetId,
        changes: p.changes === null ? undefined : p.changes,
        metadata: p.metadata === null ? undefined : p.metadata,
        createdAt: p.createdAt,
      },
    });
  }

  async findById(id: string): Promise<AdminAuditLog | null> {
    const data = await this.prisma.adminAuditLog.findUnique({
      where: { id },
    });

    if (!data || !data.adminId) return null;

    return AdminAuditLog.rehydrate({
      id: data.id,
      adminId: data.adminId,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      changes: data.changes as any,
      metadata: data.metadata as any,
      createdAt: data.createdAt,
    });
  }

  async findByAdminId(
    adminId: string,
    limit = 50,
    offset = 0,
  ): Promise<AdminAuditLog[]> {
    const data = await this.prisma.adminAuditLog.findMany({
      where: { adminId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    return data.map((d) =>
      AdminAuditLog.rehydrate({
        id: d.id,
        adminId: d.adminId,
        action: d.action,
        targetType: d.targetType,
        targetId: d.targetId,
        changes: d.changes as any,
        metadata: d.metadata as any,
        createdAt: d.createdAt,
      }),
    );
  }

  async findByAction(
    action: string,
    limit = 50,
    offset = 0,
  ): Promise<AdminAuditLog[]> {
    const data = await this.prisma.adminAuditLog.findMany({
      where: { action },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    return data.map((d) =>
      AdminAuditLog.rehydrate({
        id: d.id,
        adminId: d.adminId,
        action: d.action,
        targetType: d.targetType,
        targetId: d.targetId,
        changes: d.changes as any,
        metadata: d.metadata as any,
        createdAt: d.createdAt,
      }),
    );
  }

  async findByTargetId(
    targetId: string,
    limit = 50,
    offset = 0,
  ): Promise<AdminAuditLog[]> {
    const data = await this.prisma.adminAuditLog.findMany({
      where: { targetId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    return data.map((d) =>
      AdminAuditLog.rehydrate({
        id: d.id,
        adminId: d.adminId,
        action: d.action,
        targetType: d.targetType,
        targetId: d.targetId,
        changes: d.changes as any,
        metadata: d.metadata as any,
        createdAt: d.createdAt,
      }),
    );
  }

  async findAll(limit = 50, offset = 0): Promise<AdminAuditLog[]> {
    const data = await this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    return data.map((d) =>
      AdminAuditLog.rehydrate({
        id: d.id,
        adminId: d.adminId,
        action: d.action,
        targetType: d.targetType,
        targetId: d.targetId,
        changes: d.changes as any,
        metadata: d.metadata as any,
        createdAt: d.createdAt,
      }),
    );
  }

  async countByAdminId(adminId: string): Promise<number> {
    return this.prisma.adminAuditLog.count({ where: { adminId } });
  }

  async countByAction(action: string): Promise<number> {
    return this.prisma.adminAuditLog.count({ where: { action } });
  }

  async countByTargetId(targetId: string): Promise<number> {
    return this.prisma.adminAuditLog.count({ where: { targetId } });
  }
}
