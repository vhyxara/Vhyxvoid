// import { RoleLevel } from '@/generated/prisma/enums';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/core/errors/error.format";
import { RoleLevel } from "@/core/constant/account.constant";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { AccountInvitation } from "@/modules/identity/domain/entities/account/AccountInvitation";
import { NotificationService } from "@/modules/notification/application/use-cases";

export class InviteMemberUseCase {
  constructor(
    private uow: PrismaUnitOfWork,
    private tokenGenerator: CryptoTokenGenerator,
    private notificationService: NotificationService,
  ) {}

  async execute(params: {
    accountId: string;
    inviterId: string;
    email: string;
    roleLevel: RoleLevel;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.uow.execute(
      async ({
        membershipRepository,
        invitationRepository,
        roleRepository,
        auditLogRepository,
        accountRepository,
      }) => {
        // 1️⃣ Permission check
        const membership = await membershipRepository.findByAccountAndUser(
          params.accountId,
          params.inviterId,
        );

        if (!membership || !membership.isAdmin()) {
          throw new ForbiddenError("Only admins and owners can invite members");
        }

        // Cannot invite someone to a role equal or higher than yours (unless owner)
        if (
          membership.roleLevel !== RoleLevel.OWNER &&
          params.roleLevel >= membership.roleLevel
        ) {
          throw new ForbiddenError(
            "Cannot invite someone to a role equal or higher than your own",
          );
        }

        const account = await accountRepository.findById(params.accountId); // ← add this

        // 2️⃣ Prevent duplicate pending invite
        const existing = await invitationRepository.findPendingByEmail(
          params.accountId,
          params.email.toLowerCase(),
        );

        if (existing)
          throw new ConflictError(
            "A pending invitation already exists for this email",
          );

        const role = await roleRepository.findSystemRoleByLevel(
          params.accountId,
          params.roleLevel,
        );
        if (!role) throw new NotFoundError("Role not found for this account");

        // 3️⃣ Generate secure token
        const rawToken = this.tokenGenerator.generate(32);
        const tokenHash = TokenHasher.hash(rawToken);

        const invitation = AccountInvitation.create({
          accountId: params.accountId,
          email: params.email,
          role: role,
          invitedById: params.inviterId,
          ttlMs: 1000 * 60 * 60 * 24 * 3, // 3 days
          tokenHash,
        });

        await invitationRepository.save(invitation);
        if (this.notificationService) {
          Promise.all([
            this.uow.userRepository.findById(params.inviterId),
            this.uow.accountRepository.findById(params.accountId),
          ])
            .then(([inviter, account]) =>
              this.notificationService.sendInvitation.execute({
                to: params.email,
                inviterName:
                  inviter?.fullName ?? inviter?.email ?? "A team member",
                accountName: account?.name ?? "an organization",
                rawToken,
                roleLevel: params.roleLevel,
              }),
            )
            .catch((err) =>
              console.error("[notifications] invite email failed", err),
            );
        }
        // 4️⃣ Audit
        await auditLogRepository.create({
          accountId: params.accountId,
          userId: params.inviterId,
          action: "ACCOUNT_INVITATION_SENT",
          resourceType: "AccountInvitation",
          resourceId: invitation.id,
          metadata: {
            email: params.email,
            role: params.roleLevel,
          },
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });

        return {
          invitationId: invitation.id,
          inviteToken: rawToken, // send via email
        };
      },
    );
  }
}
