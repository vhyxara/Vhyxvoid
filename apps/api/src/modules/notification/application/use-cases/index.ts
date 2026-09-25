// src/modules/notifications/application/use-cases/index.ts
// All notification use cases.
// Each use case is responsible for ONE trigger.
// They all follow the same pattern: receive params → build template → send.

import { NotificationType } from "@/modules/notification/domain/enums";
import { Notification } from "@/modules/notification/domain/entities/Notification.entities";
import { INotificationRepository } from "@/modules/notification/domain/repositories/INotificationRepository";
import { IEmailService } from "@/modules/notification/domain/services/IEmailService.notification";
import {
  accountInvitation,
  emailVerification,
  feedbackReceived,
  finishSignup,
  passwordResetRequest,
  passwordResetSuccess,
  paymentFailed,
  paymentSucceeded,
  subscriptionCanceled,
  trialEnding,
} from "@/modules/notification/infrastructure/email/templates";

const APP_URL = process.env.APP_URL ?? "https://www.vhyxvoid.com";

// ─────────────────────────────────────────────────────────────────────────────
// SendEmailVerificationUseCase
// Replaces: console.log('EMAIL VERIFY TOKEN:', rawToken) in RegisterUserUseCase
// ─────────────────────────────────────────────────────────────────────────────

