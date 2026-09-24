import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { RefreshTokenUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/RefreshSession.usecase";
import { Session } from "../../apps/api/src/modules/identity/domain/entities/user/Session.entities";
import { TokenHasher } from "../../apps/api/src/modules/identity/infrastructure/crypto/TokenHasher";
import { RefreshSuccessorCipher } from "../../apps/api/src/modules/identity/infrastructure/crypto/RefreshSuccessorCipher";
import { PrismaUnitOfWork } from "../../apps/api/src/modules/identity/infrastructure/prisma/PrismaUnitOfWork";

// Covers internal-tools/shared/audit-2026-09-24.md H10. Reproduced live first
// against the real api: two concurrent refreshes with one cookie BOTH
// succeeded with different successors (two live sessions from one token), and
// the same token presented one second after rotation revoked every session.
//
// The store below behaves like the real table under the fix's contract:
// findByTokenHashForUpdate holds a per-row lock until the transaction that
// took it ends (Postgres SELECT ... FOR UPDATE), and writes made inside a
// transaction are discarded if it throws. The real FOR UPDATE was verified
// live against Postgres (see api/decision.md, 2026-09-25, "H10").

beforeAll(() => {
  process.env.SERVER_HMAC_PEPPER = process.env.SERVER_HMAC_PEPPER ?? "t".repeat(40);
});
afterEach(() => vi.useRealTimers());

const USER = { id: "u1", email: "u@example.com", tokenVersion: 0, firstName: "U", lastName: "S", ensureCanLogin: () => {} };
const TTL_MS = 30 * 24 * 3600 * 1000;

function makeStore() {
  const rows = new Map<string, Session>(); // id -> session
  const locks = new Map<string, Promise<void>>();
  let seq = 0;
  const byHash = (h: string) => [...rows.values()].find((s) => s.tokenHash === h) ?? null;
  const clone = (s: Session | null) => (s ? Session.rehydrate({ ...s.toPersistence() }) : null);

  function repo(held: Array<() => void> | null) {
    return {
      findByTokenHash: async (h: string) => {
        await new Promise((r) => setTimeout(r, 1)); // let concurrent callers interleave
        return clone(byHash(h));
      },
      findByTokenHashForUpdate: async (h: string) => {
        while (locks.has(h)) await locks.get(h);
        let release!: () => void;
        locks.set(h, new Promise<void>((r) => (release = r)));
        held?.push(() => {
          locks.delete(h);
          release();
        });
        await new Promise((r) => setTimeout(r, 1));
        return clone(byHash(h));
      },
      findById: async (id: string) => clone(rows.get(id) ?? null),
      save: async (s: Session) => void rows.set(s.id, clone(s)!),
      purgeRotationCiphers: async () => {},
      revokeAllByUserId: vi.fn(async (userId: string, now: Date) => {
        for (const s of rows.values()) if (s.userId === userId) s.revoke(now);
      }),
    };
  }
  const root = repo(null);
  const uow: any = {
    sessionRepository: root,
    userRepository: { findById: async () => USER },
    // Legacy path (pre-fix code): no transaction, no lock.
    execute: (fn: any) => fn({ sessionRepository: root, userRepository: uow.userRepository }),
    transaction: async (fn: any) => {
      const held: Array<() => void> = [];
      const snapshot = new Map([...rows].map(([k, v]) => [k, clone(v)!]));
      try {
        return await fn({ sessionRepository: repo(held), userRepository: uow.userRepository });
      } catch (e) {
        rows.clear(); // roll back
        for (const [k, v] of snapshot) rows.set(k, v);
        throw e;
      } finally {
        held.forEach((r) => r());
      }
    },
  };
  const login = () => {
    const raw = `raw-${++seq}`;
    const s = Session.create({ userId: USER.id, tokenHash: TokenHasher.hash(raw), ttlMs: TTL_MS, ipAddress: "::1", userAgent: "t" });
    rows.set(s.id, s);
    return raw;
  };
  const activeCount = () => [...rows.values()].filter((s) => !s.isRevoked()).length;
  return { uow, login, activeCount, root, rows };
}

let tokenSeq = 0;
function useCase(uow: any) {
  return new RefreshTokenUseCase(
    uow,
    { sign: () => "access-token" } as any,
    { generate: () => `successor-${++tokenSeq}-${Math.random()}` } as any,
    TTL_MS,
  );
}

describe("concurrent refreshes of one token (H10)", () => {
  it("two truly concurrent refreshes get the SAME successor, and only one session is minted", async () => {
    const { uow, login, activeCount, root } = makeStore();
    const raw = login();
    const uc = useCase(uow);

    const [a, b] = await Promise.all([uc.execute(raw), uc.execute(raw)]);

    expect(a.refreshToken).toBe(b.refreshToken);
    expect(activeCount()).toBe(1);
    expect(root.revokeAllByUserId).not.toHaveBeenCalled();
  });

  it("five concurrent refreshes all get the same successor", async () => {
    const { uow, login, activeCount } = makeStore();
    const raw = login();
    const uc = useCase(uow);

    const results = await Promise.all(Array.from({ length: 5 }, () => uc.execute(raw)));

    expect(new Set(results.map((r) => r.refreshToken)).size).toBe(1);
    expect(activeCount()).toBe(1);
  });

  it("a token presented again within the grace window gets the same successor, not revoke-all", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); // only the clock: the store interleaves with setTimeout
    vi.setSystemTime(new Date("2026-09-25T10:00:00Z"));
    const { uow, login, root } = makeStore();
    const raw = login();
    const uc = useCase(uow);
    const first = await uc.execute(raw);

    vi.setSystemTime(new Date("2026-09-25T10:00:20Z")); // 20 s later: a slow second tab
    const second = await uc.execute(raw);

    expect(second.refreshToken).toBe(first.refreshToken);
    expect(root.revokeAllByUserId).not.toHaveBeenCalled();
  });
});

