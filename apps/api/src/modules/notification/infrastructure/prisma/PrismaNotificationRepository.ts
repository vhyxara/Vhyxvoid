// src/modules/notifications/infrastructure/repositories/PrismaNotificationRepository.ts

import { PrismaClient } from "@/generated/prisma";
import { Notification } from "@/modules/notification/domain/entities/Notification.entities";
import {
  NotificationType,
  NotificationStatus,
} from "@/modules/notification/domain/enums";

export interface NotificationListOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export interface INotificationRepository {
  save(notification: Notification): Promise<void>;
  findById(id: string): Promise<Notification | null>;
  findByUserId(
    userId: string,
    options?: NotificationListOptions,
  ): Promise<Notification[]>;
  countUnread(userId: string): Promise<number>;
  markAllReadByUserId(userId: string, now: Date): Promise<void>;
}

export class PrismaNotificationRepository implements INotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(notification: Notification): Promise<void> {
    const p = notification.toPersistence();
    await this.prisma.notification.upsert({
      where: { id: p.id },
      update: { status: p.status, readAt: p.readAt },
      create: {
        id: p.id,
        userId: p.userId,
        accountId: p.accountId,
        type: p.type,
        title: p.title,
        body: p.body,
        actionUrl: p.actionUrl,
        metadata: p.metadata ?? undefined,
        status: p.status,
        readAt: p.readAt,
        createdAt: p.createdAt,
      },
    });
  }

  async findById(id: string): Promise<Notification | null> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    return row ? this.toEntity(row) : null;
  }

  async findByUserId(
    userId: string,
    options: NotificationListOptions = {},
  ): Promise<Notification[]> {
    const { limit = 30, offset = 0, unreadOnly = false } = options;
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });
    return rows.map((r) => this.toEntity(r));
  }

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markAllReadByUserId(userId: string, now: Date): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now, status: "READ" },
    });
  }

  private toEntity(row: any): Notification {
    return Notification.rehydrate({
      id: row.id,
      userId: row.userId,
      accountId: row.accountId,
      type: row.type as NotificationType,
      title: row.title,
      body: row.body,
      actionUrl: row.actionUrl,
      metadata: row.metadata as Record<string, unknown> | null,
      status: row.status as NotificationStatus,
      readAt: row.readAt,
      createdAt: row.createdAt,
    });
  }
}
