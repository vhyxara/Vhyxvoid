import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import { RS256JwtService } from "../../apps/api/src/modules/identity/infrastructure/crypto/JwtService";
import { TokenHasher } from "../../apps/api/src/modules/identity/infrastructure/crypto/TokenHasher";
import { AuthStateCache, AUTH_STATE_TTL_SEC } from "../../apps/api/src/modules/identity/infrastructure/auth/AuthStateCache.service";
import userAuthGuardPlugin from "../../apps/api/src/modules/identity/presentation/plugins/guards/userAuthGuard";
import adminAuthGuardPlugin from "../../apps/api/src/modules/identity/presentation/plugins/adminAuthGuard.plugin";
import requireAbilityPlugin from "../../apps/api/src/modules/identity/presentation/plugins/requireAbility.plugin";
import { LogoutUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/Logout.usecase";
import { ResetPasswordUseCase } from "../../apps/api/src/modules/identity/application/use-cases/user/ResetPassword.usecase";
import { adminRoutes } from "../../apps/api/src/modules/identity/presentation/http/admin/admin.routes";
import { TTL, AdminTTL } from "../../apps/api/src/core/constant/ttl.constant";

// Covers internal-tools/shared/audit-2026-09-24.md H2: access tokens lived
// 100 h and the guards trusted them completely: logout, password reset,
// admin disable and super-admin demotion changed nothing for a token already
// issued, and the user guard accepted admin tokens. The guards now check each
// token against the subject's current state through AuthStateCache.
//
// Real guards, real requireAbility, real use cases and the real admin
// disable route. Only the stores are fakes: an Upstash-like Redis honouring
// TTLs on the (fake) clock, and an in-memory users/admins table standing in
// for Postgres.

let jwt: RS256JwtService;
beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  jwt = new RS256JwtService(privateKey, publicKey);
});
afterEach(() => vi.useRealTimers());

