// src/modules/notifications/domain/entities/Notification.ts

import {
  NotificationType,
  NotificationStatus,
} from "@/modules/notification/domain/enums";

export interface NotificationProps {
  id: string;
  userId: string;
  accountId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl: string | null;
  metadata: Record<string, unknown> | null;
  status: NotificationStatus;
  readAt: Date | null;
  createdAt: Date;
}

export class Notification {
  private constructor(private props: NotificationProps) {}

  static create(params: {
    userId: string;
    accountId?: string | null;
    type: NotificationType;
    title: string;
    body: string;
    actionUrl?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Notification {
    return new Notification({
      id: crypto.randomUUID(),
      userId: params.userId,
      accountId: params.accountId ?? null,
      type: params.type,
      title: params.title,
      body: params.body,
      actionUrl: params.actionUrl ?? null,
      metadata: params.metadata ?? null,
      status: NotificationStatus.SENT,
      readAt: null,
      createdAt: new Date(),
    });
  }

  static rehydrate(props: NotificationProps): Notification {
    return new Notification(props);
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get accountId(): string | null {
    return this.props.accountId;
  }
  get type(): NotificationType {
    return this.props.type;
  }
  get title(): string {
    return this.props.title;
  }
  get body(): string {
    return this.props.body;
  }
  get actionUrl(): string | null {
    return this.props.actionUrl;
  }
  get metadata(): Record<string, unknown> | null {
    return this.props.metadata;
  }
  get status(): NotificationStatus {
    return this.props.status;
  }
  get readAt(): Date | null {
    return this.props.readAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get isRead(): boolean {
    return this.props.readAt !== null;
  }

  markRead(now: Date): void {
    if (!this.props.readAt) {
      this.props.readAt = now;
      this.props.status = NotificationStatus.READ;
    }
  }

  toPersistence(): NotificationProps {
    return { ...this.props };
  }
}
