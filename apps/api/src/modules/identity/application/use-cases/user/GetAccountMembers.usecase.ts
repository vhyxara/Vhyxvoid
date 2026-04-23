import { PrismaUnitOfWork } from "@/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { ForbiddenError } from "@/core/errors/error.format";
import { RoleLevel } from "@/core/constant/account.constant";
import {
  GetAccountMembersParams,
  GetAccountMembersResult,
  AccountMemberDTO,
} from "@/core/types/identity.types";

const roleLevelName = (level: number): string => {
  if (level >= RoleLevel.OWNER) return "OWNER";
  if (level >= RoleLevel.ADMIN) return "ADMIN";
  return "MEMBER";
};

export class GetAccountMembersUseCase {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async execute(
    params: GetAccountMembersParams,
  ): Promise<GetAccountMembersResult> {
    const {
      accountId,
      actorUserId,
      page = 1,
      limit = 20,
      search,
      sortBy = "joinedAt",
      sortOrder = "desc",
    } = params;

    // 1. Permission check — must be a member
    const requesterMembership =
      await this.uow.membershipRepository.findByAccountAndUser(
        accountId,
        actorUserId,
      );
    if (!requesterMembership) {
      throw new ForbiddenError("You are not a member of this account");
    }

    // 2. Fetch all members for this account
    const memberships =
      await this.uow.membershipRepository.findAllByAccount(accountId);

    const enriched = await Promise.all(
      memberships.map(async (m) => {
        const [user, role] = await Promise.all([
          this.uow.userRepository.findById(m.userId),
          this.uow.roleRepository.findById(m.roleId),
        ]);

        return {
          id: m.userId,
          email: user?.email ?? "",
          firstName: user?.firstName ?? "",
          lastName: user?.lastName ?? "",
          fullName: `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim(),
          isEmailVerified: user?.isEmailVerified ?? false,
          role: {
            id: role?.id ?? m.roleId,
            name: role?.name ?? roleLevelName(m.roleLevel),
            level: m.roleLevel,
            levelName: roleLevelName(m.roleLevel),
            description: role?.description ?? null,
          },
          joinedAt: m.createdAt,
          isYou: m.userId === actorUserId,
          // Permission flags — what the viewer can do to this member
          canManage: requesterMembership.canManage(m),
          user: user
            ? {
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                fullName: user.fullName,
                isEmailVerified: user.isEmailVerified,
              }
            : null,
        } satisfies AccountMemberDTO;
      }),
    );

    // 4. Search across user fields
    const filtered = search
      ? enriched.filter((m) => {
          const q = search.toLowerCase();
          return (
            m.email.toLowerCase().includes(q) ||
            m.firstName.toLowerCase().includes(q) ||
            m.lastName.toLowerCase().includes(q) ||
            m.fullName.toLowerCase().includes(q) ||
            m.role.name.toLowerCase().includes(q) ||
            m.role.levelName.toLowerCase().includes(q)
          );
        })
      : enriched;

    // 5. Sort
    const sorted = [...filtered].sort((a, b) => {
      const dir = sortOrder === "asc" ? 1 : -1;
      switch (sortBy) {
        case "name":
          return dir * a.fullName.localeCompare(b.fullName);
        case "email":
          return dir * a.email.localeCompare(b.email);
        case "roleLevel":
          return dir * (a.role.level - b.role.level);
        case "joinedAt":
        default:
          return (
            dir *
            (new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime())
          );
      }
    });

    // 6. Paginate
    const total = sorted.length;
    const offset = (page - 1) * limit;
    const items = sorted.slice(offset, offset + limit);

    return {
      items,
      total,
      page,
      limit,
    };
  }
}
