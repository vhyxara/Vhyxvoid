import { describe, it, expect, vi, afterEach } from "vitest";
import { inspect } from "node:util";
import { LoginUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/Login.usecase";
import { LogoutUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/Logout.usecase";
import { RequestPasswordResetUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/RequestPasswordReset.usecase";
import { PrismaAdminUserRepository } from "../../apps/api/src/modules/identity/infrastructure/prisma/admin/PrismaAdminRepositories";
import { TokenHasher } from "../../apps/api/src/modules/identity/infrastructure/crypto/TokenHasher";

// Covers api/decision.md, 2026-09-24, "Secrets removed from logs". Login
// used to console.log the submitted password, the user row (passwordHash),
// the raw refresh token and its hash, and the access token; Logout logged
// the refresh-token hash and session; RequestPasswordReset logged every raw
// reset token even after emailing it; the admin repository dumped admin rows
// with passwordHash. Each test runs the real code with fakes, captures every
// console call, and asserts none of the secret values appear anywhere in
// what was printed (deep-inspected, so nested objects count).

const METHODS = ["log", "info", "warn", "error", "debug", "trace", "dir"] as const;

function captureConsole() {
  const printed: string[] = [];
  for (const m of METHODS) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      printed.push(args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 6 }))).join(" "));
    });
  }
  return printed;
}

function expectNoneLeaked(printed: string[], secrets: string[]) {
  const all = printed.join("\n");
  for (const s of secrets) expect(all.includes(s), `leaked: ${s.slice(0, 12)}…`).toBe(false);
}

afterEach(() => vi.restoreAllMocks());

const PASSWORD = "Sup3r-Secret-Password!";
const PASSWORD_HASH = "$2b$12$passwordhashsentinelpasswordhashsentinel";
const REFRESH = "refresh-token-sentinel-0123456789abcdef";
const ACCESS = "access-token-sentinel.eyJzdWIiOiJ1In0.sig";

function fakeUser() {
  return {
    id: "user-1",
    email: "u@example.com",
    firstName: "U",
    lastName: "Ser",
    tokenVersion: 0,
    status: "ACTIVE",
    passwordHash: PASSWORD_HASH,
    isEmailVerified: true,
    ensureCanLogin: () => {},
    recordFailedLoginAttempt: () => {},
    resetLoginAttempts: () => {},
  };
}

describe("no secrets reach the logs", () => {
  it("login (success) prints neither the password, its hash, nor either token", async () => {
    const user = fakeUser();
    const sessionRepository = {
      countActiveByUserId: vi.fn(async () => 0),
      revokeOldestActiveSession: vi.fn(),
      save: vi.fn(),
    };
    const userRepository = { findByEmail: vi.fn(async () => user), save: vi.fn() };
    const uow = { userRepository, execute: (fn: any) => fn({ userRepository, sessionRepository }) };
    const useCase = new LoginUseCase(
      uow as any,
      { sign: () => ACCESS, verify: () => ({ sub: "user-1" }) } as any,
      { generate: () => REFRESH } as any,
      { compare: async () => true } as any,
      900,
      86_400_000,
    );
    const printed = captureConsole();

    const result = await useCase.execute(user.email, PASSWORD, "127.0.0.1", "vitest");

    expect(result.accessToken).toBe(ACCESS);
    expectNoneLeaked(printed, [PASSWORD, PASSWORD_HASH, REFRESH, ACCESS, TokenHasher.hash(REFRESH)]);
  });

  it("login (wrong password) prints neither the attempted password nor the stored hash", async () => {
    const user = fakeUser();
    const userRepository = { findByEmail: vi.fn(async () => user), save: vi.fn() };
    const useCase = new LoginUseCase(
      { userRepository } as any,
      {} as any,
      {} as any,
      { compare: async () => false } as any,
      900,
      86_400_000,
    );
    const printed = captureConsole();

    await expect(useCase.execute(user.email, PASSWORD, "127.0.0.1", "vitest")).rejects.toThrow();

    expectNoneLeaked(printed, [PASSWORD, PASSWORD_HASH]);
  });

  it("logout prints neither the refresh token nor its hash", async () => {
    const hash = TokenHasher.hash(REFRESH);
    const session = { tokenHash: hash, isRevoked: () => false, revoke: () => {} };
    const sessionRepository = { findByTokenHash: vi.fn(async () => session), save: vi.fn() };
    // userRepository: logout also bumps tokenVersion (audit H2).
    const userRepository = { findById: vi.fn(async () => ({ incrementTokenVersion: () => {} })), save: vi.fn() };
    const useCase = new LogoutUseCase({ execute: (fn: any) => fn({ sessionRepository, userRepository }) } as any);
    const printed = captureConsole();

    await useCase.execute(REFRESH);

    expect(sessionRepository.save).toHaveBeenCalled();
    expectNoneLeaked(printed, [REFRESH, hash]);
  });

  it("password reset with email configured does not print the reset token", async () => {
    const RESET = "reset-token-sentinel-fedcba9876543210";
    const user = fakeUser();
    const sent: string[] = [];
    const uow = {
      userRepository: { findByEmail: vi.fn(async () => user) },
      execute: (fn: any) =>
        fn({
          passwordResetTokenRepository: { deleteAllByUserId: vi.fn(), save: vi.fn() },
          auditLogRepository: { create: vi.fn() },
          afterCommit: (cb: () => unknown) => void cb(), // committed: runs straight away
        }),
    };
    const notifications = {
      sendPasswordReset: { execute: vi.fn(async (p: any) => void sent.push(p.rawToken)) },
    };
    const useCase = new RequestPasswordResetUseCase(uow as any, { generate: () => RESET } as any, notifications as any);
    const printed = captureConsole();

    await useCase.execute({ email: user.email });

    expect(sent).toEqual([RESET]); // the email path really ran
    expectNoneLeaked(printed, [RESET, TokenHasher.hash(RESET)]);
  });

  it("admin user listing does not print admin password hashes", async () => {
    const ADMIN_HASH = "$2b$12$adminhashsentineladminhashsentinel";
    const row = {
      id: "admin-1",
      email: "a@company.local",
      passwordHash: ADMIN_HASH,
      firstName: "A",
      lastName: "Dmin",
      isSuperAdmin: false,
      status: "ACTIVE",
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      lastLoginIp: null,
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      createdById: null,
    };
    const repo = new PrismaAdminUserRepository({ adminUser: { findMany: vi.fn(async () => [row]) } } as any);
    const printed = captureConsole();

    const admins = await repo.findAll();

    expect(admins).toHaveLength(1);
    expectNoneLeaked(printed, [ADMIN_HASH]);
  });
});
