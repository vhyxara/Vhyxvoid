import { vi } from "vitest";
import { InviteMemberUseCase } from "../../apps/api/src/modules/identity/application/use-cases/account/InviteMember.usecase";
import { AcceptInvitationUseCase } from "../../apps/api/src/modules/identity/application/use-cases/account/AcceptInvitation.usecase";
import { CheckPlanLimitsService } from "../../apps/api/src/modules/billing/domain/services/CheckPlanLimits.service";
import { AccountMembership } from "../../apps/api/src/modules/identity/domain/entities/account/AccountMember.entities";
import { AccountInvitation } from "../../apps/api/src/modules/identity/domain/entities/account/AccountInvitation.entities";
import { Role } from "../../apps/api/src/modules/identity/domain/entities/account/Role.entities";
import { Account } from "../../apps/api/src/modules/identity/domain/entities/account/Account.entities";
import { CryptoTokenGenerator } from "../../apps/api/src/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "../../apps/api/src/modules/identity/infrastructure/crypto/TokenHasher";
import { RoleLevel, InvitationStatus } from "../../apps/api/src/core/constant/account.constant";

// Shared by inviteMemberPlanLimit.test.ts and acceptInvitationPlanLimit.test.ts.
//
// InviteMemberUseCase and AcceptInvitationUseCase both take a
// PrismaUnitOfWork (a concrete class, not an interface), whose execute()
// hands the callback a transactional PrismaUnitOfWork instance exposing
// membershipRepository/invitationRepository/roleRepository/
// auditLogRepository/accountRepository as properties. This fake matches that
// shape exactly (execute(fn) => fn(this)) without a real Prisma transaction,
// backed by real domain entities (Role, AccountMembership, AccountInvitation,
// Account) and simple in-memory arrays — only the storage is fake, the
// business logic (isAdmin(), ensureValid(), etc.) is the real code.
//
// CheckPlanLimitsService is real too, wired to a fake Prisma that understands
// account.findUnique / subscription.findFirst (what the canonical plan
// resolver needs) and accountMember.count (what MembershipRepository.count
// needs) — matching billingHarness.ts's approach of driving real production
// code over fake data rather than mocking the thing under test.

export const ACCOUNT_ID = "acct1";
export const OWNER_ID = "user_owner";
export const OWNER_EMAIL = "owner@example.com";

export interface FakeAccountRow {
  id: string;
  status: string;
  plan: string | null; // null = no subscription row (-> FREE)
}

function makeCheckPlanLimitsService(accounts: Map<string, FakeAccountRow>) {
  const prisma = {
    account: {
      findUnique: async ({ where }: any) => {
        const a = accounts.get(where.id);
        return a ? { status: a.status } : null;
      },
    },
    subscription: {
      findFirst: async ({ where }: any) => {
        const a = accounts.get(where.accountId);
        return a?.plan ? { plan: a.plan } : null;
      },
    },
  };
  return new CheckPlanLimitsService(prisma as any);
}

