import { describe, expect, it, vi } from "vitest";
import { LoginUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/Login.usecase";

// Audit 2026-09-24 M15: the failure counter was a read-modify-write of the
// entity, so N parallel guesses all read 0 and the lockout never triggered;
// unknown emails skipped bcrypt, so timing revealed which addresses exist.

const user = () => ({ id: "u1", email: "a@b.c", passwordHash: "h", isEmailVerified: true, ensureCanLogin: () => {}, recordFailedLoginAttempt: vi.fn() });

describe("login failures", () => {
  it("count with one atomic UPDATE, never an entity save", async () => {
    const executeRaw = vi.fn(async () => 1);
    const save = vi.fn();
    const uow = { userRepository: { findByEmail: async () => user(), save }, prisma: { $executeRaw: executeRaw }, execute: vi.fn() };
    const login = new LoginUseCase(uow as any, {} as any, {} as any, { compare: async () => false } as any, 900, 1000);

    await Promise.allSettled([1, 2, 3, 4, 5, 6].map(() => login.execute("a@b.c", "guess", "ip", "ua")));

    expect(executeRaw).toHaveBeenCalledTimes(6);
    expect(save).not.toHaveBeenCalled();
    const sql = (executeRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join("?");
    expect(sql).toMatch(/"failedLoginAttempts" = "failedLoginAttempts" \+ 1/);
  });

  it("an unknown email still runs a bcrypt comparison and answers the same error", async () => {
    const compare = vi.fn(async () => false);
    const uow = { userRepository: { findByEmail: async () => null }, prisma: { $executeRaw: vi.fn() }, execute: vi.fn() };
    const login = new LoginUseCase(uow as any, {} as any, {} as any, { compare } as any, 900, 1000);

    await expect(login.execute("nobody@b.c", "pw", "ip", "ua")).rejects.toThrow("Invalid credentials");
    expect(compare).toHaveBeenCalledTimes(1);
  });
});
