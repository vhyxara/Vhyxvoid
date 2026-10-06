// 2026-10-06 launch fixes: absolute session lifetime (M23), admin sign-in
// lockout, session pruning, and the team activity feed's pure parts. The
// database parts are opt-in (VHYXVOID_TEST_DATABASE_URL, never production).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { Session } from "../../apps/api/src/modules/identity/domain/entities/user/Session.entities";
import { TTL, AdminTTL, SESSION_PRUNE_AFTER_MS } from "../../apps/api/src/core/constant/ttl.constant";
import { ACTIVITY_ROUTES, recordActivity } from "../../apps/api/src/modules/platform/shared/activity";
import { categoryOf, csvCell, mergeActivity, type ActivityItem } from "../../apps/api/src/modules/platform/activity/activity.routes";
import { PrismaClient } from "../../packages/shared/generated/prisma";
import { PrismaUnitOfWork } from "../../apps/api/src/modules/identity/infrastructure/prisma/PrismaUnitOfWork";
import { AdminLoginUseCase } from "../../apps/api/src/modules/identity/application/use-cases/admin/AdminLogin.usecase";
import { AdminRefreshTokenUseCase } from "../../apps/api/src/modules/identity/application/use-cases/admin/AdminRefreshToken.usecase";
import { BcryptPasswordHasher } from "../../apps/api/src/modules/identity/infrastructure/crypto/BcryptPasswordHasher";
import { CryptoTokenGenerator } from "../../apps/api/src/modules/identity/infrastructure/crypto/SecureTokenGenerator";
import { TokenHasher } from "../../apps/api/src/modules/identity/infrastructure/crypto/TokenHasher";
import { runMaintenance } from "../../apps/api/src/modules/platform/shared/maintenance";

// fastify is a dependency of apps/api, not of the repo root.
const Fastify = createRequire(new URL("../../apps/api/package.json", import.meta.url))("fastify");

