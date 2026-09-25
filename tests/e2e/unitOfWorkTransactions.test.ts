import { describe, it, expect, vi } from "vitest";
import { PrismaUnitOfWork } from "../../apps/api/src/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { PrismaClient } from "../../packages/shared/generated/prisma";
import { AdminRefreshTokenUseCase } from "../../apps/api/src/modules/identity/application/use-cases/admin/AdminRefreshToken.usecase";
import { TokenHasher } from "../../apps/api/src/modules/identity/infrastructure/crypto/TokenHasher";

// api/context.md #63: PrismaUnitOfWork.execute() decided whether to open a
// transaction with `this.prisma instanceof PrismaClient`. Prisma 6's client
// constructor returns a proxy, so that was false even for the root client and
// execute() never opened one: every caller ran statement by statement.
// These tests need no database; the real-Postgres rollback tests are in
// unitOfWorkRollback.db.test.ts (opt-in).

function fakeClient() {
  const tx = { kind: "tx" };
  const client: any = {
    kind: "root",
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { client, tx };
}

describe("PrismaUnitOfWork.execute opens a real transaction", () => {
  it("the real generated client fails `instanceof PrismaClient` (the root cause)", () => {
    // Never connects: the client is lazy until the first query.
    const prisma = new PrismaClient({ datasourceUrl: "postgresql://u:p@127.0.0.1:1/none" });
    expect(prisma instanceof PrismaClient).toBe(false);
    expect(typeof (prisma as any).$transaction).toBe("function");
  });

  it("runs the callback inside $transaction, on a unit of work bound to the transaction client", async () => {
    const { client, tx } = fakeClient();
    const uow = new PrismaUnitOfWork(client);

    const seen = await uow.execute(async (inner) => inner.prisma);

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(seen).toBe(tx);
  });

  it("does not open a second transaction when nested inside one", async () => {
    const { client, tx } = fakeClient();
    const uow = new PrismaUnitOfWork(client);

    const seen = await uow.execute(async (outer) =>
      outer.execute(async (inner) => inner.prisma),
    );

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(seen).toBe(tx);
  });

  it("propagates a thrown error out of $transaction (which is what makes Prisma roll back)", async () => {
    const { client } = fakeClient();
    const uow = new PrismaUnitOfWork(client);

    await expect(
      uow.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("afterCommit: side effects wait for the commit", () => {
  it("runs queued callbacks only after the transaction commits", async () => {
    const { client } = fakeClient();
    const uow = new PrismaUnitOfWork(client);
    const events: string[] = [];

    await uow.execute(async ({ afterCommit }) => {
      afterCommit(() => events.push("email"));
      events.push("write");
    });

    expect(events).toEqual(["write", "email"]);
  });

  it("drops queued callbacks when the transaction rolls back", async () => {
    const { client } = fakeClient();
    const uow = new PrismaUnitOfWork(client);
    const sent = vi.fn();

    await expect(
      uow.execute(async ({ afterCommit }) => {
        afterCommit(sent);
        throw new Error("later step failed");
      }),
    ).rejects.toThrow("later step failed");

    expect(sent).not.toHaveBeenCalled();
  });

  it("a nested execute() queues onto the outer transaction", async () => {
    const { client } = fakeClient();
    const uow = new PrismaUnitOfWork(client);
    const events: string[] = [];

    await uow.execute(async (outer) => {
      await outer.execute(async ({ afterCommit }) => afterCommit(() => events.push("inner")));
      events.push("outer-done");
    });

    expect(events).toEqual(["outer-done", "inner"]);
  });

  it("outside any transaction it runs at once, and a failing callback never throws", async () => {
    const { tx } = fakeClient();
    const uowInTx = new PrismaUnitOfWork(tx as any); // no $transaction: already transactional
    const root = new PrismaUnitOfWork({ $transaction: vi.fn() } as any);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ran = vi.fn();

    root.afterCommit(ran);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(() => root.afterCommit(() => { throw new Error("smtp down"); })).not.toThrow();
    uowInTx.afterCommit(ran); // queued, not run: this unit of work is inside a transaction
    expect(ran).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

// A unit of work with REAL transaction semantics over an in-memory
// AdminSession table: writes made inside execute() are staged and only
// committed if the callback returns; a throw discards them.
function transactionalAdminUow(seed: any[]) {
  let committed = new Map<string, any>(seed.map((s) => [s.id, { ...s }]));

  const repoOver = (rows: Map<string, any>) => ({
    findByTokenHash: async (h: string) => [...rows.values()].find((s) => s.tokenHash === h) ?? null,
    revokeAllByAdminId: async (adminId: string) => {
      for (const s of rows.values()) if (s.adminId === adminId && !s.revokedAt) s.revokedAt = new Date();
    },
    revokeById: async (id: string) => {
      const s = rows.get(id);
      if (s) s.revokedAt = new Date();
    },
    save: async (s: any) => {
      rows.set(s.id, { ...s });
    },
  });
  const adminUserRepository = {
    findById: async (id: string) => ({
      id,
      email: "a@example.com",
      isSuperAdmin: false,
      ensureCanLogin: () => {},
    }),
  };
  const adminAuditLogRepository = { save: async () => {} };

  const run = async (fn: any) => {
    const staged = new Map([...committed].map(([k, v]) => [k, { ...v }]));
    const result = await fn({
      adminSessionRepository: repoOver(staged),
      adminUserRepository,
      adminAuditLogRepository,
    });
    committed = staged; // commit only on success
    return result;
  };
  const uow: any = { execute: run, transaction: run, afterCommit: (fn: () => unknown) => fn() };
  // Root-level writes (outside any transaction) go straight to the table.
  Object.defineProperty(uow, "adminSessionRepository", { get: () => repoOver(committed) });
  return { uow, sessions: () => [...committed.values()] };
}

describe("AdminRefreshToken reuse detection survives a real transaction", () => {
  it("revokes every session of the admin when a revoked refresh token is re-presented", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const { uow, sessions } = transactionalAdminUow([
      { id: "s1", adminId: "adm1", tokenHash: TokenHasher.hash("old-raw"), revokedAt: new Date(), expiresAt: future, ipAddress: "", userAgent: "" },
      { id: "s2", adminId: "adm1", tokenHash: TokenHasher.hash("live-1"), revokedAt: null, expiresAt: future, ipAddress: "", userAgent: "" },
      { id: "s3", adminId: "adm1", tokenHash: TokenHasher.hash("live-2"), revokedAt: null, expiresAt: future, ipAddress: "", userAgent: "" },
      { id: "s4", adminId: "other", tokenHash: TokenHasher.hash("x"), revokedAt: null, expiresAt: future, ipAddress: "", userAgent: "" },
    ]);
    const useCase = new AdminRefreshTokenUseCase(uow, { sign: () => "jwt" } as any, { generate: () => "new-raw" } as any);

    await expect(useCase.execute("old-raw")).rejects.toThrow(/reuse detected/);

    const byId = Object.fromEntries(sessions().map((s) => [s.id, s]));
    expect(byId.s2.revokedAt).not.toBeNull();
    expect(byId.s3.revokedAt).not.toBeNull();
    expect(byId.s4.revokedAt).toBeNull(); // another admin is untouched
  });

  it("still rotates normally for a live token", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const { uow, sessions } = transactionalAdminUow([
      { id: "s1", adminId: "adm1", tokenHash: TokenHasher.hash("live"), revokedAt: null, expiresAt: future, ipAddress: "", userAgent: "" },
    ]);
    const useCase = new AdminRefreshTokenUseCase(uow, { sign: () => "jwt" } as any, { generate: () => "new-raw" } as any);

    const out = await useCase.execute("live");

    expect(out.refreshToken).toBe("new-raw");
    const all = sessions();
    expect(all.find((s) => s.id === "s1")!.revokedAt).not.toBeNull();
    expect(all.some((s) => s.tokenHash === TokenHasher.hash("new-raw") && !s.revokedAt)).toBe(true);
  });
});
