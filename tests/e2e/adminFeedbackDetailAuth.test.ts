import { describe, it, expect, vi, beforeEach } from "vitest";

import { adminFeedbackRoutes } from "../../apps/api/src/modules/feedback/presentation/http/feedback.routes";

// Regression test for a real bug found and fixed while building apps/admin's
// Feedback Triage screen (internal-tools/admin-frontend/decision.md,
// 2026-09-17 -- "Screen 7"): GET /admin/feedback/:feedbackId is gated by
// `adminAuthGuard` (which sets `request.admin`), but its handler called
// `getUserContext(request)` -- a helper whose own docstring says it's for
// routes protected by `userAuthGuard` (which sets `request.user` instead).
// Every real admin token hit a 401 "Not authenticated", regardless of
// validity, because `request.user` was never set on an admin-gated
// request. Confirmed via real curl against the live local dev backend
// before fixing (see internal-tools/api/decision.md) -- the fix swaps in
// `getAdminContext(request)`, the helper every other admin-gated route in
// this codebase actually uses.
//
// adminFeedbackRoutes's handlers aren't exported standalone -- registers
// the real plugin against a minimal fake FastifyInstance (a real
// Prisma-shaped `feedback` mock, not a real DB), matching this suite's
// established pattern (see adminUsersRouteParams.test.ts).

type CapturedRoute = { handler: (request: any, reply: any) => Promise<any> };

function buildFakeFastify() {
  const routes = new Map<string, CapturedRoute>();

  const capture =
    (method: string) =>
    (path: string, optsOrHandler: any, maybeHandler?: any) => {
      const handler = maybeHandler ?? optsOrHandler;

      routes.set(`${method} ${path}`, { handler });
    };

  const realFeedbackRow = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    accountId: null,
    type: "BUG_REPORT",
    status: "OPEN",
    priority: "MEDIUM",
    title: "Real feedback row",
    description: "A real row returned by the fake Prisma client.",
    stepsToReproduce: null,
    expectedBehavior: null,
    actualBehavior: null,
    pageUrl: null,
    userAgent: null,
    appVersion: null,
    attachments: [],
    adminNotes: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const prisma: any = {
    feedback: {
      findUnique: vi.fn().mockResolvedValue(realFeedbackRow),
    },
  };

  const fastify: any = {
    get: capture("GET"),
    post: capture("POST"),
    patch: capture("PATCH"),
    adminAuthGuard: async () => {},
    prisma,
    uow: { adminAuditLogRepository: { save: vi.fn() } },
  };

  return { fastify, routes, prisma, realFeedbackRow };
}

function fakeReply() {
  const reply: any = {};

  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);

  return reply;
}

describe("adminFeedbackRoutes — GET /:feedbackId auth-context regression (context.md, Screen 7 session)", () => {
  let ctx: ReturnType<typeof buildFakeFastify>;

  beforeEach(async () => {
    ctx = buildFakeFastify();
    await adminFeedbackRoutes(ctx.fastify);
  });

  it("succeeds when only request.admin is set (the real shape adminAuthGuard produces), not request.user", async () => {
    const { handler } = ctx.routes.get("GET /:feedbackId")!;
    const request: any = {
      params: { feedbackId: ctx.realFeedbackRow.id },
      admin: { id: "33333333-3333-4333-8333-333333333333", email: "admin@company.local", isSuperAdmin: true },
      // Deliberately no `request.user` -- the real shape for an
      // adminAuthGuard-gated request. The pre-fix code called
      // getUserContext(request), which throws when request.user is unset,
      // regardless of a perfectly valid request.admin.
    };
    const reply = fakeReply();

    await handler(request, reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: expect.objectContaining({ id: ctx.realFeedbackRow.id }) }),
    );
    expect(ctx.prisma.feedback.findUnique).toHaveBeenCalledWith({ where: { id: ctx.realFeedbackRow.id } });
  });

  it("still throws (as getAdminContext's own contract promises) when request.admin is genuinely absent", async () => {
    const { handler } = ctx.routes.get("GET /:feedbackId")!;
    const request: any = { params: { feedbackId: ctx.realFeedbackRow.id } };
    const reply = fakeReply();

    await expect(handler(request, reply)).rejects.toThrow("Not authenticated as admin");
  });
});
