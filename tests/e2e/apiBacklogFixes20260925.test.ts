import { describe, it, expect, vi } from "vitest";
import {
  AdminListFeedbackUseCase,
  AdminUpdateFeedbackUseCase,
} from "../../apps/api/src/modules/feedback/application/use-cases";
import { Feedback } from "../../apps/api/src/modules/feedback/domain/entities/Feedback.entities";
import { adminFeedbackRoutes } from "../../apps/api/src/modules/feedback/presentation/http/feedback.routes";
import {
  AdminAuditLog,
  AuditAction,
} from "../../apps/api/src/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import { updateAdminSchema } from "../../apps/api/src/modules/identity/application/dto/admin.dto";
import { Account } from "../../apps/api/src/modules/identity/domain/entities/account/Account.entities";
import { AppError } from "../../apps/api/src/core/errors/app-error";

// api backlog items resolved 2026-09-25 (see code-archive/api/).

function feedbackRow() {
  return Feedback.create({
    userId: "u1",
    type: "BUG_REPORT" as any,
    title: "Broken thing",
    description: "It is broken, really broken.",
  });
}

describe("AdminUpdateFeedbackUseCase writes an AdminAuditLog row", () => {
  it("records feedback.updated with before/after triage fields and the acting admin", async () => {
    const fb = feedbackRow();
    const repo = { findById: vi.fn(async () => fb), save: vi.fn(async () => {}) } as any;
    const audit = { save: vi.fn(async (_: AdminAuditLog) => {}) };
    const useCase = new AdminUpdateFeedbackUseCase(repo, audit);

    await useCase.execute({
      feedbackId: fb.id,
      adminId: "admin_1",
      status: "UNDER_REVIEW" as any,
      adminNotes: "looking",
    });

    expect(audit.save).toHaveBeenCalledOnce();
    const log = audit.save.mock.calls[0][0].toPersistence();
    expect(log.action).toBe(AuditAction.FEEDBACK_UPDATED);
    expect(log.adminId).toBe("admin_1");
    expect(log.targetType).toBe("Feedback");
    expect(log.targetId).toBe(fb.id);
    expect(log.changes).toMatchObject({
      before: { status: "OPEN", adminNotes: null },
      after: { status: "UNDER_REVIEW", adminNotes: "looking" },
    });
  });

  it("labels feedback.updated and admin.token_refreshed in getActionDescription()", () => {
    for (const [action, label] of [
      ["feedback.updated", "Feedback triaged"],
      ["admin.token_refreshed", "Admin access token refreshed"],
    ]) {
      const log = AdminAuditLog.create({ adminId: "a", action, targetType: "X" });
      expect(log.getActionDescription()).toBe(label);
    }
  });
});

describe("AdminListFeedbackUseCase counts statuses with one grouped query", () => {
  it("calls findAll once and countByStatus once (was 5 findAll calls)", async () => {
    const repo = {
      findAll: vi.fn(async () => ({ items: [], total: 0 })),
      countByStatus: vi.fn(async () => ({ OPEN: 3, RESOLVED: 1 })),
    } as any;
    const result = await new AdminListFeedbackUseCase(repo).execute({});
    expect(repo.findAll).toHaveBeenCalledOnce();
    expect(repo.countByStatus).toHaveBeenCalledOnce();
    expect(result.counts).toEqual({ open: 3, underReview: 0, inProgress: 0, resolved: 1 });
  });
});

describe("PATCH /admin/feedback/:feedbackId empty payload", () => {
  it("throws the standard VALIDATION_ERROR (400) instead of a bare {error} body", async () => {
    const routes = new Map<string, any>();
    const capture = (m: string) => (p: string, a: any, b?: any) => routes.set(`${m} ${p}`, b ?? a);
    await adminFeedbackRoutes({
      get: capture("GET"),
      patch: capture("PATCH"),
      adminAuthGuard: async () => {},
      prisma: {},
      uow: { adminAuditLogRepository: { save: vi.fn() } },
    } as any);

    const err = await routes
      .get("PATCH /:feedbackId")(
        { params: { feedbackId: "11111111-1111-4111-8111-111111111111" }, body: {}, admin: { id: "a" } },
        {},
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
  });
});

describe("updateAdminSchema (PUT /admin/identity/users/:id)", () => {
  it("accepts a real name change", () => {
    expect(updateAdminSchema.parse({ firstName: " Ada ", lastName: "Lovelace" })).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it.each([
    ["blank first name", { firstName: "   " }],
    ["email (not editable here)", { firstName: "Ada", email: "x@y.z" }],
    ["password (not editable here)", { password: "hunter22" }],
    ["nothing to change", {}],
  ])("rejects %s instead of answering 200 with no change", (_l, body) => {
    expect(updateAdminSchema.safeParse(body).success).toBe(false);
  });
});

describe("Account domain errors", () => {
  it("renaming a personal account is a 403, not a 500", () => {
    const personal = Account.createPersonal("u1", "Ada");
    const err = (() => {
      try {
        personal.rename("New name", new Date());
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it("rejects an invalid slug at write time (audit M18)", () => {
    const org = Account.createOrganization({ name: "Acme", createdById: "u1" });
    expect(() => org.setSlug("-bad-", new Date())).toThrow(/Invalid account slug/);
    expect(() => Account.createOrganization({ name: "Acme", createdById: "u1", slug: "Has Spaces" })).toThrow(
      /Invalid account slug/,
    );
    expect(org.slug).toMatch(/^acme-[a-z0-9]{8}$/);
  });
});
