import { ForbiddenError } from "@/core/errors/error.format";
import { slugify, slugifyWithSuffix } from "@/core/utils/slug.util";
import { Account } from "@/modules/identity/domain/entities/account/Account.entities";
import { AccountMembership } from "@/modules/identity/domain/entities/account/AccountMember.entities";
import { Role } from "@/modules/identity/domain/entities/account/Role.entities";
import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

export class CreateOrganizationUseCase {
  constructor(private uow: PrismaUnitOfWork) {}

  async execute(params: {
    userId: string;
    name: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.uow.execute(
      async ({
        accountRepository,
        membershipRepository,
        roleRepository,
        auditLogRepository,
      }) => {
        // Permission check — user must own a personal account
        const personalAccountId =
          await membershipRepository.findOwnerPersonalAccount(params.userId);

        if (!personalAccountId) {
          throw new ForbiddenError("User not allowed to create organization");
        }

        // Create org account with createdById
        const org = Account.createOrganization({
          name: params.name,
          createdById: params.userId,
        });

        // After building the account, before saving:
        const baseSlug = slugify(params.name);
        const existing = await accountRepository.findBySlug(baseSlug);
        const now = new Date();
        if (existing) {
          org.setSlug(slugifyWithSuffix(params.name), now);
        }

        await accountRepository.save(org);

        // Seed system roles for this org
        const systemRoles = Role.seedSystemRoles(org.id);
        await roleRepository.saveBatch(systemRoles);

        // Attach creator as OWNER using the seeded role
        const [ownerRole] = systemRoles;
        const ownerMembership = AccountMembership.createOwner(
          org.id,
          params.userId,
          ownerRole,
        );
        await membershipRepository.save(ownerMembership);

        // 4️⃣ Audit log
        await auditLogRepository.create({
          accountId: org.id,
          userId: params.userId,
          action: "ORGANIZATION_CREATED",
          resourceType: "Account",
          resourceId: org.id,
          metadata: { name: params.name },
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        });

        return { organizationId: org.id, name: params.name };
      },
    );
  }
}
