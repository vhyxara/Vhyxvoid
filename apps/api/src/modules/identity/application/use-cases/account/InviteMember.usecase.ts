// import { RoleLevel } from '@/generated/prisma/enums';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PlanLimitExceededError,
} from "@/core/errors/error.format";
import { RoleLevel, InvitationStatus } from "@/core/constant/account.constant";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { CryptoTokenGenerator } from "@/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "@/modules/identity/infrastructure/crypto/TokenHasher";
import { AccountInvitation } from "@/modules/identity/domain/entities/account/AccountInvitation.entities";
import { NotificationService } from "@/modules/notification/application/use-cases";
import { CheckPlanLimitsService } from "@/modules/billing/domain/services/CheckPlanLimits.service";

export class InviteMemberUseCase {
  constructor(
    private uow: PrismaUnitOfWork,
    private tokenGenerator: CryptoTokenGenerator,
    private notificationService: NotificationService,
    private checkPlanLimitsService: CheckPlanLimitsService,
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
        afterCommit,
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

        // 1️⃣.5 Plan limit — count existing members AND pending invitations,
        // not just members. Without counting pending invitations, an account
        // right at its limit could send several invitations before any of
        // them are accepted (each individual invite looks fine against the
        // current member count alone), and accepting all of them later would
        // overshoot the limit — AcceptInvitation's own guard (below) would
        // then have to reject a real, already-sent invitation instead of
        // this one being refused up front. maxMembers counts the owner too
        // (the owner is a real AccountMembership row, and the confirmed
        // product answer for FREE's maxMembers: 1 is "no invites at all" —
        // the owner alone already occupies the limit).
        // Sequential, not Promise.all: these run on one interactive
        // transaction's connection, where parallel queries gain nothing.
        const currentMemberCount = await membershipRepository.count(
          params.accountId,
        );
        const pendingInvitations = await invitationRepository.findByAccountId(
          params.accountId,
          { status: InvitationStatus.PENDING },
        );
        const projectedCount = currentMemberCount + pendingInvitations.length;
        const canInvite = await this.checkPlanLimitsService.canAddMember(
          params.accountId,
          projectedCount,
        );
        if (!canInvite) {
          const limits = await this.checkPlanLimitsService.getLimits(
            params.accountId,
          );
          throw new PlanLimitExceededError({
            limit: limits.maxMembers,
            current: projectedCount,
            limitKey: "maxMembers",
            plan: limits.plan,
          });
        }

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
          afterCommit(() =>
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
              )
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
