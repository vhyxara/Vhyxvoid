import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  FeedbackType,
  FeedbackStatus,
  FeedbackPriority,
} from "@/generated/prisma";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  getAdminContext,
  getAuditMetadata,
} from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";
import { ValidationError } from "@/core/errors/error.format";
import { SubmitFeedbackUseCase } from "../../application/use-cases";
import { GetMyFeedbackUseCase } from "../../application/use-cases";
import { GetFeedbackByIdUseCase } from "../../application/use-cases";
import { AdminListFeedbackUseCase } from "../../application/use-cases";
import { AdminUpdateFeedbackUseCase } from "../../application/use-cases";
import { successResponse, tableResponse } from "@/core/utils/response.util";
import { PrismaFeedbackRepository } from "../../infrastructure/prisma/PrismaFeedbackRepository";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────

const submitFeedbackSchema = z.object({
  type: z.nativeEnum(FeedbackType),
  title: z.string().min(3, "Title must be at least 3 characters").max(150),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(5000),

  // Bug report specific — optional for other types
  stepsToReproduce: z.string().max(3000).optional().nullable(),
  expectedBehavior: z.string().max(1000).optional().nullable(),
  actualBehavior: z.string().max(1000).optional().nullable(),

  // Auto-captured on frontend but can be sent explicitly
  pageUrl: z.string().url().optional().nullable(),
  appVersion: z.string().max(50).optional().nullable(),

  // Optional account context
  accountId: z.string().uuid().optional().nullable(),

  // Attachment URLs — frontend uploads to storage first, sends URLs here
  attachments: z.array(z.string().url()).max(5).optional(),
});

const listMyFeedbackSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  status: z.nativeEnum(FeedbackStatus).optional(),
  type: z.nativeEnum(FeedbackType).optional(),
});

const feedbackIdParamSchema = z.object({
  feedbackId: z.string().uuid(),
});

const adminListFeedbackSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.nativeEnum(FeedbackStatus).optional(),
  type: z.nativeEnum(FeedbackType).optional(),
  priority: z.nativeEnum(FeedbackPriority).optional(),
});