export class SendEmailVerificationUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: {
    to: string;
    firstName: string;
    rawToken: string; // the unencoded token — embed in URL
  }): Promise<void> {
    const verifyUrl = `${APP_URL}/verify-email?token=${encodeURIComponent(params.rawToken)}`;

    const { subject, html, text } = emailVerification({
      firstName: params.firstName,
      verifyUrl,
      expiresInHours: 24,
    });

    await this.emailService.send({ to: params.to, subject, html, text });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SendInvitationEmailUseCase
// Replaces: the missing email send in InviteMemberUseCase
// ─────────────────────────────────────────────────────────────────────────────

export class SendInvitationEmailUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: {
    to: string;
    inviterName: string;
    accountName: string;
    rawToken: string; // raw invitation token
    roleLevel: number; // 100=OWNER, 70=ADMIN, 10=MEMBER
  }): Promise<void> {
    const roleLabel = params.roleLevel >= 70 ? "Admin" : "Member";
    const inviteUrl = `${APP_URL}/invitations/accept?token=${encodeURIComponent(params.rawToken)}`;

    const { subject, html, text } = accountInvitation({
      inviterName: params.inviterName,
      accountName: params.accountName,
      inviteUrl,
      roleLabel,
      expiresInDays: 3,
    });

    await this.emailService.send({ to: params.to, subject, html, text });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SendPaymentFailedEmailUseCase
// Called by HandleStripeWebhookUseCase on invoice.payment_failed
// ─────────────────────────────────────────────────────────────────────────────

export class SendPaymentFailedEmailUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: {
    to: string;
    firstName: string;
    accountName: string;
    amountFormatted: string;
    graceEndsAt: Date;
    billingPortalUrl?: string;
  }): Promise<void> {
    const billingPortalUrl =
      params.billingPortalUrl ?? `${APP_URL}/settings/billing`;

    const { subject, html, text } = paymentFailed({
      firstName: params.firstName,
      accountName: params.accountName,
      amountFormatted: params.amountFormatted,
      billingPortalUrl,
      graceEndsAt: params.graceEndsAt,
    });

    await this.emailService.send({ to: params.to, subject, html, text });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SendPaymentSucceededEmailUseCase
// Called by HandleStripeWebhookUseCase on invoice.payment_succeeded
// ─────────────────────────────────────────────────────────────────────────────

export class SendPaymentSucceededEmailUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: {
    to: string;
    firstName: string;
    accountName: string;
    amountFormatted: string;
    invoiceUrl: string;
    periodEnd: Date;
  }): Promise<void> {
    const { subject, html, text } = paymentSucceeded(params);
    await this.emailService.send({ to: params.to, subject, html, text });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SendSubscriptionCanceledEmailUseCase
// ─────────────────────────────────────────────────────────────────────────────

export class SendSubscriptionCanceledEmailUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: {
    to: string;
    firstName: string;
    accountName: string;
    accessEndsAt: Date;
  }): Promise<void> {
    const resubscribeUrl = `${APP_URL}/settings/billing`;
    const { subject, html, text } = subscriptionCanceled({
      ...params,
      resubscribeUrl,
    });
    await this.emailService.send({ to: params.to, subject, html, text });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SendTrialEndingEmailUseCase
// ─────────────────────────────────────────────────────────────────────────────

export class SendTrialEndingEmailUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: {
    to: string;
    firstName: string;
    accountName: string;
    trialEndsAt: Date;
    daysLeft: number;
  }): Promise<void> {
    const upgradeUrl = `${APP_URL}/settings/billing`;
    const { subject, html, text } = trialEnding({
      ...params,
      upgradeUrl,
    });
    await this.emailService.send({ to: params.to, subject, html, text });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateInAppNotificationUseCase
// Persists a notification record for the in-app bell icon.
// Called after any significant event (invite accepted, role changed, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export class CreateInAppNotificationUseCase {
  constructor(private readonly notificationRepo: INotificationRepository) {}

  async execute(params: {
    userId: string;
    accountId?: string | null;
    type: NotificationType;
    title: string;
    body: string;
    actionUrl?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    const notification = Notification.create(params);
    await this.notificationRepo.save(notification);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MarkNotificationReadUseCase
// ─────────────────────────────────────────────────────────────────────────────

export class MarkNotificationReadUseCase {
  constructor(private readonly notificationRepo: INotificationRepository) {}

  async execute(notificationId: string, userId: string): Promise<void> {
    const notification = await this.notificationRepo.findById(notificationId);

    // Silently ignore if not found or doesn't belong to user (idempotent)
    if (!notification || notification.userId !== userId) return;

    notification.markRead(new Date());
    await this.notificationRepo.save(notification);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MarkAllNotificationsReadUseCase
// ─────────────────────────────────────────────────────────────────────────────

export class MarkAllNotificationsReadUseCase {
  constructor(private readonly notificationRepo: INotificationRepository) {}

  async execute(userId: string): Promise<void> {
    await this.notificationRepo.markAllReadByUserId(userId, new Date());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GetNotificationsUseCase
// Returns paginated notifications + unread count for the bell icon badge.
// ─────────────────────────────────────────────────────────────────────────────

export class GetNotificationsUseCase {
  constructor(private readonly notificationRepo: INotificationRepository) {}

  async execute(
    userId: string,
    params: {
      limit?: number;
      offset?: number;
      unreadOnly?: boolean;
    } = {},
  ): Promise<{
    notifications: {
      id: string;
      type: NotificationType;
      title: string;
      body: string;
      actionUrl: string | null;
      isRead: boolean;
      createdAt: Date;
    }[];
    unreadCount: number;
  }> {
    const [notifications, unreadCount] = await Promise.all([
      this.notificationRepo.findByUserId(userId, params),
      this.notificationRepo.countUnread(userId),
    ]);

    return {
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        actionUrl: n.actionUrl,
        isRead: n.isRead,
        createdAt: n.createdAt,
      })),
      unreadCount,
    };
  }
}

// Add this use case class
export class SendPasswordResetEmailUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: {
    to: string;
    firstName: string;
    rawToken: string;
  }): Promise<void> {
    const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(params.rawToken)}`;
    const { subject, html, text } = passwordResetRequest({
      firstName: params.firstName,
      resetUrl,
      expiresInHours: 1,
    });
    await this.emailService.send({ to: params.to, subject, html, text });
  }
}

export class SendFinishSignupEmailUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: { to: string; firstName: string; rawToken: string }): Promise<void> {
    // Same page as a password reset: completing it sets the password and,
    // for an unverified account, verifies the address.
    const url = `${APP_URL}/reset-password?token=${encodeURIComponent(params.rawToken)}`;
    const { subject, html, text } = finishSignup({ firstName: params.firstName, url, expiresInHours: 24 });
    await this.emailService.send({ to: params.to, subject, html, text });
  }
}

export class SendPasswordResetSuccessEmailUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: { to: string; firstName: string }): Promise<void> {
    const { subject, html, text } = passwordResetSuccess({
      firstName: params.firstName,
    });
    await this.emailService.send({ to: params.to, subject, html, text });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SendFeedbackReceivedEmailUseCase
// Called by SubmitFeedbackUseCase after a user submits feedback.
// Sends to the admin email, not the user.
// ─────────────────────────────────────────────────────────────────────────────

export class SendFeedbackReceivedEmailUseCase {
  constructor(private readonly emailService: IEmailService) {}

  async execute(params: {
    adminEmail: string;
    userName: string;
    userEmail: string;
    type: string;
    title: string;
    description: string;
    feedbackId: string;
  }): Promise<void> {
    const adminPanelUrl = `${process.env.APP_URL}/admin/feedback/${params.feedbackId}`;

    const { subject, html, text } = feedbackReceived({
      userName: params.userName,
      userEmail: params.userEmail,
      type: params.type,
      title: params.title,
      description: params.description,
      feedbackId: params.feedbackId,
      adminPanelUrl,
    });

    await this.emailService.send({
      to: params.adminEmail,
      subject,
      html,
      text,
    });
  }
}
// ─────────────────────────────────────────────────────────────────────────────
// NotificationService — convenience wrapper used by other modules
// Single class that other modules inject to send any notification without
// knowing which use case to call. Keeps other modules thin.
// ─────────────────────────────────────────────────────────────────────────────

export class NotificationService {
  readonly sendEmailVerification: SendEmailVerificationUseCase;
  readonly sendInvitation: SendInvitationEmailUseCase;
  readonly sendPaymentFailed: SendPaymentFailedEmailUseCase;
  readonly sendPaymentSucceeded: SendPaymentSucceededEmailUseCase;
  readonly sendSubscriptionCanceled: SendSubscriptionCanceledEmailUseCase;
  readonly sendTrialEnding: SendTrialEndingEmailUseCase;
  readonly sendPasswordReset: SendPasswordResetEmailUseCase; // ← add
  readonly sendPasswordResetSuccess: SendPasswordResetSuccessEmailUseCase;
  readonly sendFinishSignup: SendFinishSignupEmailUseCase;
  readonly createInApp: CreateInAppNotificationUseCase;
  readonly markRead: MarkNotificationReadUseCase;
  readonly markAllRead: MarkAllNotificationsReadUseCase;
  readonly getNotifications: GetNotificationsUseCase;
  readonly sendFeedbackReceived: SendFeedbackReceivedEmailUseCase;
  constructor(
    emailService: IEmailService,
    notificationRepo: INotificationRepository,
  ) {
    this.sendEmailVerification = new SendEmailVerificationUseCase(emailService);
    this.sendInvitation = new SendInvitationEmailUseCase(emailService);
    this.sendPaymentFailed = new SendPaymentFailedEmailUseCase(emailService);
    this.sendPaymentSucceeded = new SendPaymentSucceededEmailUseCase(
      emailService,
    );
    this.sendSubscriptionCanceled = new SendSubscriptionCanceledEmailUseCase(
      emailService,
    );
    this.sendTrialEnding = new SendTrialEndingEmailUseCase(emailService);
    this.sendPasswordReset = new SendPasswordResetEmailUseCase(emailService); // ← add
    this.sendFinishSignup = new SendFinishSignupEmailUseCase(emailService);
    this.sendPasswordResetSuccess = new SendPasswordResetSuccessEmailUseCase(
      emailService,
    );
    this.createInApp = new CreateInAppNotificationUseCase(notificationRepo);
    this.markRead = new MarkNotificationReadUseCase(notificationRepo);
    this.markAllRead = new MarkAllNotificationsReadUseCase(notificationRepo);
    this.getNotifications = new GetNotificationsUseCase(notificationRepo);
    this.sendFeedbackReceived = new SendFeedbackReceivedEmailUseCase(
      emailService,
    );
  }
}
