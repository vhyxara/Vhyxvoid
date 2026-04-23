// application/use-cases/AcceptInvitationUseCase.ts

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/core/errors/error.format";
import { AccountMembership } from "@/modules/identity/domain/entities/account/AccountMember";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { NotificationService } from "@/modules/notification/application/use-cases";
import { NotificationType } from "@/modules/notification/domain/enums";

export class AcceptInvitationUseCase {
  constructor(
    private uow: PrismaUnitOfWork,
    private notificationService: NotificationService, // ← add
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