const adminUpdateFeedbackSchema = z.object({
  status: z.nativeEnum(FeedbackStatus).optional(),
  priority: z.nativeEnum(FeedbackPriority).optional(),
  adminNotes: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// USER ROUTES
// ─────────────────────────────────────────────────────────────────────────────

export async function feedbackRoutes(fastify: FastifyInstance) {
  const feedbackRepo = new PrismaFeedbackRepository(fastify.prisma);

  const submitUseCase = new SubmitFeedbackUseCase(
    feedbackRepo,
    fastify.notificationService,
  );
  const listMyUseCase = new GetMyFeedbackUseCase(feedbackRepo);
  const getByIdUseCase = new GetFeedbackByIdUseCase(feedbackRepo);

  /**
   * POST /feedback
   * Submit a bug report or feedback.
   * Auth: any authenticated user.
   *
   * The frontend should auto-capture:
   *   - pageUrl: window.location.href
   *   - userAgent: navigator.userAgent (send as header, captured below)
   */
  fastify.post<{ Body: z.infer<typeof submitFeedbackSchema> }>(
    "/",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const input = submitFeedbackSchema.parse(request.body);
      const user = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);
      // Fetch user name for admin notification email
      const fullUser = await uow.userRepository.findById(user.id);

      const result = await submitUseCase.execute({
        userId: user.id,
        userEmail: user.email,
        userName: fullUser?.fullName ?? user.email,
        accountId: input.accountId,
        type: input.type,
        title: input.title,
        description: input.description,
        stepsToReproduce: input.stepsToReproduce,
        expectedBehavior: input.expectedBehavior,
        actualBehavior: input.actualBehavior,
        pageUrl: input.pageUrl,
        appVersion: input.appVersion,
        attachments: input.attachments,
        // Capture userAgent from request header — more reliable than frontend sending it
        userAgent: request.headers["user-agent"] ?? null,
      });

      return successResponse(reply, result.message, 201, { id: result.id });
    },
  );

  /**
   * GET /feedback
   * List the authenticated user's own feedback submissions.
   * Paginated. Filterable by status and type.
   */
  fastify.get<{ Querystring: z.infer<typeof listMyFeedbackSchema> }>(
    "/",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const query = listMyFeedbackSchema.parse(request.query);
      const user = getUserContext(request);

      const result = await listMyUseCase.execute({
        userId: user.id,
        ...query,
      });

      return tableResponse(
        reply,
        {
          items: result.items,
          page: result.page,
          limit: result.limit,
          total: result.total,
        },
        "Feedback fetched",
      );
    },
  );

  /**
   * GET /feedback/:feedbackId
   * Get a single feedback item.
   * Users can only retrieve their own.
   */
  fastify.get<{ Params: z.infer<typeof feedbackIdParamSchema> }>(
    "/:feedbackId",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { feedbackId } = feedbackIdParamSchema.parse(request.params);
      const user = getUserContext(request);

      const result = await getByIdUseCase.execute({
        feedbackId,
        userId: user.id,
        isAdmin: false,
      });

      return successResponse(reply, "Feedback fetched", 200, result);
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────────────────────

export async function adminFeedbackRoutes(fastify: FastifyInstance) {
  const feedbackRepo = new PrismaFeedbackRepository(fastify.prisma);
  const listAllUseCase = new AdminListFeedbackUseCase(feedbackRepo);
  const updateUseCase = new AdminUpdateFeedbackUseCase(
    feedbackRepo,
    fastify.uow.adminAuditLogRepository,
  );
  const getByIdUseCase = new GetFeedbackByIdUseCase(feedbackRepo);

  /**
   * GET /admin/feedback
   * List all feedback from all users.
   * Filterable by status, type, priority.
   * Returns counts per status for the admin dashboard sidebar.
   */
  fastify.get<{ Querystring: z.infer<typeof adminListFeedbackSchema> }>(
    "/",
    { onRequest: [fastify.adminAuthGuard] },
    async (request, reply) => {
      const query = adminListFeedbackSchema.parse(request.query);
      const result = await listAllUseCase.execute(query);

      return tableResponse(
        reply,
        {
          items: result.items,
          page: result.page,
          limit: result.limit,
          total: result.total,
          extra: { counts: result.counts },
        },
        "Feedback list fetched",
      );
    },
  );

  /**
   * GET /admin/feedback/:feedbackId
   * Get a single feedback item with full detail.
   * Admin sees everything including adminNotes.
   */
  fastify.get<{ Params: z.infer<typeof feedbackIdParamSchema> }>(
    "/:feedbackId",
    { onRequest: [fastify.adminAuthGuard] },
    async (request, reply) => {
      const { feedbackId } = feedbackIdParamSchema.parse(request.params);
      // This route is gated by adminAuthGuard, which sets request.admin, not
      // request.user -- getUserContext() (meant for userAuthGuard routes,
      // its own docstring says so) always threw "Not authenticated" here,
      // regardless of a valid admin token, since request.user was never
      // set. Fixed to use the matching helper, getAdminContext(). See
      // internal-tools/api/decision.md, 2026-09-17.
      const admin = getAdminContext(request);

      const result = await getByIdUseCase.execute({
        feedbackId,
        userId: admin.id,
        isAdmin: true,
      });

      return successResponse(reply, "Feedback fetched", 200, result);
    },
  );

  /**
   * PATCH /admin/feedback/:feedbackId
   * Update status, priority, or add admin notes.
   * This is how you triage and resolve feedback from the admin panel.
   *
   * Status flow:
   *   OPEN → UNDER_REVIEW → IN_PROGRESS → RESOLVED
   *   OPEN → WONT_FIX
   *   OPEN → CLOSED
   */
  fastify.patch<{
    Params: z.infer<typeof feedbackIdParamSchema>;
    Body: z.infer<typeof adminUpdateFeedbackSchema>;
  }>(
    "/:feedbackId",
    { onRequest: [fastify.adminAuthGuard] },
    async (request, reply) => {
      const { feedbackId } = feedbackIdParamSchema.parse(request.params);
      const input = adminUpdateFeedbackSchema.parse(request.body);

      if (!input.status && !input.priority && input.adminNotes === undefined) {
        throw new ValidationError(
          "Provide at least one field to update: status, priority, or adminNotes",
        );
      }

      const admin = getAdminContext(request);
      const result = await updateUseCase.execute({
        feedbackId,
        adminId: admin.id,
        auditMetadata: getAuditMetadata(request, 200),
        ...input,
      });

      return successResponse(reply, "Feedback updated", 200, result);
    },
  );
}
