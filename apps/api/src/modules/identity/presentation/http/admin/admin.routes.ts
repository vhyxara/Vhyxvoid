// identity/presentation/routes/admin/adminRoutes.ts

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AdminTTL } from "@/core/constant/ttl.constant";
import { BcryptPasswordHasher } from "@/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { AUTH_RATE_LIMITS } from "@/core/constant/rateLimit.constant";

import {
  getAdminContext,
  getAuditMetadata,
} from "@/modules/identity/infrastructure/middleware/AdminRoute.middleware";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import {
  AdminAuditLog,
  AuditAction,
} from "@/modules/identity/domain/entities/admin/AdminAuditLog.entities";
import {
  adminLoginSchema,
  assignAbilitySchema,
  assignRoleSchema,
  auditLogsQuerySchema,
  createAbilitySchema,
  createAdminSchema,
  createRoleSchema,
  getRoleAbilitiesSchema,
  listAdminsSchema,
  logoutSchema,
  refreshTokenSchema,
  updateAdminSchema,
  updateRoleSchema,
  changeOwnPasswordSchema,
  setAdminPasswordSchema,
} from "@/modules/identity/application/dto/admin.dto";
import { successResponse } from "@/core/utils/response.util";
import { NotFoundError, UnauthorizedError, ValidationError } from "@/core/errors/error.format";

// ===== REFRESH TOKEN TRANSPORT =====
// The admin refresh token travels in an httpOnly cookie scoped to the admin
// auth routes, so script injected into the admin panel can't read a 30-day
// credential (audit M19; it used to live in sessionStorage). Clients that
// can't hold cookies (scripts) ask for it in the body with
// `x-admin-token-transport: body`.
const ADMIN_REFRESH_COOKIE = "vv_admin_rt";
const ADMIN_COOKIE_PATH = "/api/v1/admin/identity/auth";

function deliverAdminTokens<T extends { refreshToken: string }>(request: FastifyRequest, reply: FastifyReply, result: T) {
  reply.setCookie(ADMIN_REFRESH_COOKIE, result.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: ADMIN_COOKIE_PATH,
    maxAge: Math.floor(AdminTTL.ADMIN_REFRESH_TOKEN_TTL_MS / 1000),
  });
  if (request.headers["x-admin-token-transport"] === "body") return result;
  const { refreshToken: _omit, ...rest } = result;
  return rest;
}

function clearAdminCookie(reply: FastifyReply) {
  reply.clearCookie(ADMIN_REFRESH_COOKIE, { path: ADMIN_COOKIE_PATH });
}

// ===== SCHEMAS =====

// ===== ROUTES =====