describe("real reuse detection is unchanged (H10)", () => {
  it("a token presented after the grace window revokes every session, and the revoke survives the failed request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); // only the clock: the store interleaves with setTimeout
    vi.setSystemTime(new Date("2026-09-25T10:00:00Z"));
    const { uow, login, activeCount } = makeStore();
    const raw = login();
    login(); // another device
    const uc = useCase(uow);
    await uc.execute(raw);
    expect(activeCount()).toBe(2);

    vi.setSystemTime(new Date("2026-09-25T10:00:31Z"));
    await expect(uc.execute(raw)).rejects.toThrow(/reuse detected/);

    expect(activeCount()).toBe(0);
  });

  it("a logged-out token gets no grace, even seconds later", async () => {
    const { uow, login, rows, activeCount } = makeStore();
    const raw = login();
    for (const s of rows.values()) s.revoke(new Date()); // logout: revoked, not rotated
    login();

    await expect(useCase(uow).execute(raw)).rejects.toThrow(/reuse detected/);
    expect(activeCount()).toBe(0);
  });

  it("within the grace window, a successor that has since been revoked is not handed out", async () => {
    const { uow, login, rows } = makeStore();
    const raw = login();
    const uc = useCase(uow);
    const first = await uc.execute(raw);
    const successor = [...rows.values()].find((s) => s.tokenHash === TokenHasher.hash(first.refreshToken))!;
    successor.revoke(new Date()); // e.g. that device logged out

    await expect(uc.execute(raw)).rejects.toThrow(/reuse detected/);
  });
});

describe("successor cipher and real transactions", () => {
  it("stores the successor encrypted, round-trips it, and rejects a tampered value", () => {
    const c = RefreshSuccessorCipher.encrypt("successor-raw-token");
    expect(c).not.toContain("successor-raw-token");
    expect(RefreshSuccessorCipher.decrypt(c)).toBe("successor-raw-token");
    const [iv, tag, ct] = c.split(".");
    expect(RefreshSuccessorCipher.decrypt([iv, tag, ct.slice(0, -2) + "AA"].join("."))).toBeNull();
  });

  it("PrismaUnitOfWork.transaction opens a real transaction on a Prisma-style proxy client", async () => {
    // Prisma 6's client is a proxy that fails `instanceof PrismaClient`, which is
    // why execute() never opened one; transaction() checks for $transaction instead.
    const tx = { marker: "tx" };
    const client: any = { $transaction: vi.fn(async (fn: any) => fn(tx)) };
    const uow = new PrismaUnitOfWork(client);

    const seen = await uow.transaction(async (inner: any) => inner.prisma);

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(seen).toBe(tx);
  });
});