describe("absolute session lifetime (M23)", () => {
  const mk = () => Session.create({ userId: "u", tokenHash: "h", ttlMs: TTL.REFRESH_TOKEN_MS, ipAddress: "1", userAgent: "t" });

  it("a sign-in gets an absolute end; rotations inherit it and never pass it", () => {
    const s = mk();
    const abs = s.absoluteExpiresAt!.getTime();
    expect(abs - Date.now()).toBeGreaterThan(TTL.SESSION_ABSOLUTE_MS - 5_000);
    const next = s.rotate("h2", TTL.REFRESH_TOKEN_MS, new Date());
    expect(next.absoluteExpiresAt!.getTime()).toBe(abs);

    // Close to the end, the sliding window is cut at the absolute end.
    const late = Session.rehydrate({ ...s.toPersistence(), revokedAt: null, absoluteExpiresAt: new Date(Date.now() + 60_000) });
    const capped = late.rotate("h3", TTL.REFRESH_TOKEN_MS, new Date());
    expect(capped.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("past the absolute end the session is expired even if its sliding window is not", () => {
    const s = Session.rehydrate({ ...mk().toPersistence(), absoluteExpiresAt: new Date(Date.now() - 1) });
    expect(s.isExpired(new Date())).toBe(true);
    expect(s.isValid(new Date())).toBe(false);
  });

  it("rows from before M23 get an absolute end on their next rotation", () => {
    const legacy = Session.rehydrate({ ...mk().toPersistence(), absoluteExpiresAt: null });
    expect(legacy.isExpired(new Date())).toBe(false);
    expect(legacy.rotate("x", TTL.REFRESH_TOKEN_MS, new Date()).absoluteExpiresAt).not.toBeNull();
  });
});

describe("team activity feed", () => {
  it("categories follow action prefixes", () => {
    expect(categoryOf("API_KEY_CREATED")).toBe("keys");
    expect(categoryOf("ACCOUNT_MEMBER_REMOVED")).toBe("members");
    expect(categoryOf("DOMAIN_ADDED")).toBe("tunnels");
    expect(categoryOf("ALERT_RULE_DELETED")).toBe("alerts");
    expect(categoryOf("PASSWORD_CHANGED")).toBe("other");
  });

  it("merges sources newest first and stops at the limit", () => {
    const item = (id: string, at: string) => ({ id, at }) as ActivityItem;
    const out = mergeActivity([[item("a", "2026-10-06T10:00:00Z"), item("b", "2026-10-06T08:00:00Z")], [item("c", "2026-10-06T09:00:00Z")]], 2);
    expect(out.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("CSV cells are quoted and cannot start a formula", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-1")).toBe("'-1");
  });

  it("records successful mutations from the route table, never secrets, and ignores failures", async () => {
    const rows: any[] = [];
    const prisma = { auditLog: { create: async (a: any) => rows.push(a.data) } } as any;
    const app = Fastify();
    app.addHook("onRequest", async (req: any) => {
      (req as any).user = { userId: "user-1" };
    });
    recordActivity(app, prisma);
    app.put("/api/v1/tunnel-access/:accountId/:label", async () => ({ ok: true }));
    app.post("/api/v1/domains/:accountId", async (_req: any, reply: any) => reply.code(422).send({ ok: false }));
    await app.ready();
    await app.inject({ method: "PUT", url: "/api/v1/tunnel-access/acc-1/web", payload: { password: "hunter2", ipAllowlist: ["1.2.3.4"] } });
    await app.inject({ method: "POST", url: "/api/v1/domains/acc-1", payload: { hostname: "x.dev", label: "web" } });
    await app.close();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: "acc-1", userId: "user-1", action: "TUNNEL_ACCESS_UPDATED", resourceId: "web", metadata: { label: "web", password: "set", ipAllowlist: 1 } });
    expect(JSON.stringify(rows[0])).not.toContain("hunter2");
    expect(Object.keys(ACTIVITY_ROUTES).every((k) => /^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\//.test(k))).toBe(true);
  });
});

const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe.skipIf(!url)("admin lockout, admin session cap and pruning (real database)", { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let uow: PrismaUnitOfWork;
  const mark = `lf-${Date.now()}`;
  const email = `${mark}@admin-lockout.test`;
  const hasher = new BcryptPasswordHasher();
  const tokens = new CryptoTokenGenerator();
  let adminId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    uow = new PrismaUnitOfWork(prisma);
    const admin = await prisma.adminUser.create({ data: { email, passwordHash: await hasher.hash("Correct-Horse-Battery-1"), firstName: "L", lastName: "F" } });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.adminUser.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it("locks after five wrong passwords, even for the right one, and a good sign-in resets the count", async () => {
    const login = new AdminLoginUseCase(uow, { sign: () => "jwt" } as any, tokens, hasher);
    const ok = await login.execute(email, "Correct-Horse-Battery-1", "127.0.0.1", "vitest");
    const session = await prisma.adminSession.findUnique({ where: { tokenHash: TokenHasher.hash(ok.refreshToken) } });
    expect(session!.absoluteExpiresAt!.getTime() - Date.now()).toBeGreaterThan(AdminTTL.ADMIN_SESSION_ABSOLUTE_MS - 60_000);

    await Promise.all(Array.from({ length: 5 }, () => login.execute(email, "wrong", "127.0.0.1", "vitest").catch(() => null)));
    await expect(login.execute(email, "Correct-Horse-Battery-1", "127.0.0.1", "vitest")).rejects.toThrow(/temporarily locked/);

    await prisma.adminUser.update({ where: { id: adminId }, data: { lockedUntil: new Date(Date.now() - 1) } });
    await login.execute(email, "Correct-Horse-Battery-1", "127.0.0.1", "vitest");
    expect((await prisma.adminUser.findUnique({ where: { id: adminId } }))!.failedLoginAttempts).toBe(0);
  });

  it("refresh refuses a session past its absolute end", async () => {
    await prisma.adminSession.create({
      data: { adminId, tokenHash: TokenHasher.hash(`${mark}-abs`), expiresAt: new Date(Date.now() + 86_400_000), absoluteExpiresAt: new Date(Date.now() - 1), ipAddress: "1", userAgent: "t" },
    });
    await expect(new AdminRefreshTokenUseCase(uow, { sign: () => "jwt" } as any, tokens).execute(`${mark}-abs`)).rejects.toThrow(/expired/);
  });

  it("maintenance deletes sessions dead for longer than the prune window and keeps the rest", async () => {
    const old = new Date(Date.now() - SESSION_PRUNE_AFTER_MS - 60_000);
    await prisma.adminSession.create({ data: { adminId, tokenHash: TokenHasher.hash(`${mark}-old`), expiresAt: old, ipAddress: "1", userAgent: "t" } });
    await prisma.adminSession.create({ data: { adminId, tokenHash: TokenHasher.hash(`${mark}-live`), expiresAt: new Date(Date.now() + 86_400_000), ipAddress: "1", userAgent: "t" } });
    const res = await runMaintenance(prisma);
    expect(res.adminSessions).toBeGreaterThanOrEqual(1);
    expect(await prisma.adminSession.count({ where: { tokenHash: TokenHasher.hash(`${mark}-old`) } })).toBe(0);
    expect(await prisma.adminSession.count({ where: { tokenHash: TokenHasher.hash(`${mark}-live`) } })).toBe(1);
  });
});