export async function adminRoutes(fastify: FastifyInstance) {
  // ============== AUTH ==============

  /**
   * Admin Login
   * POST /admin/auth/login
   */
  fastify.post(
    "/auth/login",
    { config: { rateLimit: AUTH_RATE_LIMITS.adminLogin } },
    async (request, reply) => {
      const input = adminLoginSchema.parse(request.body);

      const useCase = fastify.adminLoginUseCase;
      const ipAddress = request.ip;
      const userAgent = request.headers["user-agent"] ?? "unknown";

      const result = await useCase.execute(
        input.email,
        input.password,
        ipAddress,
        userAgent,
      );

      return successResponse(reply, "Login successful", 200, deliverAdminTokens(request, reply, result));
    },
  );

  /**
   * Admin Refresh Token
   * POST /admin/auth/refresh
   */
  fastify.post("/auth/refresh", async (request, reply) => {
    const input = refreshTokenSchema.parse(request.body ?? {});
    const token = input.refreshToken ?? request.cookies?.[ADMIN_REFRESH_COOKIE];
    if (!token) throw new UnauthorizedError("No refresh token");

    const useCase = fastify.adminRefreshTokenUseCase;
    try {
      const result = await useCase.execute(token);
      return successResponse(reply, "Token refreshed successfully", 200, deliverAdminTokens(request, reply, result));
    } catch (err) {
      clearAdminCookie(reply);
      throw err;
    }
  });

  /**
   * Admin Logout
   * POST /admin/auth/logout
   */
  fastify.post(
    "/auth/logout",
    { onRequest: [fastify.adminAuthGuard] },
    async (request, reply) => {
      const input = logoutSchema.parse(request.body ?? {});
      const admin = getAdminContext(request);

      // Revoke the refresh session (body for scripts, cookie for browsers).
      const refreshToken = input.refreshToken ?? request.cookies?.[ADMIN_REFRESH_COOKIE];
      clearAdminCookie(reply);
      if (refreshToken) {
        const tokenHash = TokenHasher.hash(refreshToken);
        const session =
          await fastify.uow.adminSessionRepository.findByTokenHash(tokenHash);
        if (session && session.adminId === admin.id) {
          await fastify.uow.adminSessionRepository.revokeById(session.id);
        }
      }

      // And every access token this admin holds, at once.
      await fastify.uow.adminUserRepository.bumpTokenVersion(admin.id);
      await fastify.authStateCache.invalidateAdmin(admin.id);

      // Audit log
      const auditLog = AdminAuditLog.create({
        adminId: admin.id,
        action: "admin.logout",
        targetType: "AdminSession",
        metadata: getAuditMetadata(request, 204),
      });

      await fastify.uow.adminAuditLogRepository.save(auditLog);

      return successResponse(reply, "Logged out successfully", 204);
    },
  );

  // ============== PASSWORDS ==============

  /**
   * Change your own password. Signs out every other session of yours.
   * POST /admin/identity/me/password
   */
  fastify.post(
    "/me/password",
    { onRequest: [fastify.adminAuthGuard], config: { rateLimit: AUTH_RATE_LIMITS.adminLogin } },
    async (request, reply) => {
      const input = changeOwnPasswordSchema.parse(request.body);
      const admin = getAdminContext(request);
      const hasher = new BcryptPasswordHasher();
      const row = await fastify.prisma.adminUser.findUnique({ where: { id: admin.id }, select: { passwordHash: true } });
      if (!row || !(await hasher.compare(input.currentPassword, row.passwordHash))) {
        throw new ValidationError("Current password is incorrect");
      }
      if (input.currentPassword === input.newPassword) throw new ValidationError("Choose a password you haven't used here");
      await fastify.prisma.$transaction([
        fastify.prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash: await hasher.hash(input.newPassword), tokenVersion: { increment: 1 } } }),
        fastify.prisma.adminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await fastify.authStateCache.invalidateAdmin(admin.id);
      clearAdminCookie(reply);
      await fastify.uow.adminAuditLogRepository.save(
        AdminAuditLog.create({ adminId: admin.id, action: AuditAction.ADMIN_PASSWORD_CHANGED, targetType: "AdminUser", targetId: admin.id, metadata: getAuditMetadata(request, 200) }),
      );
      return successResponse(reply, "Password changed. Sign in again with your new password.", 200);
    },
  );

  /**
   * Set another admin's password (super admins only), e.g. a forgotten one.
   * Signs that admin out everywhere.
   * POST /admin/identity/users/:id/password
   */
  fastify.post<{ Params: { id: string } }>(
    "/users/:id/password",
    { onRequest: [fastify.adminAuthGuard, fastify.requireSuperAdmin] },
    async (request, reply) => {
      const { id } = request.params;
      const input = setAdminPasswordSchema.parse(request.body);
      const admin = getAdminContext(request);
      const target = await fastify.prisma.adminUser.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
      if (!target || target.deletedAt) throw new NotFoundError("Admin not found");
      const hasher = new BcryptPasswordHasher();
      await fastify.prisma.$transaction([
        fastify.prisma.adminUser.update({ where: { id }, data: { passwordHash: await hasher.hash(input.newPassword), tokenVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null } }),
        fastify.prisma.adminSession.updateMany({ where: { adminId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await fastify.authStateCache.invalidateAdmin(id);
      await fastify.uow.adminAuditLogRepository.save(
        AdminAuditLog.create({ adminId: admin.id, action: AuditAction.ADMIN_PASSWORD_CHANGED, targetType: "AdminUser", targetId: id, metadata: { ...getAuditMetadata(request, 200), reason: "set by super admin" } }),
      );
      return successResponse(reply, "Password set. The admin has been signed out everywhere.", 200);
    },
  );

  // ============== ADMIN USER MANAGEMENT ==============

  /**
   * Create new admin user
   * POST /admin/users
   * Required ability: admin.create
   */
  fastify.post(
    "/users",

    { onRequest: [fastify.requireAbility("admin.create")] },
    async (request, reply) => {
      console.log("Received request to create admin user");
      const input = createAdminSchema.parse(request.body);
      const admin = getAdminContext(request);

      const useCase = fastify.createAdminUseCase;
      const result = await useCase.execute(input, admin.id);

      return successResponse(
        reply,
        "Admin user created successfully",
        201,
        result,
      );
    },
  );

  /**
   * List all admins
   * GET /admin/users
   * Required ability: admin.read
   */
  fastify.get<{ Params: { id: string } }>(
    "/users",
    { onRequest: [fastify.requireAbility("admin.read")] },
    async (request, reply) => {
      // const data = validate<ListAdminsDTO>(
      //   listAdminsSchema,
      //   request.query,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails
      const data = listAdminsSchema.parse(request.query);
      const filters =
        data.status !== undefined
          ? { status: data.status === "true" }
          : undefined;
      const admins = await fastify.uow.adminUserRepository.findAll(filters);
      console.log("admins", admins);
      const formattedAdmins = admins.map((a) => ({
        id: a.id,
        email: a.email,
        firstName: a.firstName,
        lastName: a.lastName,
        fullName: a.fullName,
        isSuperAdmin: a.isSuperAdmin,
        status: a.status,
        lastLoginAt: a.lastLoginAt,
        // createdAt: a.createdAt,
      }));

      return successResponse(
        reply,
        "Admins fetched successfully",
        200,
        formattedAdmins,
      );
    },
  );

  /**
   * Get admin by ID
   * GET /admin/users/:id
   */
  fastify.get<{ Params: { id: string } }>(
    "/users/:id",
    { onRequest: [fastify.requireAbility("admin.read")] },
    async (request, reply) => {
      // Route param is :id, not :adminId -- the generic type + destructure
      // here previously said `adminId`, which read `request.params.adminId`
      // (always undefined; Fastify populates params by the route's actual
      // placeholder name) instead of `request.params.id`. Every call threw
      // a PrismaClientValidationError (findById(undefined)) as a 500, not
      // even a clean 404. See internal-tools/api/decision.md, 2026-09-17.
      const { id: adminId } = request.params;
      const admin = await fastify.uow.adminUserRepository.findById(adminId);
      if (!admin) {
        throw new NotFoundError("Admin not found");
      }

      // Get roles
      const roles =
        await fastify.uow.adminRoleRepository.findByAdminId(adminId);

      const formattedAdmin = {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        fullName: admin.fullName,
        isSuperAdmin: admin.isSuperAdmin,
        status: admin.status,
        lastLoginAt: admin.lastLoginAt,
        // createdAt: admin.,
        roles: roles.map((r) => ({ id: r.id, name: r.name })),
      };
      return successResponse(
        reply,
        "Admin fetched successfully",
        200,
        formattedAdmin,
      );
    },
  );

  /**
   * Update admin profile
   * PUT /admin/users/:id
   * Required ability: admin.update
   */
  fastify.put<{ Params: { id: string } }>(
    "/users/:id",
    { onRequest: [fastify.requireAbility("admin.update")] },
    async (request, reply) => {
      const { id } = request.params;
      const input = updateAdminSchema.parse(request.body);
      const admin = getAdminContext(request);

      const targetAdmin = await fastify.uow.adminUserRepository.findById(id);
      if (!targetAdmin) {
        throw new NotFoundError("Admin not found");
      }

      const before = targetAdmin.toPersistence();
      targetAdmin.updateProfile(
        input.firstName || "",
        input.lastName || "",
        new Date(),
      );
      await fastify.uow.adminUserRepository.save(targetAdmin);
      const after = targetAdmin.toPersistence();

      // Audit log
      const auditLog = AdminAuditLog.create({
        adminId: admin.id,
        action: "admin.updated",
        targetType: "AdminUser",
        targetId: id,
        changes: { before, after },
        metadata: getAuditMetadata(request, 200),
      });

      await fastify.uow.adminAuditLogRepository.save(auditLog);
      const formattedAdmin = {
        id: targetAdmin.id,
        email: targetAdmin.email,
        firstName: targetAdmin.firstName,
        lastName: targetAdmin.lastName,
        fullName: targetAdmin.fullName,
      };
      return successResponse(
        reply,
        "Admin profile updated successfully",
        200,
        formattedAdmin,
      );
    },
  );

  /**
   * Disable admin
   * POST /admin/users/:id/disable
   * Required ability: admin.disable
   */
  fastify.post<{ Params: { id: string } }>(
    "/users/:id/disable",
    { onRequest: [fastify.requireAbility("admin.disable")] },
    async (request, reply) => {
      // Same route-param mismatch as GET /users/:id, fixed the same way —
      // see the comment there and internal-tools/api/decision.md, 2026-09-17.
      const { id: adminId } = request.params;
      const admin = getAdminContext(request);

      const targetAdmin =
        await fastify.uow.adminUserRepository.findById(adminId);
      if (!targetAdmin) {
        throw new NotFoundError("Admin not found");
      }

      const before = targetAdmin.toPersistence();
      targetAdmin.disable(new Date());
      await fastify.uow.adminUserRepository.save(targetAdmin);
      // The target's access tokens are checked against this state on every
      // request (AuthStateCache); drop the cached copy so it applies now.
      await fastify.authStateCache.invalidateAdmin(targetAdmin.id);
      const after = targetAdmin.toPersistence();

      // Audit log
      const auditLog = AdminAuditLog.create({
        adminId: admin.id,
        action: "admin.disabled",
        targetType: "AdminUser",
        targetId: adminId,
        changes: { before, after },
      });

      await fastify.uow.adminAuditLogRepository.save(auditLog);

      return successResponse(reply, "Admin disabled successfully", 200);
    },
  );

  /**
   * Enable admin
   * POST /admin/users/:id/enable
   * Required ability: admin.enable
   */
  fastify.post<{ Params: { id: string } }>(
    "/users/:id/enable",
    { onRequest: [fastify.requireAbility("admin.enable")] },
    async (request, reply) => {
      const { id } = request.params;
      const admin = getAdminContext(request);

      const targetAdmin = await fastify.uow.adminUserRepository.findById(id);
      if (!targetAdmin) {
        throw new NotFoundError("Admin not found");
      }

      const before = targetAdmin.toPersistence();
      targetAdmin.enable(new Date());
      await fastify.uow.adminUserRepository.save(targetAdmin);
      // The target's access tokens are checked against this state on every
      // request (AuthStateCache); drop the cached copy so it applies now.
      await fastify.authStateCache.invalidateAdmin(targetAdmin.id);
      const after = targetAdmin.toPersistence();

      // Audit log
      const auditLog = AdminAuditLog.create({
        adminId: admin.id,
        action: "admin.enabled",
        targetType: "AdminUser",
        targetId: id,
        changes: { before, after },
      });

      await fastify.uow.adminAuditLogRepository.save(auditLog);

      return successResponse(reply, "Admin enabled successfully", 200);
    },
  );

  // ============== ROLE MANAGEMENT ==============

  /**
   * Create role
   * POST /admin/roles
   * Required ability: role.create
   */
  fastify.post(
    "/roles",
    { onRequest: [fastify.requireAbility("role.create")] },
    async (request, reply) => {
      const input = createRoleSchema.parse(request.body);
      const admin = getAdminContext(request);

      const useCase = fastify.createRoleUseCase;
      const result = await useCase.execute(input, admin.id);

      return successResponse(reply, "Role created successfully", 201, result);
    },
  );

  /**
   * Update role profile
   * PUT /admin/roles/:id
   * Required ability: role.update
   */
  fastify.put<{ Params: { id: string } }>(
    "/roles/:id",
    { onRequest: [fastify.requireAbility("role.update")] },
    async (request, reply) => {
      const { id } = request.params;
      const input = updateRoleSchema.parse(request.body);
      const admin = getAdminContext(request);

      const targetRole = await fastify.uow.adminRoleRepository.findById(id);
      if (!targetRole) {
        throw new NotFoundError("Role not found");
      }

      const before = targetRole.toPersistence();
      targetRole.update(input, new Date());
      await fastify.uow.adminRoleRepository.save(targetRole);
      const after = targetRole.toPersistence();

      // Audit log
      const auditLog = AdminAuditLog.create({
        adminId: admin.id,
        action: AuditAction.ROLE_UPDATED,
        targetType: "AdminRole",
        targetId: id,
        changes: { before, after },
        metadata: getAuditMetadata(request, 200),
      });

      await fastify.uow.adminAuditLogRepository.save(auditLog);

      return successResponse(reply, "Role updated successfully", 200, {
        id: targetRole.id,
        name: targetRole.name,
        description: targetRole.description,
        isSystem: targetRole.isSystem,
        isActive: targetRole.isActive,
      });
    },
  );
  /**
   * List all roles
   * GET /admin/roles
   */
  fastify.get(
    "/roles",
    { onRequest: [fastify.requireAbility("role.read")] },
    async (request, reply) => {
      // const data = validate<>(refreshTokenSchema, req.body, reply);
      // if (!data) return; // stops execution if validation fails

      const roles = await fastify.uow.adminRoleRepository.findAll({
        isActive: true,
      });

      return successResponse(
        reply,
        "Roles retrieved successfully",
        200,
        roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isSystem: r.isSystem,
          isActive: r.isActive,
        })),
      );
    },
  );

  /**
   * Get role by ID
   * GET /admin/roles/:id
   */
  fastify.get<{ Params: { id: string } }>(
    "/roles/:id",
    { onRequest: [fastify.requireAbility("role.read")] },
    async (request, reply) => {
      console.log("Received request to get role by ID");
      const { id } = request.params;
      console.log("Fetching role with ID:", id);
      const role = await fastify.uow.adminRoleRepository.findById(id);
      if (!role) {
        throw new NotFoundError("Role not found");
      }

      // Get roles
      // const roles = await fastify.uow.adminRoleRepository.findByAdminId(id);
      console.log("Fetched role:", role);
      return successResponse(reply, "Role retrieved successfully", 200, {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        isActive: role.isActive,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      });
    },
  );
  /**
   * Assign role to admin
   * POST /admin/users/:adminId/roles
   * Required ability: role.assign
   */
  fastify.post<{ Params: { adminId: string } }>(
    "/users/:adminId/roles",
    { onRequest: [fastify.requireAbility("role.assign")] },
    async (request, reply) => {
      // const data = validate<AssignRoleDTO>(
      //   assignRoleSchema,
      //   request.body,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails
      const data = assignRoleSchema.parse(request.body);
      const { adminId } = request.params;
      const { roleId, reason } = data;
      const admin = getAdminContext(request);

      const useCase = fastify.assignRoleToAdminUseCase;
      await useCase.execute(adminId, roleId, admin.id, reason);

      return successResponse(reply, "Role assigned successfully", 200);
    },
  );

  /**
   * Revoke role from admin
   * DELETE /admin/users/:adminId/roles/:roleId
   * Required ability: role.assign
   */
  fastify.delete<{ Params: { adminId: string; roleId: string } }>(
    "/users/:adminId/roles/:roleId",
    { onRequest: [fastify.requireAbility("role.assign")] },
    async (request, reply) => {
      const { adminId, roleId } = request.params;
      const admin = getAdminContext(request);

      const useCase = fastify.revokeRoleFromAdminUseCase;
      await useCase.execute(adminId, roleId, admin.id);

      return successResponse(reply, "Role revoked successfully", 200);
    },
  );

  // ============== ABILITY MANAGEMENT ==============

  /**
   * List all abilities
   * GET /admin/abilities
   * Required ability: ability.read
   */

  fastify.get(
    "/abilities",
    { onRequest: [fastify.requireAbility("ability.read")] },
    async (request, reply) => {
      const abilities = await fastify.uow.adminAbilityRepository.findAll({
        isActive: true,
      });

      const formattedAbilities = abilities.map((a) => ({
        id: a.id,
        action: a.action,
        category: a.category,
        description: a.description,
        isSystem: a.isSystem,
        isActive: a.isActive,
      }));

      return successResponse(
        reply,
        "Abilities retrieved successfully",
        200,
        formattedAbilities,
      );
    },
  );

  /**
   * Create ability
   * POST /admin/abilities
   * Required ability: ability.create
   */
  fastify.post(
    "/abilities",
    { onRequest: [fastify.requireAbility("ability.create")] },
    async (request, reply) => {
      // const data = validate<CreateAbilityDTO>(
      //   createAbilitySchema,
      //   request.body,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails
      const input = createAbilitySchema.parse(request.body);
      const admin = getAdminContext(request);

      const useCase = fastify.createAbilityUseCase;

      const result = await useCase.execute(
        {
          action: input.action,
          category: input.category,
          description: input.description,
        },
        admin.id,
      );

      return successResponse(
        reply,
        "Ability created successfully",
        201,
        result,
      );
    },
  );

  /**
   * Delete ability
   * DELETE /admin/abilities/:id
   * Required ability: ability.delete
   */
  fastify.delete<{ Params: { id: string } }>(
    "/abilities/:id",
    { onRequest: [fastify.requireAbility("ability.delete")] },
    async (request, reply) => {
      // const data = validate<CreateAbilityDTO>(
      //   createAbilitySchema,
      //   request.body,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails

      const { id } = request.params;
      const admin = getAdminContext(request);

      const ability = await fastify.uow.adminAbilityRepository.findById(id);

      if (!ability) {
        throw new NotFoundError("Ability not found");
      }

      if (!ability.canBeDeleted()) {
        throw new ValidationError("System abilities cannot be deleted");
      }

      await fastify.uow.adminAbilityRepository.delete(id);

      const auditLog = AdminAuditLog.create({
        adminId: admin.id,
        action: AuditAction.ABILITY_DELETED,
        targetType: "AdminAbility",
        targetId: id,
        metadata: getAuditMetadata(request, 204),
      });

      await fastify.uow.adminAuditLogRepository.save(auditLog);

      return successResponse(reply, "Ability deleted successfully", 204);
    },
  );

  /**
   * Assign ability to role
   * POST /admin/roles/:roleId/abilities
   * Required ability: role.update
   */
  fastify.post<{ Params: { roleId: string } }>(
    "/roles/:roleId/abilities",
    { onRequest: [fastify.requireAbility("role.update")] },
    async (request, reply) => {
      // const data = validate<AssignAbilityDTO>(
      //   assignAbilitySchema,
      //   request.body,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails
      const data = assignAbilitySchema.parse(request.body);
      const { roleId } = request.params;
      const { abilityId } = data;
      const admin = getAdminContext(request);

      const useCase = fastify.assignAbilityToRoleUseCase;

      await useCase.execute(roleId, abilityId, admin.id);

      return successResponse(
        reply,
        "Ability assigned to role successfully",
        204,
      );
    },
  );

  /**
   * Revoke ability from role
   * DELETE /admin/roles/:roleId/abilities/:abilityId
   * Required ability: role.update
   */
  fastify.delete<{ Params: { roleId: string; abilityId: string } }>(
    "/roles/:roleId/abilities/:abilityId",
    { onRequest: [fastify.requireAbility("role.update")] },
    async (request, reply) => {
      const { roleId, abilityId } = request.params;
      const admin = getAdminContext(request);

      const useCase = fastify.revokeAbilityFromRoleUseCase;

      await useCase.execute(roleId, abilityId, admin.id);

      return successResponse(
        reply,
        "Ability revoked from role successfully",
        204,
      );
    },
  );

  /**
   * Get role abilities
   * GET /admin/roles/:roleId/abilities
   * Required ability: role.read
   */
  fastify.get(
    "/roles/:roleId/abilities",
    { onRequest: [fastify.requireAbility("role.read")] },
    async (request, reply) => {
      // const data = validate<GetRoleAbilitiesDTO>(
      //   getRoleAbilitiesSchema,
      //   request.params,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails

      const data = getRoleAbilitiesSchema.parse(request.params);
      const { roleId } = data;

      const abilities =
        await fastify.uow.adminAbilityRepository.findByRoleId(roleId);

      const result = abilities.map((a) => ({
        id: a.id,
        action: a.action,
        category: a.category,
        description: a.description,
        isSystem: a.isSystem,
        isActive: a.isActive,
      }));
      return successResponse(
        reply,
        "Role abilities retrieved successfully",
        200,
        result,
      );
    },
  );

  // ============== AUDIT LOGS ==============

  /**
   * Get audit logs
   * GET /admin/audit-logs
   * Required ability: audit.read
   */
  fastify.get(
    "/audit-logs",
    { onRequest: [fastify.requireAbility("audit.read")] },
    async (request, reply) => {
      // const data = validate<AuditLogsQueryDTO>(
      //   auditLogsQuerySchema,
      //   request.query,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails
      const query = auditLogsQuerySchema.parse(request.query);

      const repo = fastify.uow.adminAuditLogRepository;
      let logs: any[];
      let total: number;

      if (query.adminId) {
        [logs, total] = await Promise.all([
          repo.findByAdminId(query.adminId, query.limit, query.offset),
          repo.countByAdminId(query.adminId),
        ]);
      } else if (query.action) {
        [logs, total] = await Promise.all([
          repo.findByAction(query.action, query.limit, query.offset),
          repo.countByAction(query.action),
        ]);
      } else if (query.targetId) {
        [logs, total] = await Promise.all([
          repo.findByTargetId(query.targetId, query.limit, query.offset),
          repo.countByTargetId(query.targetId),
        ]);
      } else {
        [logs, total] = await Promise.all([
          repo.findAll(query.limit, query.offset),
          repo.countAll(),
        ]);
      }

      const result = logs.map((log) => ({
        id: log.id,
        adminId: log.adminId,
        action: log.action,
        actionDescription: log.getActionDescription?.() || log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        changes: log.changes,
        metadata: log.metadata,
        createdAt: log.createdAt,
      }));
      // `data` stays the bare array existing clients read; the total for the
      // same filter rides alongside it.
      return reply.status(200).send({
        success: true,
        message: "Audit logs retrieved successfully",
        data: result,
        meta: { total, limit: query.limit, offset: query.offset },
      });
    },
  );

  /**
   * Get admin permissions
   * GET /admin/me/abilities
   */
  fastify.get(
    "/me/abilities",
    { onRequest: [fastify.adminAuthGuard] },
    async (request, reply) => {
      const admin = getAdminContext(request);

      const useCase = fastify.getAdminAbilitiesUseCase;
      const abilities = await useCase.execute(admin.id);

      return successResponse(
        reply,
        "Admin abilities retrieved successfully",
        200,
        abilities,
      );
    },
  );

  /**
   * Get current admin
   * GET /admin/me
   */
  fastify.get(
    "/me",
    { onRequest: [fastify.adminAuthGuard] },
    async (request, reply) => {
      const admin = getAdminContext(request);

      const adminUser = await fastify.uow.adminUserRepository.findById(
        admin.id,
      );
      if (!adminUser) {
        throw new NotFoundError("Admin not found");
      }

      return successResponse(reply, "Admin retrieved successfully", 200, {
        id: adminUser.id,
        email: adminUser.email,
        fullName: adminUser.fullName,
        isSuperAdmin: adminUser.isSuperAdmin,
        status: adminUser.status,
      });
    },
  );
}
