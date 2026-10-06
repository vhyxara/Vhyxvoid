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

describe("usage totals (M21 remainder)", async () => {
  const { weightedAverageMs } = await import("../../apps/api/src/modules/identity/presentation/http/user/tunnel.routes");
  it("weights the mean duration by requests per hour", () => {
    expect(weightedAverageMs([{ count: 99, avgDurationMs: 10 }, { count: 1, avgDurationMs: 1010 }])).toBe(20);
    expect(weightedAverageMs([{ count: 0, avgDurationMs: null }])).toBeNull();
    expect(weightedAverageMs([])).toBeNull();
  });
});

describe("tunnel password guessing (hub backlog)", async () => {
  const { PasswordGuessLimiter, hashTunnelPassword } = await import("../../packages/shared/src/tunnelAccess");
  const { HttpTunnelHandler } = await import("../../apps/hub/src/handlers/HttpTunnel.handler");

  it("blocks after the limit within the window, then lets attempts through again", () => {
    let now = 0;
    const l = new PasswordGuessLimiter(3, 60_000, () => now);
    const k = PasswordGuessLimiter.key("a", "web", "1.2.3.4");
    for (let i = 0; i < 3; i++) l.fail(k);
    expect(l.blockedFor(k)).toBe(60);
    expect(l.blockedFor(PasswordGuessLimiter.key("a", "web", "5.6.7.8"))).toBe(0); // other clients unaffected
    now = 30_000;
    expect(l.blockedFor(k)).toBe(30);
    now = 60_001;
    expect(l.blockedFor(k)).toBe(0);
  });

  it("the hub answers 429 after ten wrong passwords, even for the right one, and never counts the first visit", async () => {
    const pepper = "pepper";
    const policy = { accountId: "acc", label: "web", passwordHash: hashTunnelPassword(pepper, "acc", "web", "right"), ipAllowlist: [], shareVersion: 1 };
    const policies = { get: async () => policy } as any;
    const h = new (HttpTunnelHandler as any)({}, {}, {}, "vv.test", undefined, undefined, undefined, policies, pepper);
    const req = (pw?: string) => ({ headers: { ...(pw ? { authorization: `Basic ${Buffer.from(`u:${pw}`).toString("base64")}` } : {}) }, socket: { remoteAddress: "9.9.9.9" }, url: "/" });
    const check = (pw?: string) => h.checkAccess("acc", "web", req(pw));

    for (let i = 0; i < 20; i++) expect((await check()).status).toBe(401); // no password sent: not a guess
    for (let i = 0; i < 10; i++) expect((await check("wrong")).status).toBe(401);
    const blocked = await check("right");
    expect(blocked).toMatchObject({ allow: false, status: 429 });
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("inspector opt-out per workspace (api backlog)", async () => {
  const { RequestInspectorService } = await import("../../apps/hub/src/services/RequestInspector.service");

  it("keeps nothing when the workspace switched capture off, until the cache is invalidated", async () => {
    let capture = false;
    const limits = { findPlanLimitsForAccount: async () => ({ plan: "FREE" as const, inspectorRequests: 50 }), findInspectorCapture: async () => capture };
    const svc = new RequestInspectorService({} as any, limits as any);
    expect(await svc.keepFor("a")).toBe(0);
    capture = true;
    expect(await svc.keepFor("a")).toBe(0); // cached for a minute
    svc.invalidate("a");
    expect(await svc.keepFor("a")).toBe(50);
  });

  it("sources without the switch keep the plan's number (older wiring)", async () => {
    const svc = new RequestInspectorService({} as any, { findPlanLimitsForAccount: async () => ({ plan: "FREE" as const, inspectorRequests: 7 }) } as any);
    expect(await svc.keepFor("b")).toBe(7);
  });
});
