import { describe, it, expect, vi, beforeEach } from "vitest";

import { adminRoutes } from "../../apps/api/src/modules/identity/presentation/http/admin/admin.routes";

// Regression test for a real bug found and fixed while building apps/admin's
// Admin Users screen (internal-tools/admin-frontend/decision.md, 2026-09-17
// -- "Screen 3"): GET /admin/identity/users/:id and POST
// /admin/identity/users/:id/disable both destructured `adminId` from
// `request.params`, but the route itself is registered with a `:id`
// placeholder -- Fastify populates `request.params.id`, never
// `request.params.adminId`, so both handlers always called
// `adminUserRepository.findById(undefined)`. GET threw a raw
// PrismaClientValidationError (500); disable threw NotFoundError ("Admin
// not found", 404) regardless of a valid target. Confirmed via real curl
// against the live local dev backend before fixing (see
// internal-tools/api/decision.md).
//
// admin.routes.ts's handlers aren't exported standalone -- they're defined
// inline inside the `adminRoutes(fastify)` plugin function. Registers the
// real plugin against a minimal fake FastifyInstance (capturing each
// route's handler by method+path, matching this suite's established
// pattern for testing route/plugin logic directly -- see
// corePluginDecorators.test.ts/userAuthGuard.test.ts), then invokes the
// captured handlers directly with a real `request.params = { id: ... }`
// shape (never `adminId`), asserting the repository methods receive the
// real id, not undefined.

type CapturedRoute = { handler: (request: any, reply: any) => Promise<any> };

function buildFakeFastify() {
  const routes = new Map<string, CapturedRoute>();

  const capture =
    (method: string) =>
    (path: string, optsOrHandler: any, maybeHandler?: any) => {
      const handler = maybeHandler ?? optsOrHandler;

      routes.set(`${method} ${path}`, { handler });
    };

  const adminUserRepository = {
    findById: vi.fn(),
    findAll: vi.fn(),
    save: vi.fn(),
  };
  const adminRoleRepository = {
    findByAdminId: vi.fn().mockResolvedValue([]),
    findAll: vi.fn(),
    findById: vi.fn(),
    save: vi.fn(),
  };
  const adminAuditLogRepository = {
    save: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn(),
    findByAdminId: vi.fn(),
    findByAction: vi.fn(),
    findByTargetId: vi.fn(),
  };
  const adminAbilityRepository = { findAll: vi.fn(), findById: vi.fn(), findByRoleId: vi.fn() };

  const fastify: any = {
    get: capture("GET"),
    post: capture("POST"),
    put: capture("PUT"),
    delete: capture("DELETE"),
    requireAbility: () => async () => {},
    adminAuthGuard: async () => {},
    uow: { adminUserRepository, adminRoleRepository, adminAuditLogRepository, adminAbilityRepository },
    // Every use-case decorator admin.routes.ts's handlers might touch for
    // the two routes under test -- not exercised by GET/disable, present
    // only so `adminRoutes()` itself doesn't throw while registering.
    adminLoginUseCase: {},
    adminRefreshTokenUseCase: {},
    createAdminUseCase: {},
    assignRoleToAdminUseCase: {},
    revokeRoleFromAdminUseCase: {},
    createRoleUseCase: {},
    verifyAdminAbilityUseCase: {},
    getAdminAbilitiesUseCase: {},
    assignAbilityToRoleUseCase: {},
    revokeAbilityFromRoleUseCase: {},
    createAbilityUseCase: {},
  };

  return { fastify, routes, adminUserRepository, adminRoleRepository, adminAuditLogRepository };
}

function fakeReply() {
  const reply: any = {};

  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);

  return reply;
}

describe("admin.routes.ts — GET/POST .../users/:id route-param regression (context.md, Screen 3 session)", () => {
  let ctx: ReturnType<typeof buildFakeFastify>;

  beforeEach(async () => {
    ctx = buildFakeFastify();
    await adminRoutes(ctx.fastify);
  });

  it("GET /users/:id reads request.params.id, not request.params.adminId", async () => {
    const realAdmin = {
      id: "real-admin-id",
      email: "test@company.local",
      firstName: "Test",
      lastName: "Admin",
      fullName: "Test Admin",
      isSuperAdmin: false,
      status: true,
      lastLoginAt: null,
    };

    ctx.adminUserRepository.findById.mockResolvedValue(realAdmin);

    const { handler } = ctx.routes.get("GET /users/:id")!;
    const request: any = { params: { id: "real-admin-id" } }; // the real shape Fastify produces for a `:id` route
    const reply = fakeReply();

    await handler(request, reply);

    // The actual regression: before the fix, this received `undefined`
    // (destructured from a non-existent `request.params.adminId`).
    expect(ctx.adminUserRepository.findById).toHaveBeenCalledWith("real-admin-id");
    expect(ctx.adminUserRepository.findById).not.toHaveBeenCalledWith(undefined);
  });

  it("POST /users/:id/disable reads request.params.id, not request.params.adminId", async () => {
    const targetAdmin = {
      id: "real-admin-id",
      isSuperAdmin: false,
      toPersistence: () => ({}),
      disable: vi.fn(),
    };

    ctx.adminUserRepository.findById.mockResolvedValue(targetAdmin);
    ctx.adminUserRepository.save.mockResolvedValue(undefined);

    const { handler } = ctx.routes.get("POST /users/:id/disable")!;
    const request: any = {
      params: { id: "real-admin-id" },
      admin: { id: "caller-id", email: "caller@company.local", isSuperAdmin: true },
      ip: "127.0.0.1",
      headers: {},
    };
    const reply = fakeReply();

    await handler(request, reply);

    expect(ctx.adminUserRepository.findById).toHaveBeenCalledWith("real-admin-id");
    expect(ctx.adminUserRepository.findById).not.toHaveBeenCalledWith(undefined);
    expect(targetAdmin.disable).toHaveBeenCalledTimes(1);
  });
});
