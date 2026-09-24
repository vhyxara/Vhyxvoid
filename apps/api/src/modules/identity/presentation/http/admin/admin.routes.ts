// identity/presentation/routes/admin/adminRoutes.ts

import { FastifyInstance } from "fastify";
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
} from "@/modules/identity/application/dto/admin.dto";
import { successResponse } from "@/core/utils/response.util";
import { NotFoundError, ValidationError } from "@/core/errors/error.format";

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

      return successResponse(reply, "Login successful", 200, result);
    },
  );

  /**
   * Admin Refresh Token
   * POST /admin/auth/refresh
   */
  fastify.post("/auth/refresh", async (request, reply) => {
    const input = refreshTokenSchema.parse(request.body);

    const useCase = fastify.adminRefreshTokenUseCase;
    const result = await useCase.execute(input.refreshToken);
    return successResponse(reply, "Token refreshed successfully", 200, result);
  });

  /**
   * Admin Logout
   * POST /admin/auth/logout
   */
  fastify.post(
    "/auth/logout",
    { onRequest: [fastify.adminAuthGuard] },
    async (request, reply) => {
      const input = logoutSchema.parse(request.body);
      const admin = getAdminContext(request);

      // Revoke session
      const tokenHash = TokenHasher.hash(input.refreshToken);
      const session =
        await fastify.uow.adminSessionRepository.findByTokenHash(tokenHash);

      if (session && session.adminId === admin.id) {
        await fastify.uow.adminSessionRepository.revokeById(session.id);
      }

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
        status: admin.status,
        lastLoginAt: admin.lastLoginAt,
        // createdAt: admin.,
        // roles: roles.map((r) => ({ id: r.id, name: r.name })),
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

      let logs: any[];

      if (query.adminId) {
        logs = await fastify.uow.adminAuditLogRepository.findByAdminId(
          query.adminId,
          query.limit,
          query.offset,
        );
      } else if (query.action) {
        logs = await fastify.uow.adminAuditLogRepository.findByAction(
          query.action,
          query.limit,
          query.offset,
        );
      } else if (query.targetId) {
        logs = await fastify.uow.adminAuditLogRepository.findByTargetId(
          query.targetId,
          query.limit,
          query.offset,
        );
      } else {
        logs = await fastify.uow.adminAuditLogRepository.findAll(
          query.limit,
          query.offset,
        );
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
      return successResponse(
        reply,
        "Audit logs retrieved successfully",
        200,
        result,
      );
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
