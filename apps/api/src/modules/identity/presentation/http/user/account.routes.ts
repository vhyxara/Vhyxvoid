import { FastifyInstance } from "fastify";
import { z } from "zod";
import { roleLevelName } from "@/core/utils/helper.util";
import { getUserContext } from "@/modules/identity/infrastructure/middleware/UserRoute.middleware";
import {
  createOrganizationSchema,
  inviteMemberSchema,
  accountIdParamSchema,
  acceptInvitationSchema,
  changeMemberRoleSchema,
  memberParamSchema,
  transferOwnershipSchema,
  getMembersQuerySchema,
  updateProfileSchema,
  renameOrganizationSchema,
  listInvitationsQuerySchema,
  invitationParamSchema,
} from "@/modules/identity/application/dto/account.dto";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { successResponse, tableResponse } from "@/core/utils/response.util";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/core/errors/error.format";

export async function accountRoutes(fastify: FastifyInstance) {
  // ══════════════════════════════════════════════════════════
  // ORGANIZATIONS
  // ══════════════════════════════════════════════════════════

  /**
   * Create Organization
   * POST /accounts/organizations
   * Auth: User JWT required
   *
   * Creates a new org account, seeds 3 system roles (OWNER/ADMIN/MEMBER),
   * and attaches the creator as OWNER — all in one transaction.
   */
  fastify.post(
    "/organizations",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      // const data = validate<CreateOrganizationInput>(
      //   createOrganizationSchema,
      //   request.body,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails
      const input = createOrganizationSchema.parse(request.body);
      const user = getUserContext(request);

      const result = await fastify.createOrganizationUseCase.execute({
        userId: user.id,
        name: input.name,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });

      return successResponse(reply, "Organization created", 201, result);
    },
  );

  // ══════════════════════════════════════════════════════════
  // MEMBERS
  // ══════════════════════════════════════════════════════════

  /**
   * Invite Member
   * POST /accounts/organizations/:accountId/members/invite
   * Auth: User JWT required (must be ADMIN or OWNER of the account)
   *
   * roleLevel: 10 = MEMBER, 70 = ADMIN
   * Cannot invite to a role >= your own level (unless OWNER).
   * Returns inviteToken — send this via email to the invitee.
   */
  fastify.post(
    "/organizations/:accountId/members/invite",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountIdParamSchema.parse(request.params);
      const input = inviteMemberSchema.parse(request.body);
      const user = getUserContext(request);

      const result = await fastify.inviteMemberUseCase.execute({
        accountId,
        inviterId: user.id,
        email: input.email,
        roleLevel: input.roleLevel,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });

      return successResponse(reply, "Invitation sent", 201, result);
    },
  );

  /**
   * Accept Invitation
   * POST /accounts/invitations/accept
   * Auth: User JWT required (must be logged in as the invited email)
   *
   * Token comes from the inviteToken returned by the invite endpoint.
   * On success: user becomes a member of the account with the pre-assigned role.
   */
  fastify.post(
    "/invitations/accept",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const input = acceptInvitationSchema.parse(request.body);
      const user = getUserContext(request);

      const result = await fastify.acceptInvitationUseCase.execute({
        userId: user.id,
        userEmail: user.email,
        rawToken: input.token,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });

      return successResponse(reply, "Invitation accepted", 201, result);
    },
  );

  /**
   * Change Member Role
   * PATCH /accounts/organizations/:accountId/members/:userId/role
   * Auth: User JWT required (must be ADMIN or OWNER)
   *
   * newRoleLevel: 10 = MEMBER, 70 = ADMIN
   * Rules:
   *   - Cannot change role of someone with equal or higher level than yours
   *   - Cannot assign a role >= your own level
   *   - Cannot demote last OWNER
   */
  fastify.patch(
    "/organizations/:accountId/members/:userId/role",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      console.log("request.params", request.params);
      const { accountId, userId: targetUserId } = memberParamSchema.parse(
        request.params,
      );
      console.log("targetUserId", targetUserId);
      const input = changeMemberRoleSchema.parse(request.body);
      const user = getUserContext(request);
      console.log("user", user);
      const result = await fastify.changeMemberRoleUseCase.execute({
        accountId,
        actorUserId: user.id,
        targetUserId,
        newRoleLevel: input.newRoleLevel,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });

      return successResponse(reply, "Role changed", 200, result);
    },
  );

  /**
   * Remove Member (or Self-Leave)
   * DELETE /accounts/organizations/:accountId/members/:userId
   * Auth: User JWT required
   *
   * Self-leave: any member can remove themselves.
   *   - Last OWNER cannot leave without transferring ownership first.
   * Remove by admin: actor must be ADMIN or OWNER with higher role than target.
   *   - Cannot remove last OWNER.
   */
  fastify.delete<{ Params: z.infer<typeof memberParamSchema> }>(
    "/organizations/:accountId/members/:userId",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId, userId: targetUserId } = memberParamSchema.parse(
        request.params,
      );
      const user = getUserContext(request);

      await fastify.removeMemberUseCase.execute({
        accountId,
        actorUserId: user.id,
        targetUserId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });

      return successResponse(reply, "Member removed", 200);
    },
  );

  /**
   * Transfer Ownership
   * POST /accounts/organizations/:accountId/transfer-ownership
   * Auth: User JWT required (must be OWNER)
   *
   * Actor becomes ADMIN. Target becomes OWNER.
   * Cannot transfer to yourself.
   * Target must already be a member of the account.
   */
  fastify.post<{
    Params: z.infer<typeof accountIdParamSchema>;
  }>(
    "/organizations/:accountId/transfer-ownership",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      // const data = validate<TransferOwnershipInput>(
      //   transferOwnershipSchema,
      //   request.body,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails
      const { accountId } = accountIdParamSchema.parse(request.params);
      const input = transferOwnershipSchema.parse(request.body);
      const user = getUserContext(request);

      const result = await fastify.transferOwnershipUseCase.execute({
        accountId,
        actorUserId: user.id,
        targetUserId: input.targetUserId,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });

      return successResponse(reply, "Ownership transferred", 200, result);
    },
  );

  // ══════════════════════════════════════════════════════════
  // READ — Account & Member Info
  // ══════════════════════════════════════════════════════════

  /**
   * Get Account Members
   * GET /accounts/organizations/:accountId/members
   * Auth: User JWT required (must be a member of the account)
   */
  fastify.get<{
    Params: z.infer<typeof accountIdParamSchema>;
    Querystring: z.infer<typeof getMembersQuerySchema>;
  }>(
    "/organizations/:accountId/members",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      // const data = validate<AccountIdParam>(
      //   accountIdParamSchema,
      //   request.params,
      //   reply,
      // );
      // if (!data) return; // stops execution if validation fails
      const { accountId } = accountIdParamSchema.parse(request.params);
      const query = getMembersQuerySchema.parse(request.query);

      const user = getUserContext(request);

      console.log(
        "Fetching members for account ID:",
        accountId,
        "Requested by user ID:",
        user.id,
        "Email:",
        user.email,
      );

      const result = await fastify.getAccountMembersUseCase.execute({
        accountId,
        actorUserId: user.id,
        ...query,
      });

      return tableResponse(
        reply,
        {
          items: result.items,
          page: result.page,
          limit: result.limit,
          total: result.total,
          extra: { accountId },
        },
        "Members fetched",
      );
    },
  );

  /**
   * Get My Accounts
   * GET /accounts/me
   * Auth: User JWT required
   *
   * Returns all accounts the authenticated user is a member of.
   */
  // fastify.get(
  //   "/me",
  //   { onRequest: [fastify.userAuthGuard] },
  //   async (request, reply) => {
  //     const user = getUserContext(request);
  //     console.log("Authenticated user ID:", user.id); // Make sure this is consistent
  //     const uow = fastify.container.resolve(PrismaUnitOfWork);
  //     const memberships = await uow.membershipRepository.findAllByUser(user.id);
  //     console.log("Memberships for user:", memberships); // Check what memberships are returned
  //     return successResponse(reply, "Accounts fetched", 200, {
  //       accounts: memberships.map((m) => ({
  //         accountId: m.accountId,
  //         roleLevel: m.roleLevel,
  //         roleName: roleLevelName(m.roleLevel),
  //         joinedAt: m.createdAt,
  //       })),
  //     });
  //   },
  // );

  /**
   * GET /accounts/me
   * Returns the authenticated user's profile + all accounts they belong to.
   * This is the primary bootstrap call a dashboard makes on load.
   */
  fastify.get(
    "/me",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { id: userId } = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);
      // Fetch user + memberships in parallel
      const [user, memberships] = await Promise.all([
        uow.userRepository.findById(userId),
        uow.membershipRepository.findAllByUser(userId),
      ]);

      if (!user) {
        throw new NotFoundError("User not found");
      }

      // Enrich memberships with account data
      const accountIds = memberships.map((m) => m.accountId);
      const accounts =
        accountIds.length > 0
          ? await Promise.all(
              accountIds.map((id) => uow.accountRepository.findById(id)),
            )
          : [];

      const accountMap = new Map(
        accounts.filter(Boolean).map((a) => [a!.id, a!]),
      );

      const format = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        isEmailVerified: user.isEmailVerified,
        accounts: memberships.map((m) => {
          const account = accountMap.get(m.accountId);
          return {
            id: m.accountId,
            accountId: m.accountId,
            accountName: account?.name ?? null,
            accountType: account?.type ?? null,
            accountStatus: account?.status ?? null,
            roleLevel: m.roleLevel,
            roleName: roleLevelName(m.roleLevel),
            joinedAt: m.createdAt,
          };
        }),
      };
      return successResponse(reply, "Profile fetched", 200, format);
    },
  );

  /**
   * PATCH /accounts/me
   * Update the authenticated user's own profile (firstName, lastName).
   * Does not allow email change (security-sensitive, separate flow needed).
   */
  fastify.patch<{ Body: z.infer<typeof updateProfileSchema> }>(
    "/me",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { id: userId } = getUserContext(request);
      const input = updateProfileSchema.parse(request.body);
      const uow = fastify.container.resolve(PrismaUnitOfWork);
      // Nothing to update
      if (!input.firstName && !input.lastName) {
        throw new ValidationError(
          "Please provide at least one field to update",
        );
      }

      const user = await uow.userRepository.findById(userId);
      if (!user) throw new NotFoundError("User not found");

      user.updateProfile(
        { firstName: input.firstName, lastName: input.lastName },
        new Date(),
      );
      await uow.userRepository.save(user);

      return successResponse(reply, "Profile updated", 200, {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
      });
    },
  );

  /**
   * GET /accounts/organizations/:accountId
   * Returns organization details + the requesting user's role in it.
   * Used by the dashboard settings page header.
   */
  fastify.get<{ Params: z.infer<typeof accountIdParamSchema> }>(
    "/organizations/:accountId",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountIdParamSchema.parse(request.params);
      const { id: userId } = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);
      // Verify membership — must be a member to see account details
      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        userId,
      );
      if (!membership) {
        throw new ForbiddenError("You are not a member of this organization");
      }

      const account = await uow.accountRepository.findById(accountId);
      if (!account) throw new NotFoundError("Organization not found");
      // Member counts
      const allMembers =
        await uow.membershipRepository.findAllByAccount(accountId);
      const memberCount = allMembers.length;

      // API key count (active only) — direct prisma for count efficiency
      const activeKeyCount = await (fastify.prisma as any).apiKey.count({
        where: { accountId, status: "ACTIVE" },
      });

      return reply.send({
        id: account.id,
        name: account.name,
        type: account.type,
        status: account.status,
        createdAt: account.createdAt,
        // Viewer's role context
        viewer: {
          roleLevel: membership.roleLevel,
          roleName: roleLevelName(membership.roleLevel),
          isOwner: membership.isOwner(),
          isAdmin: membership.isAdmin(),
        },
        stats: {
          memberCount,
          activeApiKeys: activeKeyCount,
        },
      });
    },
  );

  /**
   * PATCH /accounts/organizations/:accountId
   * Rename the organization.
   * Requires ADMIN or OWNER.
   */
  fastify.patch<{
    Params: z.infer<typeof accountIdParamSchema>;
    Body: z.infer<typeof renameOrganizationSchema>;
  }>(
    "/organizations/:accountId",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountIdParamSchema.parse(request.params);
      const { name } = renameOrganizationSchema.parse(request.body);
      const { id: userId } = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);
      // Permission check — must be ADMIN or OWNER
      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        userId,
      );
      if (!membership || !membership.isAdmin()) {
        throw new ForbiddenError(
          "You must be an admin or the owner of this organization to rename it",
        );
      }

      const account = await uow.accountRepository.findById(accountId);
      if (!account) throw new NotFoundError("Organization not found");
      account.rename(name, new Date());
      await uow.accountRepository.save(account);

      // Audit log
      await uow.auditLogRepository.create({
        accountId,
        userId,
        action: "ORGANIZATION_RENAMED",
        resourceType: "Account",
        resourceId: accountId,
        metadata: { newName: name },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });

      return successResponse(reply, "Organization renamed", 200, {
        id: account.id,
        name: account.name,
      });
    },
  );

  /**
   * GET /organizations/:accountId/members/:userId
   * Single member detail — used for member profile drawer/modal in UI.
   * Auth: any member of the account.
   */
  fastify.get<{ Params: z.infer<typeof memberParamSchema> }>(
    "/organizations/:accountId/members/:userId",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId, userId: targetUserId } = memberParamSchema.parse(
        request.params,
      );
      const { id: viewerId } = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      // Gate: viewer must be a member
      const viewerMembership =
        await uow.membershipRepository.findByAccountAndUser(
          accountId,
          viewerId,
        );
      if (!viewerMembership) {
        throw new ForbiddenError("You are not a member of this organization");
      }

      // Fetch target membership
      const targetMembership =
        await uow.membershipRepository.findByAccountAndUser(
          accountId,
          targetUserId,
        );
      if (!targetMembership) {
        throw new NotFoundError("Member not found");
      }

      const targetUser = await uow.userRepository.findById(targetUserId);
      const formattedResult = {
        userId: targetMembership.userId,
        roleLevel: targetMembership.roleLevel,
        roleName: roleLevelName(targetMembership.roleLevel),
        joinedAt: targetMembership.createdAt,
        isYou: targetUserId === viewerId,
        canManage: viewerMembership.canManage(targetMembership),
        user: targetUser
          ? {
              email: targetUser.email,
              firstName: targetUser.firstName,
              lastName: targetUser.lastName,
              fullName: targetUser.fullName,
              isEmailVerified: targetUser.isEmailVerified,
            }
          : null,
      };
      return successResponse(reply, "Get account member", 200, formattedResult);
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // INVITATIONS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /organizations/:accountId/invitations
   * List pending invitations for the account.
   * Auth: ADMIN or OWNER only (members shouldn't see invitation list).
   *
   * Optional ?status= filter. Defaults to PENDING only.
   *
   * NOTE: This route requires invitationRepository.findByAccountId()
   * which doesn't exist yet in the base InvitationRepository interface.
   * See the "What to add" note at the bottom of this file.
   */
  fastify.get<{
    Params: z.infer<typeof accountIdParamSchema>;
    Querystring: z.infer<typeof listInvitationsQuerySchema>;
  }>(
    "/organizations/:accountId/invitations",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId } = accountIdParamSchema.parse(request.params);
      const query = listInvitationsQuerySchema.parse(request.query);
      const { id: userId } = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);

      // Gate: ADMIN+ only
      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        userId,
      );
      if (!membership || !membership.isAdmin()) {
        throw new ForbiddenError("Only admins and owners can view invitations");
      }

      // Status filter — default to PENDING
      const status = query.status ?? "PENDING";

      // Uses direct prisma for flexibility — invitationRepository doesn't have
      // a findByAccountId(status) method yet. Add it or use prisma directly.
      const rows = await (fastify.prisma as any).accountInvitation.findMany({
        where: { accountId, status },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      // Enrich with inviter user data
      const inviterIds = [
        ...new Set(rows.map((r: any) => r.invitedById)),
      ] as string[];
      const inviters = await Promise.all(
        inviterIds.map((uid: string) => uow.userRepository.findById(uid)),
      );
      const inviterMap = new Map(
        inviters.filter(Boolean).map((u) => [u!.id, u!]),
      );

      const invitations = rows.map((row: any) => {
        const inviter = inviterMap.get(row.invitedById);
        return {
          id: row.id,
          email: row.email,
          roleLevel: row.roleLevel,
          roleName: roleLevelName(row.roleLevel),
          status: row.status,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          invitedBy: inviter
            ? {
                userId: inviter.id,
                fullName: inviter.fullName,
                email: inviter.email,
              }
            : { userId: row.invitedById, fullName: null, email: null },
        };
      });

      return reply.send({
        accountId,
        status,
        totalCount: invitations.length,
        invitations,
      });
    },
  );

  /**
   * DELETE /organizations/:accountId/invitations/:invitationId
   * Cancel a pending invitation.
   * Auth: ADMIN+ only. Can cancel any pending invitation for the account.
   */
  fastify.delete<{ Params: z.infer<typeof invitationParamSchema> }>(
    "/organizations/:accountId/invitations/:invitationId",
    { onRequest: [fastify.userAuthGuard] },
    async (request, reply) => {
      const { accountId, invitationId } = invitationParamSchema.parse(
        request.params,
      );
      const { id: userId } = getUserContext(request);
      const uow = fastify.container.resolve(PrismaUnitOfWork);
      // Gate: ADMIN+ only
      const membership = await uow.membershipRepository.findByAccountAndUser(
        accountId,
        userId,
      );
      if (!membership || !membership.isAdmin()) {
        // return reply
        //   .code(403)
        //   .send({ error: "Only admins and owners can cancel invitations" });
        throw new ForbiddenError(
          "Only admins and owners can cancel invitations",
        );
      }

      // Find the invitation
      const invitation = await uow.invitationRepository.findById(invitationId);

      if (!invitation) {
        // return reply.code(404).send({ error: "Invitation not found" });
        throw new NotFoundError("Invitation not found");
      }

      // Must belong to this account
      if (invitation.accountId !== accountId) {
        // return reply.code(404).send({ error: "Invitation not found" });
        throw new NotFoundError("Invitation not found");
      }

      // Only PENDING invitations can be canceled
      if (invitation.status !== ("PENDING" as any)) {
        // return reply.code(409).send({
        //   error: `Cannot cancel an invitation with status: ${invitation.status}`,
        // });
        throw new ConflictError(
          `Cannot cancel an invitation with status: ${invitation.status}`,
        );
      }

      // Cancel it
      invitation.cancel(new Date());
      await uow.invitationRepository.save(invitation);

      // Audit log
      await uow.auditLogRepository.create({
        accountId,
        userId,
        action: "ACCOUNT_INVITATION_CANCELED",
        resourceType: "AccountInvitation",
        resourceId: invitationId,
        metadata: { email: invitation.email, roleLevel: invitation.roleLevel },
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown",
      });

      // return reply.code(204).send();
      return successResponse(reply, "Invitation canceled", 204);
    },
  );
}
