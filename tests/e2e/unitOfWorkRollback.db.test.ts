import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { PrismaClient } from "../../packages/shared/generated/prisma";
import { PrismaUnitOfWork } from "../../apps/api/src/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { PrismaEmailTokenRepository } from "../../apps/api/src/modules/identity/infrastructure/prisma/user/PrismaEmailTokenRepository";
import { PrismaAuditLogRepository } from "../../apps/api/src/modules/identity/infrastructure/prisma/user/PrismaAuditLogRepository";
import { PrismaSessionRepository } from "../../apps/api/src/modules/identity/infrastructure/prisma/user/PrismaSessionRepository";
import { RegisterUserUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/Register.usecase";
import { VerifyEmailUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/VerifyEmail.usecase";
import { LoginUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/Login.usecase";
import { CreateOrganizationUseCase } from "../../apps/api/src/modules/identity/application/use-cases/account/CreateOrganization.usecase";
import { AdminRefreshTokenUseCase } from "../../apps/api/src/modules/identity/application/use-cases/admin/AdminRefreshToken.usecase";
import { InviteMemberUseCase } from "../../apps/api/src/modules/identity/application/use-cases/account/InviteMember.usecase";
import { BcryptPasswordHasher } from "../../apps/api/src/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { CryptoTokenGenerator } from "../../apps/api/src/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "../../apps/api/src/modules/identity/infrastructure/crypto/TokenHasher";

// api/context.md #63, against a REAL Postgres: statements inside one
// PrismaUnitOfWork.execute() share one transaction, and a failure partway
// through a real multi-statement use case leaves nothing behind.
//
// Opt-in, because CI has no database. Point it at a disposable local
// database, never production:
//   VHYXVOID_TEST_DATABASE_URL=postgresql://…/Black-server pnpm test
// Every row it creates uses an email under @uow-rollback.test and is deleted
// in afterAll.

const url = process.env.VHYXVOID_TEST_DATABASE_URL;
const MARK = `uow-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const email = (tag: string) => `${MARK}-${tag}@uow-rollback.test`;

// bcrypt plus several round trips per test: 5 s is too tight under full-suite load.
describe.skipIf(!url)("PrismaUnitOfWork against a real database", { timeout: 30_000 }, () => {
  let prisma: PrismaClient;
  let uow: PrismaUnitOfWork;
  const hasher = new BcryptPasswordHasher();
  const tokens = new CryptoTokenGenerator();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    uow = new PrismaUnitOfWork(prisma);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: "@uow-rollback.test" } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    const accounts = await prisma.account.findMany({
      where: { createdById: { in: userIds } },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);
    await prisma.accountInvitation.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { accountId: { in: accountIds } }] },
    });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminUser.deleteMany({ where: { email: { endsWith: "@uow-rollback.test" } } });
    await prisma.$disconnect();
  });

  /** Registers and verifies a user through the real use cases; returns its id. */
  async function seedVerifiedUser(tag: string, password: string): Promise<string> {
    let rawToken = "";
    const notifications: any = {
      sendEmailVerification: { execute: async (p: { rawToken: string }) => void (rawToken = p.rawToken) },
    };
    await new RegisterUserUseCase(uow, hasher, tokens, notifications).execute({
      email: email(tag),
      password,
      firstName: "Rollback",
    });
    await vi.waitFor(() => expect(rawToken).not.toBe(""));
    await new VerifyEmailUseCase(uow).execute(rawToken);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email(tag) } });
    return user.id;
  }

  it("statements inside one execute() share a single transaction id", async () => {
    const ids = await uow.execute(async (tx) => {
      const a: any = await tx.prisma.$queryRaw`SELECT txid_current()::text AS id`;
      const b: any = await tx.prisma.$queryRaw`SELECT txid_current()::text AS id`;
      return [a[0].id, b[0].id];
    });
    expect(ids[0]).toBe(ids[1]);
  });

  it("register: a failure after the user row is written leaves no user", async () => {
    vi.spyOn(PrismaEmailTokenRepository.prototype, "save").mockRejectedValue(
      new Error("injected: verification token write failed"),
    );
    const notifications: any = { sendEmailVerification: { execute: vi.fn(async () => {}) } };

    await expect(
      new RegisterUserUseCase(uow, hasher, tokens, notifications).execute({
        email: email("register"),
        password: "Password123!",
      }),
    ).rejects.toThrow(/injected/);

    expect(await prisma.user.findUnique({ where: { email: email("register") } })).toBeNull();
    expect(notifications.sendEmailVerification.execute).not.toHaveBeenCalled();
  });

  it("create organization: a failure at the audit-log step leaves no account, roles or membership", async () => {
    const userId = await seedVerifiedUser("org", "Password123!");
    const orgName = `${MARK} Rollback Org`;
    vi.spyOn(PrismaAuditLogRepository.prototype, "create").mockRejectedValue(
      new Error("injected: audit log write failed"),
    );

    await expect(
      new CreateOrganizationUseCase(uow).execute({ userId, name: orgName }),
    ).rejects.toThrow(/injected/);

    const orgs = await prisma.account.findMany({ where: { name: orgName } });
    expect(orgs).toEqual([]);
    const orgMemberships = await prisma.accountMember.findMany({
      where: { userId, account: { type: "ORGANIZATION" } },
    });
    expect(orgMemberships).toEqual([]);
  });

  it("invite member: a failure after the invitation is saved leaves no invitation and sends no email", async () => {
    const userId = await seedVerifiedUser("inviter", "Password123!");
    const org = await new CreateOrganizationUseCase(uow).execute({ userId, name: `${MARK} Invite Org` });
    const sendInvitation = vi.fn(async () => {});
    const useCase = new InviteMemberUseCase(
      uow,
      tokens,
      { sendInvitation: { execute: sendInvitation } } as any,
      { canAddMember: async () => true, getLimits: async () => ({}) } as any,
    );
    vi.spyOn(PrismaAuditLogRepository.prototype, "create").mockRejectedValue(
      new Error("injected: audit log write failed"),
    );

    await expect(
      useCase.execute({
        accountId: org.organizationId,
        inviterId: userId,
        email: email("invitee"),
        roleLevel: 10, // RoleLevel.MEMBER
      } as any),
    ).rejects.toThrow(/injected/);

    await new Promise((r) => setTimeout(r, 50)); // any stray fire-and-forget send would have run
    expect(await prisma.accountInvitation.count({ where: { accountId: org.organizationId } })).toBe(0);
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it("login: a failure creating the session leaves the failed-attempt counter untouched", async () => {
    const userId = await seedVerifiedUser("login", "Password123!");
    await prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: 2 } });
    vi.spyOn(PrismaSessionRepository.prototype, "save").mockRejectedValue(
      new Error("injected: session write failed"),
    );
    const login = new LoginUseCase(uow, { sign: () => "jwt" } as any, tokens, hasher, 900, 86_400_000);

    await expect(login.execute(email("login"), "Password123!", "127.0.0.1", "vitest")).rejects.toThrow(
      /injected/,
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLoginAttempts).toBe(2);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  it("admin refresh: re-presenting a revoked token still revokes every session of that admin", async () => {
    const admin = await prisma.adminUser.create({
      data: { email: email("admin"), passwordHash: "x", firstName: "R", lastName: "B" },
    });
    const future = new Date(Date.now() + 86_400_000);
    const mk = (raw: string, revoked: boolean) =>
      prisma.adminSession.create({
        data: {
          adminId: admin.id,
          tokenHash: TokenHasher.hash(`${MARK}-${raw}`),
          expiresAt: future,
          revokedAt: revoked ? new Date() : null,
          ipAddress: "127.0.0.1",
          userAgent: "vitest",
        },
      });
    await mk("old", true);
    await mk("live-1", false);
    await mk("live-2", false);
    const useCase = new AdminRefreshTokenUseCase(uow, { sign: () => "jwt" } as any, tokens);

    await expect(useCase.execute(`${MARK}-old`)).rejects.toThrow(/reuse detected/);

    const live = await prisma.adminSession.count({ where: { adminId: admin.id, revokedAt: null } });
    expect(live).toBe(0);
  });
});
