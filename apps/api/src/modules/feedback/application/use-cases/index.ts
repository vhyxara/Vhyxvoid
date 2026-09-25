import {
  FeedbackType,
  FeedbackStatus,
  FeedbackPriority,
} from "@/generated/prisma";
import {
  Feedback,
  FeedbackProps,
} from "../../domain/entities/Feedback.entities";
import { FeedbackRepository } from "../../domain/repositories/Feedback.repositories";
import { NotFoundError, ForbiddenError } from "@/core/errors/error.format";
import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";

const pickTriageFields = (f: Feedback) => ({
  status: f.status,
  priority: f.priority,
  adminNotes: f.adminNotes,
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT FEEDBACK USE CASE
//
// Called when a user submits a bug report or feedback from the dashboard.
// Auto-captures userAgent from the request.
// Sends an email notification to the admin after submission.
// ─────────────────────────────────────────────────────────────────────────────

export class SubmitFeedbackUseCase {
  constructor(
    private feedbackRepository: FeedbackRepository,
    private notificationService?: {
      sendFeedbackReceived: {
        execute(p: {
          adminEmail: string;
          userName: string;
          userEmail: string;
          type: string;
          title: string;
          description: string;
          feedbackId: string;
        }): Promise<void>;
      };
    },
  ) {}

  async execute(params: {
    userId: string;
    userEmail: string;
    userName: string;
    accountId?: string | null;
    type: FeedbackType;
    title: string;
    description: string;
    stepsToReproduce?: string | null;
    expectedBehavior?: string | null;
    actualBehavior?: string | null;
    pageUrl?: string | null;
    userAgent?: string | null;
    appVersion?: string | null;
    attachments?: string[];
  }): Promise<{ id: string; message: string }> {
    const feedback = Feedback.create({
      userId: params.userId,
      accountId: params.accountId,
      type: params.type,
      title: params.title,
      description: params.description,
      stepsToReproduce: params.stepsToReproduce,
      expectedBehavior: params.expectedBehavior,
      actualBehavior: params.actualBehavior,
      pageUrl: params.pageUrl,
      userAgent: params.userAgent,
      appVersion: params.appVersion,
      attachments: params.attachments ?? [],
    });

    await this.feedbackRepository.save(feedback);

    // Notify admin — fire and forget
    // Set ADMIN_EMAIL in your .env
    const adminEmail =
      process.env.ADMIN_FEEDBACK_EMAIL ?? process.env.SUPPORT_EMAIL;
    if (this.notificationService && adminEmail) {
      this.notificationService.sendFeedbackReceived
        .execute({
          adminEmail,
          userName: params.userName,
          userEmail: params.userEmail,
          type: params.type,
          title: params.title,
          description: params.description,
          feedbackId: feedback.id,
        })
        .catch((err) =>
          console.error("[notifications] sendFeedbackReceived failed", err),
        );
    }

    return {
      id: feedback.id,
      message: "Thank you for your feedback. We will review it shortly.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET MY FEEDBACK USE CASE
//
// Returns paginated list of feedback submitted by the authenticated user.
// Users can only see their own submissions — never other users' feedback.
// ─────────────────────────────────────────────────────────────────────────────

export class GetMyFeedbackUseCase {
  constructor(private feedbackRepository: FeedbackRepository) {}

  async execute(params: {
    userId: string;
    page?: number;
    limit?: number;
    status?: FeedbackStatus;
    type?: FeedbackType;
  }): Promise<{
    items: {
      id: string;
      type: FeedbackType;
      status: FeedbackStatus;
      priority: FeedbackPriority;
      title: string;
      description: string;
      resolvedAt: Date | null;
      createdAt: Date;
    }[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    const { items, total } = await this.feedbackRepository.findByUserId(
      params.userId,
      { page, limit, status: params.status, type: params.type },
    );

    return {
      items: items.map((f) => ({
        id: f.id,
        type: f.type,
        status: f.status,
        priority: f.priority,
        title: f.title,
        description: f.description,
        resolvedAt: f.resolvedAt,
        createdAt: f.createdAt,
      })),
      total,
      page,
      limit,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET FEEDBACK BY ID USE CASE
//
// Returns a single feedback item.
// Users can only retrieve their own — admins can retrieve any.
// ─────────────────────────────────────────────────────────────────────────────

export class GetFeedbackByIdUseCase {
  constructor(private feedbackRepository: FeedbackRepository) {}

  async execute(params: {
    feedbackId: string;
    userId: string;
    isAdmin: boolean;
  }): Promise<FeedbackProps> {
    const feedback = await this.feedbackRepository.findById(params.feedbackId);
    if (!feedback) throw new NotFoundError("Feedback not found");

    // Non-admins can only see their own feedback
    if (!params.isAdmin && feedback.userId !== params.userId) {
      throw new ForbiddenError("You do not have access to this feedback");
    }

    return feedback.toPersistence();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — LIST ALL FEEDBACK USE CASE
//
// Returns paginated feedback from all users.
// Admin only. Includes user details for each item.
// ─────────────────────────────────────────────────────────────────────────────

export class AdminListFeedbackUseCase {
  constructor(private feedbackRepository: FeedbackRepository) {}

  async execute(params: {
    page?: number;
    limit?: number;
    status?: FeedbackStatus;
    type?: FeedbackType;
    priority?: FeedbackPriority;
  }): Promise<{
    items: ReturnType<Feedback["toPersistence"]>[];
    total: number;
    page: number;
    limit: number;
    counts: {
      open: number;
      underReview: number;
      inProgress: number;
      resolved: number;
    };
  }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    // Filtered page + per-status counts (one grouped query) in parallel
    const [{ items, total }, counts] = await Promise.all([
      this.feedbackRepository.findAll({ page, limit, ...params }),
      this.feedbackRepository.countByStatus(),
    ]);

    return {
      items: items.map((f) => f.toPersistence()),
      total,
      page,
      limit,
      counts: {
        open: counts[FeedbackStatus.OPEN] ?? 0,
        underReview: counts[FeedbackStatus.UNDER_REVIEW] ?? 0,
        inProgress: counts[FeedbackStatus.IN_PROGRESS] ?? 0,
        resolved: counts[FeedbackStatus.RESOLVED] ?? 0,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — UPDATE FEEDBACK USE CASE
//
// Allows admin to update status, priority, and add internal notes.
// This is what the admin panel uses to triage and resolve feedback.
// Every update writes an AdminAuditLog row (feedback.updated), like every
// other admin mutation.
// ─────────────────────────────────────────────────────────────────────────────

export class AdminUpdateFeedbackUseCase {
  constructor(
    private feedbackRepository: FeedbackRepository,
    private adminAuditLogRepository: { save(log: AdminAuditLog): Promise<void> },
  ) {}

  async execute(params: {
    feedbackId: string;
    adminId: string;
    auditMetadata?: Parameters<typeof AdminAuditLog.create>[0]["metadata"];
    status?: FeedbackStatus;
    priority?: FeedbackPriority;
    adminNotes?: string;
  }): Promise<{
    id: string;
    status: FeedbackStatus;
    priority: FeedbackPriority;
  }> {
    const feedback = await this.feedbackRepository.findById(params.feedbackId);
    if (!feedback) throw new NotFoundError("Feedback not found");

    const now = new Date();
    const before = pickTriageFields(feedback);

    if (params.status) feedback.updateStatus(params.status, now);
    if (params.priority) feedback.updatePriority(params.priority, now);
    if (params.adminNotes !== undefined)
      feedback.addAdminNote(params.adminNotes, now);

    await this.feedbackRepository.save(feedback);

    await this.adminAuditLogRepository.save(
      AdminAuditLog.create({
        adminId: params.adminId,
        action: AuditAction.FEEDBACK_UPDATED,
        targetType: "Feedback",
        targetId: feedback.id,
        changes: { before, after: pickTriageFields(feedback) },
        metadata: params.auditMetadata,
      }),
    );

    return {
      id: feedback.id,
      status: feedback.status,
      priority: feedback.priority,
    };
  }
}