export function makeMemberHarness(opts: {
  accountStatus?: string;
  plan?: string | null; // null/undefined = FREE (no subscription)
  memberUserIds?: string[]; // in addition to the owner, who is always a member
} = {}) {
  const accounts = new Map<string, FakeAccountRow>([
    [ACCOUNT_ID, { id: ACCOUNT_ID, status: opts.accountStatus ?? "ACTIVE", plan: opts.plan ?? null }],
  ]);
  const checkPlanLimitsService = makeCheckPlanLimitsService(accounts);

  const ownerRole = Role.create({ accountId: ACCOUNT_ID, name: "Owner", level: RoleLevel.OWNER });
  const adminRole = Role.create({ accountId: ACCOUNT_ID, name: "Admin", level: RoleLevel.ADMIN });
  const memberRole = Role.create({ accountId: ACCOUNT_ID, name: "Member", level: RoleLevel.MEMBER });
  const roles = [ownerRole, adminRole, memberRole];

  const memberships: AccountMembership[] = [
    AccountMembership.create({ accountId: ACCOUNT_ID, userId: OWNER_ID, role: ownerRole }),
    ...(opts.memberUserIds ?? []).map((userId) =>
      AccountMembership.create({ accountId: ACCOUNT_ID, userId, role: memberRole }),
    ),
  ];
  const invitations: AccountInvitation[] = [];

  const membershipRepository = {
    save: async (m: AccountMembership) => {
      const i = memberships.findIndex((x) => x.userId === m.userId && x.accountId === m.accountId);
      if (i >= 0) memberships[i] = m;
      else memberships.push(m);
    },
    findByAccountAndUser: async (accountId: string, userId: string) =>
      memberships.find((m) => m.accountId === accountId && m.userId === userId) ?? null,
    findAllByAccount: async (accountId: string) => memberships.filter((m) => m.accountId === accountId),
    findAllByUser: async (userId: string) => memberships.filter((m) => m.userId === userId),
    findOwnerPersonalAccount: async () => null,
    countOwners: async (accountId: string) =>
      memberships.filter((m) => m.accountId === accountId && m.roleLevel === RoleLevel.OWNER).length,
    count: async (accountId: string) => memberships.filter((m) => m.accountId === accountId).length,
    delete: async (accountId: string, userId: string) => {
      const i = memberships.findIndex((m) => m.accountId === accountId && m.userId === userId);
      if (i >= 0) memberships.splice(i, 1);
    },
  };

  const invitationRepository = {
    save: async (inv: AccountInvitation) => {
      const i = invitations.findIndex((x) => x.id === inv.id);
      if (i >= 0) invitations[i] = inv;
      else invitations.push(inv);
    },
    findById: async (id: string) => invitations.find((i) => i.id === id) ?? null,
    findByTokenHash: async (tokenHash: string) =>
      invitations.find((i) => i.tokenHash === tokenHash) ?? null,
    findPendingByEmail: async (accountId: string, email: string) =>
      invitations.find(
        (i) => i.accountId === accountId && i.email === email && i.status === InvitationStatus.PENDING,
      ) ?? null,
    findByAccountId: async (accountId: string, options?: { status?: InvitationStatus }) =>
      invitations.filter(
        (i) => i.accountId === accountId && (!options?.status || i.status === options.status),
      ),
  };

  const roleRepository = {
    save: async () => {},
    saveBatch: async () => {},
    findById: async (id: string) => roles.find((r) => r.id === id) ?? null,
    findByAccountId: async (accountId: string) => roles.filter((r) => r.accountId === accountId),
    findSystemRoleByLevel: async (accountId: string, level: number) =>
      roles.find((r) => r.accountId === accountId && r.level === level) ?? null,
  };

  const auditLogRepository = { create: vi.fn(async () => {}) };

  const account = Account.rehydrate({
    id: ACCOUNT_ID,
    name: "Test Org",
    type: "ORGANIZATION" as any,
    status: (opts.accountStatus ?? "ACTIVE") as any,
    createdById: OWNER_ID,
    graceEndsAt: null,
    slug: "test-org",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
  const accountRepository = {
    save: async () => {},
    findById: async (id: string) => (id === ACCOUNT_ID ? account : null),
    findByUserId: async () => [account],
    findBySlug: async () => account,
  };

  const userRepository = {
    findById: async (id: string) => ({ id, email: id === OWNER_ID ? OWNER_EMAIL : `${id}@example.com`, fullName: null, firstName: null }),
    findByEmail: async (email: string) => ({ id: "user_" + email, email, fullName: null, firstName: null }),
  };

  const repos = {
    membershipRepository,
    invitationRepository,
    roleRepository,
    auditLogRepository,
    accountRepository,
    userRepository,
    // A committed transaction runs its after-commit callbacks straight away.
    afterCommit: (fn: () => unknown) => void fn(),
  };

  // Matches PrismaUnitOfWork's shape closely enough for these two use cases:
  // execute(fn) hands back an object with the same repo properties, plus the
  // top-level userRepository/accountRepository InviteMemberUseCase reads via
  // `this.uow.X` directly (see its notification block).
  const uow = {
    ...repos,
    execute: async (fn: (repos: typeof repos) => Promise<any>) => fn(repos),
  };

  const tokenGenerator = new CryptoTokenGenerator();
  const notificationService = {
    sendInvitation: { execute: vi.fn().mockResolvedValue(undefined) },
    createInApp: { execute: vi.fn().mockResolvedValue(undefined) },
  };

  const inviteMember = new InviteMemberUseCase(
    uow as any,
    tokenGenerator,
    notificationService as any,
    checkPlanLimitsService,
  );
  const acceptInvitation = new AcceptInvitationUseCase(
    uow as any,
    notificationService as any,
    checkPlanLimitsService,
  );

  async function invite(overrides: Partial<{ inviterId: string; email: string; roleLevel: RoleLevel }> = {}) {
    return inviteMember.execute({
      accountId: ACCOUNT_ID,
      inviterId: overrides.inviterId ?? OWNER_ID,
      email: overrides.email ?? "invitee@example.com",
      roleLevel: overrides.roleLevel ?? RoleLevel.MEMBER,
    });
  }

  /** Directly create + save a PENDING invitation, bypassing InviteMember's own guard (for setting up AcceptInvitation scenarios). */
  async function seedPendingInvitation(email: string, roleLevel: RoleLevel = RoleLevel.MEMBER) {
    const role = roles.find((r) => r.level === roleLevel)!;
    const tokenGen = new CryptoTokenGenerator();
    const rawToken = tokenGen.generate(32);
    const invitation = AccountInvitation.create({
      accountId: ACCOUNT_ID,
      email,
      role,
      invitedById: OWNER_ID,
      ttlMs: 1000 * 60 * 60 * 24 * 3,
      tokenHash: TokenHasher.hash(rawToken),
    });
    await invitationRepository.save(invitation);
    return { rawToken, invitation };
  }

  async function accept(rawToken: string, userId: string, userEmail: string) {
    return acceptInvitation.execute({ userId, userEmail, rawToken });
  }

  return {
    accounts,
    memberships,
    invitations,
    roles,
    invite,
    accept,
    seedPendingInvitation,
    memberCount: () => memberships.filter((m) => m.accountId === ACCOUNT_ID).length,
    auditLogRepository,
  };
}
