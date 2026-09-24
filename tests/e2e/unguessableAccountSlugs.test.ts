import { describe, it, expect, vi } from "vitest";
import { VerifyEmailUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/VerifyEmail.usecase";
import { CreateOrganizationUseCase } from "../../apps/api/src/modules/identity/application/use-cases/account/CreateOrganization.usecase";
import { slugify, isValidSlug } from "../../apps/api/src/core/utils/slug.util";

// Covers internal-tools/shared/audit-2026-09-24.md H11: an account's slug
// (its public tunnel host, <slug>--<label>.vhyxvoid.com) was derived purely
// from user input, with a random suffix only on collision, so the first
// "John" got johns-workspace--default.vhyxvoid.com and an org called "Acme"
// got acme--app.vhyxvoid.com: enumerable. Every generated slug now carries a
// non-guessable suffix, while keeping the readable prefix.

function accountRepo(taken: Set<string> = new Set()) {
  const saved: any[] = [];
  return {
    saved,
    findByUserId: vi.fn(async () => []),
    findBySlug: vi.fn(async (slug: string) => (taken.has(slug) ? { slug } : null)),
    save: vi.fn(async (a: any) => void saved.push(a)),
  };
}

async function verifyEmailSlug(firstName: string | undefined, taken?: Set<string>) {
  const accounts = accountRepo(taken);
  const uow = {
    execute: (fn: any) =>
      fn({
        emailTokenRepository: {
          findByHash: async () => ({ userId: "u1", ensureValid: () => {}, markUsed: () => {} }),
          save: async () => {},
        },
        userRepository: {
          findById: async () => ({ id: "u1", email: "u@example.com", firstName, verifyEmail: () => {} }),
          save: async () => {},
        },
        accountRepository: accounts,
        roleRepository: { saveBatch: async () => {} },
        membershipRepository: { save: async () => {} },
      }),
  };
  await new VerifyEmailUseCase(uow as any).execute("raw-token");
  return { slug: accounts.saved[0].slug as string, accounts };
}

async function createOrgSlug(name: string, taken?: Set<string>) {
  const accounts = accountRepo(taken);
  const uow = {
    execute: (fn: any) =>
      fn({
        accountRepository: accounts,
        membershipRepository: { findOwnerPersonalAccount: async () => "personal-1", save: async () => {} },
        roleRepository: { saveBatch: async () => {} },
        auditLogRepository: { create: async () => {} },
      }),
  };
  await new CreateOrganizationUseCase(uow as any).execute({ userId: "u1", name });
  return { slug: accounts.saved[0].slug as string, accounts };
}

describe("generated account slugs are not predictable from the name (H11)", () => {
  it("a personal account's slug is not derivable from the first name, even with no collision", async () => {
    const { slug } = await verifyEmailSlug("John");

    expect(slug).not.toBe("johns-workspace");
    expect(slug).not.toBe("john");
    expect(slug).toMatch(/^johns-workspace-[a-z0-9]{8}$/); // readable prefix kept
    expect(isValidSlug(slug)).toBe(true);
  });

  it("an organization's slug is not derivable from its name, even with no collision", async () => {
    const { slug } = await createOrgSlug("Acme Corp");

    expect(slug).not.toBe(slugify("Acme Corp"));
    expect(slug).toMatch(/^acme-corp-[a-z0-9]{8}$/);
    expect(isValidSlug(slug)).toBe(true);
  });

  it("two accounts with the same name get different, unrelated slugs", async () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 50; i++) slugs.add((await verifyEmailSlug("John")).slug);
    expect(slugs.size).toBe(50);
  });

  it("a taken slug is regenerated rather than falling back to a derivable one", async () => {
    const accounts = accountRepo();
    let calls = 0;
    accounts.findBySlug.mockImplementation(async (slug: string) => (calls++ === 0 ? { slug } : null)); // first candidate taken
    const uow = {
      execute: (fn: any) =>
        fn({
          emailTokenRepository: { findByHash: async () => ({ userId: "u1", ensureValid: () => {}, markUsed: () => {} }), save: async () => {} },
          userRepository: { findById: async () => ({ id: "u1", firstName: "John", verifyEmail: () => {} }), save: async () => {} },
          accountRepository: accounts,
          roleRepository: { saveBatch: async () => {} },
          membershipRepository: { save: async () => {} },
        }),
    };

    await new VerifyEmailUseCase(uow as any).execute("raw-token");

    const [taken, retried] = accounts.findBySlug.mock.calls.map((c) => c[0]);
    const saved = accounts.saved[0].slug;
    expect(saved).toBe(retried);
    expect(saved).not.toBe(taken);
    expect(saved).toMatch(/^johns-workspace-[a-z0-9]{8}$/); // not "john-xxxx", the old derivable fallback
  });

  it("a name with no ASCII letters still yields a valid slug with a random part (no leading hyphen)", async () => {
    const { slug } = await createOrgSlug("株式会社");
    expect(isValidSlug(slug)).toBe(true);
    expect(slug).toMatch(/^workspace-[a-z0-9]{8}$/);
  });
});
