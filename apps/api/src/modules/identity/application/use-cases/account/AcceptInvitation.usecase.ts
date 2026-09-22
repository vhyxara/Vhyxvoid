// application/use-cases/AcceptInvitationUseCase.ts

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PlanLimitExceededError,
} from "@/core/errors/error.format";
import { AccountMembership } from "@/modules/identity/domain/entities/account/AccountMember.entities";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotificationService } from "@/modules/notification/application/use-cases";
import { NotificationType } from "@/modules/notification/domain/enums";
import { CheckPlanLimitsService } from "@/modules/billing/domain/services/CheckPlanLimits.service";

export class AcceptInvitationUseCase {
  constructor(
    private uow: PrismaUnitOfWork,
    private notificationService: NotificationService, // ← add
    private checkPlanLimitsService: CheckPlanLimitsService,
  ) {}

  async execute(params: {
    userId: string;
    userEmail: string;
    rawToken: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const now = new Date();

    const tokenHash = TokenHasher.hash(params.rawToken);

    return this.uow.execute(
      async ({
        invitationRepository,
        membershipRepository,
        roleRepository,
        auditLogRepository,
        userRepository,
        accountRepository,
      }) => {
        // 1️⃣ Find invitation by token hash
        const invitation =
          await invitationRepository.findByTokenHash(tokenHash);

        if (!invitation) {
          throw new NotFoundError("Invalid invitation token");
        }

        // 2️⃣ Validate invitation state
        invitation.ensureValid(now);

        // 3️⃣ Email must match
        if (invitation.email !== params.userEmail.toLowerCase().trim()) {
          throw new ForbiddenError("Invitation email does not match user");
        }

        // 4️⃣ Ensure not already member
        const existingMembership =
          await membershipRepository.findByAccountAndUser(
            invitation.accountId,
            params.userId,
          );

        if (existingMembership)
          throw new ConflictError("You are already a member of this account");

        // 4️⃣.5 Plan limit — the real backstop, not just InviteMember's
        // best-effort check at invite time. The account may have been
        // downgraded since the invitation was sent, or two invitations sent
        // while under the limit could both be accepted close enough
        // together that InviteMember's own check for the second one already
        // saw the first invitation as pending (correctly refusing it) --
        // but an invitation InviteMember already approved and sent stays
        // valid for 3 days, so this is the check that actually holds the
        // line at accept time, counting only current members (the person
        // accepting is about to become one; pending invitations don't
        // matter here, only whether there's room for one more real member
        // right now).
        const currentMemberCount = await membershipRepository.count(
          invitation.accountId,
        );
        const canAccept = await this.checkPlanLimitsService.canAddMember(
          invitation.accountId,
          currentMemberCount,
        );
        if (!canAccept) {
          const limits = await this.checkPlanLimitsService.getLimits(
            invitation.accountId,
          );
          throw new PlanLimitExceededError({
            limit: limits.maxMembers,
            current: currentMemberCount,
            limitKey: "maxMembers",
            plan: limits.plan,
          });
        }

        // Look up the Role entity so membership is created with proper roleId
        const role = await roleRepository.findById(invitation.roleId);
        if (!role) throw new NotFoundError("Role no longer exists");

        // 5️⃣ Create membership with pre-assigned role
        const membership = AccountMembership.create({
          accountId: invitation.accountId,
          userId: params.userId,
          role: role,
        });

        await membershipRepository.save(membership);

        // 6️⃣ Mark invitation accepted
        invitation.markAccepted(now);
        await invitationRepository.save(invitation);

        // After membership is saved, notify owner:
        const owner = await membershipRepository.findOwnerPersonalAccount(
          invitation.invitedById,
        );
        const ownerUser = owner ? await userRepository.findById(owner) : null;
        const account = await accountRepository.findById(invitation.accountId);
        const newMember = await userRepository.findByEmail(invitation.email);

        if (ownerUser && this.notificationService) {
          this.notificationService.createInApp
            .execute({
              userId: invitation.invitedById,
              accountId: invitation.accountId,
              type: NotificationType.MEMBER_JOINED,
              title: "New member joined",
              body: `${newMember?.firstName ?? invitation.email} accepted your invitation to ${account?.name}`,
              actionUrl: `/accounts/${invitation.accountId}/members`,
            })
            .catch((err) =>
              console.error("[notifications] member joined in-app failed", err),
            );
        }
        // 7️⃣ Audit log
        await auditLogRepository.create({
          accountId: invitation.accountId,
          userId: params.userId,
          targetUserId: params.userId, // FIX: targetUserId now populated
          action: "ACCOUNT_INVITATION_ACCEPTED",
          resourceType: "AccountInvitation",
          resourceId: invitation.id,
          metadata: { roleLevel: invitation.roleLevel },
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });

        return {
          accountId: invitation.accountId,
          roleLevel: invitation.roleLevel,
        };
      },
    );
  }
}
