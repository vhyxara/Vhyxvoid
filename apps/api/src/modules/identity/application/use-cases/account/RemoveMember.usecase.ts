// application/use-cases/RemoveMemberUseCase.ts

import { ForbiddenError, NotFoundError } from "@/core/errors/error.format";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

/** Drops the given API keys' Redis cache entries (public keyIds). */
export type ApiKeyCacheInvalidator = (keyIds: string[]) => Promise<void>;

const NOOP_INVALIDATOR: ApiKeyCacheInvalidator = async () => {};

/**
 * Removes a member from an account (or lets a member leave).
 *
 * Removal also takes away the access the member still had through the
 * account (audit part2 G9): every ACTIVE API key they created in this
 * account is revoked, and every PENDING invitation they sent is cancelled,
 * in the same transaction as the membership delete. Before, only the
 * membership row went, so a removed member kept full tunnel access with the
 * keys they held. Revoking is the default because it is the only safe one
 * without new UI: reassigning a key to someone else would not cut access,
 * since the removed member still holds its secret. A later dashboard choice
 * could offer "rotate and transfer to me" instead. The hub's key sweep
 * (hub/context.md #62) then disconnects any agent still using those keys.
 */
export class RemoveMemberUseCase {
  constructor(
    private uow: PrismaUnitOfWork,
    private invalidateKeyCache: ApiKeyCacheInvalidator = NOOP_INVALIDATOR,
  ) {}

  async execute(params: {
    accountId: string;
    actorUserId: string;
    targetUserId: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.uow.execute(
      async ({
        membershipRepository,
        auditLogRepository,
        prisma,
        afterCommit,
      }) => {
        const actor = await membershipRepository.findByAccountAndUser(
          params.accountId,
          params.actorUserId,
        );

        const target = await membershipRepository.findByAccountAndUser(
          params.accountId,
          params.targetUserId,
        );

        if (!actor) throw new NotFoundError("Actor not member");
        if (!target) throw new NotFoundError("Target not member");

        const isSelfRemoval = params.actorUserId === params.targetUserId;

        /**
         * Revokes the target's active keys and cancels their pending
         * invitations in this account. Runs only after every permission
         * check has passed, right before the membership delete.
         */
        const revokeAccess = async () => {
          const now = new Date();
          const keys = await prisma.apiKey.findMany({
            where: {
              accountId: params.accountId,
              createdById: params.targetUserId,
              status: "ACTIVE",
            },
            select: { id: true, keyId: true },
          });
          if (keys.length > 0) {
            await prisma.apiKey.updateMany({
              where: { id: { in: keys.map((k) => k.id) }, status: "ACTIVE" },
              data: {
                status: "REVOKED",
                revokedAt: now,
                revokedById: params.actorUserId,
                updatedAt: now,
              },
            });
            for (const key of keys) {
              await auditLogRepository.create({
                accountId: params.accountId,
                userId: params.actorUserId,
                targetUserId: params.targetUserId,
                action: "API_KEY_REVOKED",
                resourceType: "ApiKey",
                resourceId: key.id,
                metadata: { keyId: key.keyId, reason: "member_removed" },
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
              });
            }
            const keyIds = keys.map((k) => k.keyId);
            afterCommit(() => this.invalidateKeyCache(keyIds));
          }

          const invitations = await prisma.accountInvitation.updateMany({
            where: {
              accountId: params.accountId,
              invitedById: params.targetUserId,
              status: "PENDING",
            },
            data: { status: "CANCELED", canceledAt: now },
          });

          return {
            revokedApiKeys: keys.length,
            canceledInvitations: invitations.count,
          };
        };

        // =========================
        // 🧍 SELF LEAVE
        // =========================
        if (isSelfRemoval) {
          if (target.isOwner()) {
            const ownerCount = await membershipRepository.countOwners(
              params.accountId,
            );

            if (ownerCount <= 1) {
              throw new ForbiddenError(
                "Cannot leave as last owner. Transfer ownership first.",
              );
            }
          }

          const revoked = await revokeAccess();
          await membershipRepository.delete(
            params.accountId,
            params.targetUserId,
          );

          await auditLogRepository.create({
            accountId: params.accountId,
            userId: params.actorUserId,
            targetUserId: params.targetUserId,
            action: "ACCOUNT_MEMBER_LEFT",
            resourceType: "AccountMembership",
            resourceId: params.targetUserId,
            metadata: revoked,
            ipAddress: params.ipAddress,
            userAgent: params.userAgent,
          });

          return { success: true, ...revoked };
        }

        // =========================
        // 👥 REMOVE OTHER USER
        // =========================

        // 1️⃣ Must be ADMIN or OWNER
        if (!actor.isAdmin())
          throw new ForbiddenError("Only admins and owners can remove members");

        // 2️⃣ Cannot remove equal or higher
        if (!actor.canManage(target)) {
          throw new ForbiddenError(
            "Cannot remove a member with equal or higher role than yours",
          );
        }

        // 3️⃣ Prevent removing last OWNER

        if (target.isOwner()) {
          const ownerCount = await membershipRepository.countOwners(
            params.accountId,
          );
          if (ownerCount <= 1)
            throw new ForbiddenError("Cannot remove the last owner");
        }

        const revoked = await revokeAccess();
        await membershipRepository.delete(
          params.accountId,
          params.targetUserId,
        );

        await auditLogRepository.create({
          accountId: params.accountId,
          userId: params.actorUserId,
          targetUserId: params.targetUserId, // FIX: now populated
          action: "ACCOUNT_MEMBER_REMOVED",
          resourceType: "AccountMembership",
          resourceId: params.targetUserId,
          metadata: { removedRoleLevel: target.roleLevel, ...revoked },
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });

        return {
          accountId: params.accountId,
          removedUserId: params.targetUserId,
          ...revoked,
        };
      },
    );
  }
}
