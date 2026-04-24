// ─────────────────────────────────────────────────────────────────────────────
// src/modules/notifications/domain/repositories/INotificationRepository.ts
// ─────────────────────────────────────────────────────────────────────────────

import { Notification } from "@/modules/notification/domain/entities/Notification.entities";

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
