import { describe, it, expect, vi } from "vitest";
import { LoginUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/Login.usecase";
import { RegisterUserUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/Register.usecase";
import { ResetPasswordUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/ResetPassword.usecase";
import { User } from "../../apps/api/src/modules/identity/domain/entities/user/User.entities";

// Found by the 2026-09-25 end-to-end run (code-archive CA-0030). Login never
// checked isEmailVerified, and re-registering an unverified address kept the
// FIRST registrant's password and re-sent a verification link. An attacker
// could register a victim's address, and once the victim signed up and
// clicked the link, the verified account opened with the attacker's password.

function unverifiedUser(passwordHash = "attacker-hash") {
  return User.rehydrate({
    id: "u1", email: "victim@example.com", passwordHash, firstName: "Vic", lastName: "Tim",
    isEmailVerified: false, status: true, failedLoginAttempts: 0, lockedUntil: null,
    lastLoginAt: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  } as any);
}

describe("login before email verification", () => {
  it("is refused with a 403, after the password check", async () => {
    const user = unverifiedUser();
    const uow = { userRepository: { findByEmail: async () => user, save: async () => {} }, execute: vi.fn() };
    const login = new LoginUseCase(uow as any, {} as any, {} as any, { compare: async () => true } as any, 900, 1000);
    const err = await login.execute("victim@example.com", "pw", "ip", "ua").catch((e) => e);
    expect(err?.statusCode).toBe(403);
    expect(uow.execute).not.toHaveBeenCalled(); // no session was created
  });

  it("a wrong password still answers 401 (the verified state is not revealed)", async () => {
    const user = unverifiedUser();
    const uow = { userRepository: { findByEmail: async () => user, save: async () => {} }, execute: vi.fn() };
    const login = new LoginUseCase(uow as any, {} as any, {} as any, { compare: async () => false } as any, 900, 1000);
    const err = await login.execute("victim@example.com", "pw", "ip", "ua").catch((e) => e);
    expect(err?.statusCode).toBe(401);
  });
});

describe("registering an address that has an unverified account", () => {
  it("keeps no new verification link and emails a set-your-password link instead", async () => {
    const user = unverifiedUser();
    const sentFinish = vi.fn(async () => {});
    const saved: any[] = [];
    const after: Array<() => void> = [];
    const uow = {
      execute: (fn: any) =>
        fn({
          userRepository: { findByEmail: async () => user, save: vi.fn() },
          emailTokenRepository: { deleteAllByUserId: vi.fn(), save: vi.fn() },
          passwordResetTokenRepository: { deleteAllByUserId: vi.fn(), save: async (t: any) => saved.push(t) },
          afterCommit: (f: () => void) => after.push(f),
        }),
    };
    const hasher = { hash: vi.fn(async () => "victim-hash") };
    const reg = new RegisterUserUseCase(uow as any, hasher as any, { generate: () => "raw-token" } as any, {
      sendFinishSignup: { execute: sentFinish },
      sendEmailVerification: { execute: vi.fn() },
    } as any);
    const res = await reg.execute({ email: "victim@example.com", password: "victim-pw", firstName: "Vic" });
    after.forEach((f) => f());
    expect(res).toEqual({ email: "victim@example.com", requiresVerification: true }); // same answer as a first sign-up
    expect(user.passwordHash).toBe("attacker-hash"); // untouched until the inbox owner sets one
    expect(saved).toHaveLength(1);
    expect(sentFinish).toHaveBeenCalledWith(expect.objectContaining({ to: "victim@example.com", rawToken: "raw-token" }));
  });

  it("the set-your-password link verifies the address and creates the personal workspace", async () => {
    const user = unverifiedUser();
    const accounts: any[] = [];
    const uow = {
      execute: (fn: any) =>
        fn({
          passwordResetTokenRepository: { findByHash: async () => ({ userId: "u1", ensureValid: () => {}, markUsed: () => {} }), save: async () => {} },
          userRepository: { findById: async () => user, save: async () => {} },
          sessionRepository: { revokeAllByUserId: async () => {} },
          auditLogRepository: { create: async () => {} },
          accountRepository: { findByUserId: async () => accounts, findBySlug: async () => null, save: async (a: any) => accounts.push(a) },
          roleRepository: { saveBatch: async () => {} },
          membershipRepository: { save: async () => {} },
          afterCommit: () => {},
        }),
    };
    await new ResetPasswordUseCase(uow as any, { hash: async () => "victim-hash" } as any).execute({ rawToken: "t", newPassword: "victim-pw" });
    expect(user.isEmailVerified).toBe(true);
    expect(user.passwordHash).toBe("victim-hash");
    expect(accounts).toHaveLength(1);
  });
});