function world() {
  const users = new Map([["u1", { tokenVersion: 0, status: true, deletedAt: null as Date | null }]]);
  const admins = new Map([
    ["a1", { status: true, deletedAt: null as Date | null, isSuperAdmin: false }],
    ["root", { status: true, deletedAt: null as Date | null, isSuperAdmin: true }],
  ]);
  const store = new Map<string, { v: string; exp: number }>();
  const redis = {
    get: vi.fn(async (k: string) => {
      const e = store.get(k);
      if (!e || e.exp <= Date.now()) return null;
      return JSON.parse(e.v);
    }),
    set: vi.fn(async (k: string, v: string, o: { ex: number }) => {
      store.set(k, { v, exp: Date.now() + o.ex * 1000 });
      return "OK";
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  };
  const cache = new AuthStateCache(() => redis as any, {
    loadUser: async (id) => {
      const u = users.get(id);
      return u ? { tokenVersion: u.tokenVersion, active: u.status && !u.deletedAt } : null;
    },
    loadAdmin: async (id) => {
      const a = admins.get(id);
      return a ? { active: a.status && !a.deletedAt, isSuperAdmin: a.isSuperAdmin } : null;
    },
  });
  return { users, admins, cache, redis };
}

async function guards(cache: AuthStateCache, verifyAbility = vi.fn(async () => false)) {
  const f: any = {
    container: { resolve: () => jwt },
    jwtService: jwt,
    authStateCache: cache,
    verifyAdminAbilityUseCase: { execute: verifyAbility },
    decorate(name: string, v: unknown) {
      f[name] = v;
    },
  };
  await (userAuthGuardPlugin as any)(f, {});
  await (adminAuthGuardPlugin as any)(f, {});
  await (requireAbilityPlugin as any)(f, {});
  return f;
}

const req = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as any;
const userToken = (tokenVersion = 0) =>
  jwt.sign({ sub: "u1", email: "u@example.com", tokenVersion, type: "user" }, { expiresIn: TTL.ACCESS_TOKEN_SEC });
const adminToken = (sub: string, isSuperAdmin = false) =>
  jwt.sign({ sub, email: `${sub}@company.local`, type: "admin", isSuperAdmin }, { expiresIn: AdminTTL.ADMIN_TOKEN_TTL_SECONDS });

async function rejects(p: Promise<unknown>, status: number) {
  const err = await p.then(() => null, (e) => e);
  expect(err, "expected a rejection").not.toBeNull();
  expect(err.statusCode ?? err.status).toBe(status);
}

describe("access token lifetime", () => {
  it("user and admin access tokens last 15 minutes, from login and refresh alike", () => {
    expect(TTL.ACCESS_TOKEN_SEC).toBe(15 * 60);
    expect(AdminTTL.ADMIN_TOKEN_TTL_SECONDS).toBe(15 * 60);
  });
});

describe("user tokens are revoked by logout and password reset, not by expiry", () => {
  it("logout makes the access token fail on the next request", async () => {
    const { users, cache } = world();
    const g = await guards(cache);
    const token = userToken();
    await g.userAuthGuard(req(token), {}); // accepted, and now cached

    const session = { userId: "u1", isRevoked: () => false, revoke: vi.fn() };
    const uow = {
      execute: (fn: any) =>
        fn({
          sessionRepository: { findByTokenHash: async () => session, save: async () => {} },
          userRepository: {
            findById: async () => ({ incrementTokenVersion: () => users.get("u1")!.tokenVersion++ }),
            save: async () => {},
          },
        }),
    };
    await new LogoutUseCase(uow as any, cache).execute("raw-refresh-token");

    await rejects(g.userAuthGuard(req(token), {}), 401);
  });

  it("password reset makes every existing access token fail", async () => {
    const { users, cache } = world();
    const g = await guards(cache);
    const tokens = [userToken(), userToken()];
    for (const t of tokens) await g.userAuthGuard(req(t), {});

    const uow = {
      execute: (fn: any) =>
        fn({
          passwordResetTokenRepository: {
            findByHash: async () => ({ userId: "u1", ensureValid: () => {}, markUsed: () => {} }),
            save: async () => {},
          },
          userRepository: {
            findById: async () => ({
              id: "u1",
              isEmailVerified: true, // an existing, verified user
              resetPassword: () => users.get("u1")!.tokenVersion++, // mirrors User.resetPassword
            }),
            save: async () => {},
          },
          sessionRepository: { revokeAllByUserId: async () => {} },
          auditLogRepository: { create: async () => {} },
        }),
    };
    await new ResetPasswordUseCase(uow as any, { hash: async () => "new-hash" } as any, undefined, cache).execute({
      rawToken: "reset-token",
      newPassword: "N3w-password!",
    });

    for (const t of tokens) await rejects(g.userAuthGuard(req(t), {}), 401);
  });

  it("a deleted user's token is rejected once its cached state expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
    const { users, cache } = world();
    const g = await guards(cache);
    const token = userToken();
    await g.userAuthGuard(req(token), {});

    users.get("u1")!.deletedAt = new Date(); // no invalidation hook: bounded by the TTL
    vi.advanceTimersByTime((AUTH_STATE_TTL_SEC + 1) * 1000);

    await rejects(g.userAuthGuard(req(token), {}), 401);
  });
});

describe("admin tokens follow the admin's current state", () => {
  function captureDisableRoute(cache: AuthStateCache, admins: ReturnType<typeof world>["admins"]) {
    const routes = new Map<string, (r: any, rep: any) => Promise<any>>();
    const target = {
      id: "a1",
      disable: () => void (admins.get("a1")!.status = false),
      toPersistence: () => ({ ...admins.get("a1") }),
    };
    const fake: any = new Proxy(
      {
        post: (p: string, _o: any, h: any) => routes.set(`POST ${p}`, h),
        get: () => {},
        put: () => {},
        patch: () => {},
        delete: () => {},
        requireAbility: () => async () => {},
        authStateCache: cache,
        uow: {
          adminUserRepository: { findById: async () => target, save: async () => {} },
          adminAuditLogRepository: { save: async () => {} },
        },
      },
      { get: (t, k) => (k in t ? (t as any)[k] : vi.fn()) },
    );
    return { fake, routes };
  }

  it("disabling an admin makes their access token fail on the next request", async () => {
    const { admins, cache } = world();
    const g = await guards(cache);
    const token = adminToken("a1");
    await g.adminAuthGuard(req(token), {}); // accepted and cached

    const { fake, routes } = captureDisableRoute(cache, admins);
    await adminRoutes(fake);
    await routes.get("POST /users/:id/disable")!(
      { params: { id: "a1" }, admin: { id: "root", email: "root@company.local", isSuperAdmin: true }, headers: {}, ip: "127.0.0.1" },
      { code: () => ({ send: () => {} }), status: () => ({ send: () => {} }), send: () => {} },
    );

    await rejects(g.adminAuthGuard(req(token), {}), 401);
  });

  it("a demoted super-admin loses the super-admin bypass within the cache TTL, not when the token expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
    const { admins, cache } = world();
    const verifyAbility = vi.fn(async () => false);
    const g = await guards(cache, verifyAbility);
    const token = adminToken("root", true); // the claim says super-admin
    const check = g.requireAbility("admin.disable");

    await check(req(token), {}); // allowed via the bypass
    expect(verifyAbility).not.toHaveBeenCalled();

    admins.get("root")!.isSuperAdmin = false; // demoted directly in the database
    vi.advanceTimersByTime((AUTH_STATE_TTL_SEC + 1) * 1000);

    await rejects(check(req(token), {}), 403); // now needs the real ability, and lacks it
    expect(verifyAbility).toHaveBeenCalled();
  });

  it("an expired admin token answers 401 (apps/admin refreshes only on a 401)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
    const { cache } = world();
    const g = await guards(cache);
    const token = adminToken("a1");

    vi.advanceTimersByTime((AdminTTL.ADMIN_TOKEN_TTL_SECONDS + 1) * 1000);

    await rejects(g.adminAuthGuard(req(token), {}), 401);
  });
});

describe("each guard accepts only its own token type", () => {
  it("the user guard rejects an admin token", async () => {
    const { cache } = world();
    const g = await guards(cache);
    await rejects(g.userAuthGuard(req(adminToken("a1")), {}), 401);
  });

  it("the admin guard rejects a user token", async () => {
    const { cache } = world();
    const g = await guards(cache);
    await rejects(g.adminAuthGuard(req(userToken()), {}), 401);
  });

  it("a valid user token passes", async () => {
    const { cache } = world();
    const g = await guards(cache);
    const r = req(userToken());
    await g.userAuthGuard(r, {});
    expect(r.user.userId).toBe("u1");
  });

  it("uses one cached lookup, not a database query, per request", async () => {
    const { cache, redis } = world();
    const loadUser = vi.spyOn((cache as any).loaders, "loadUser");
    const g = await guards(cache);
    for (let i = 0; i < 5; i++) await g.userAuthGuard(req(userToken()), {});
    expect(loadUser).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledTimes(5);
  });
});
