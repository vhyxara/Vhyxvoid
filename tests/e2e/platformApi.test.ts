// Phase 7, the platform API with API keys (opt-in: VHYXVOID_TEST_DATABASE_URL):
// the real userAuthGuard accepting "keyId.secret" on routes that declare a
// scope, refusing it everywhere else, for other workspaces, revoked/expired
// keys and missing scopes; acting as the key's creator.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import crypto from "node:crypto";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import userAuthGuard from "../../apps/api/src/modules/identity/presentation/plugins/guards/userAuthGuard";
import { platformApiRoutes } from "../../apps/api/src/modules/platform/shared/platformApi.routes";
import { specRoutes } from "../../apps/api/src/modules/platform/specs/specs.routes";
import { teamIssueRoutes } from "../../apps/api/src/modules/platform/team/issues.routes";
import { teamChatRoutes } from "../../apps/api/src/modules/platform/team/chat.routes";
import { RS256JwtService } from "../../apps/api/src/modules/identity/infrastructure/crypto/JwtService";
import { API_KEY_TOKEN_RE } from "../../apps/api/src/modules/platform/shared/apiKeyAuth";

const Fastify = createRequire(new URL("../../apps/api/package.json", import.meta.url))("fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;
const PEPPER = "platform-api-test-pepper-0123456789";

describe("API key token format", () => {
  it("accepts keyId.secret only", () => {
    expect(API_KEY_TOKEN_RE.test(`vhyxvoid_dev_${"a".repeat(32)}.${"b".repeat(64)}`)).toBe(true);
    expect(API_KEY_TOKEN_RE.test(`vhyxvoid_live_${"a".repeat(32)}.${"b".repeat(64)}`)).toBe(true);
    expect(API_KEY_TOKEN_RE.test("eyJhbGciOi.payload.sig")).toBe(false);
    expect(API_KEY_TOKEN_RE.test(`vhyxvoid_dev_${"a".repeat(32)}`)).toBe(false);
  });
});

describe.skipIf(!url)("platform API with API keys", () => {
  let prisma: PrismaClient;
  let f: any;
  const tag = `papi-${Date.now()}`;
  const accounts: string[] = [];
  const users: string[] = [];
  let ws = { accountId: "", userId: "" };
  let other = "";

  async function key(accountId: string, createdById: string, scopes: string[], extra: Record<string, unknown> = {}) {
    const keyId = `vhyxvoid_dev_${crypto.randomBytes(16).toString("hex")}`;
    const secret = crypto.randomBytes(32).toString("hex");
    await prisma.apiKey.create({
      data: { accountId, createdById, keyId, name: "ci", environment: "DEV", secretHash: crypto.createHmac("sha256", PEPPER).update(secret).digest("hex"), scopes: { create: scopes.map((scope) => ({ scope })) }, ...extra } as never,
    });
    return { keyId, secret, token: `${keyId}.${secret}` };
  }
  const call = (method: string, path: string, token: string, payload?: unknown) => f.inject({ method, url: path, payload: payload as never, headers: { authorization: `Bearer ${token}` } }).then((r: any) => ({ status: r.statusCode, body: r.json() }));

  beforeAll(async () => {
    process.env.SERVER_HMAC_PEPPER = PEPPER;
    prisma = new PrismaClient({ datasourceUrl: url });
    const mk = async (level: number) => {
      const u = await prisma.user.create({ data: { email: `${tag}-${users.length}@papi.test`, password: "x", firstName: "Ci" } });
      users.push(u.id);
      const a = await prisma.account.create({ data: { name: `${tag} ws`, slug: `${tag}-${accounts.length}`, type: "ORGANIZATION", createdById: u.id } });
      accounts.push(a.id);
      const role = await prisma.role.create({ data: { accountId: a.id, name: "r", level } });
      await prisma.accountMember.create({ data: { userId: u.id, accountId: a.id, roleId: role.id, roleLevel: level } });
      return { accountId: a.id, userId: u.id };
    };
    ws = await mk(100);
    other = (await mk(100)).accountId;
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", { get: async (k: string) => (k.startsWith("features.") ? true : undefined) });
    // A JWT never verifies here: only the API key path can authenticate.
    f.decorate("container", { resolve: (t: unknown) => (t === RS256JwtService ? { verify: () => { throw new Error("no jwt") } } : undefined) });
    f.decorate("authStateCache", { getUser: async () => null });
    f.setErrorHandler((err: any, _r: any, reply: any) => reply.code(err.name === "ZodError" ? 400 : (err.statusCode ?? 500)).send({ message: err.message }));
    await f.register(userAuthGuard);
    await f.register(platformApiRoutes, { prefix: "/api/v1/platform" });
    await f.register(specRoutes, { prefix: "/api/v1/specs", hub: { invalidateDomain: async () => undefined }, dns: {} });
    await f.register(teamIssueRoutes, { prefix: "/api/v1/team" });
    await f.register(teamChatRoutes, { prefix: "/api/v1/team" });
    await f.ready();
  });

  afterAll(async () => {
    await f?.close();
    await prisma.apiKey.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.account.deleteMany({ where: { id: { in: accounts } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it("whoami tells a key its workspace and scopes", async () => {
    const k = await key(ws.accountId, ws.userId, ["specs:read"]);
    const r = await call("GET", "/api/v1/platform/whoami", k.token);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ accountId: ws.accountId, keyId: k.keyId, scopes: ["specs:read"] });
    expect((await call("GET", "/api/v1/platform/whoami", `${k.keyId}.${"0".repeat(64)}`)).status).toBe(401);
    // lastUsedAt is written without holding up the response: wait for it rather than a fixed delay.
    let used: Date | null = null;
    for (let i = 0; i < 60 && !used; i++) {
      used = (await prisma.apiKey.findUnique({ where: { keyId: k.keyId } }))!.lastUsedAt;
      if (!used) await new Promise((res) => setTimeout(res, 50));
    }
    expect(used).not.toBeNull();
  });

  it("scopes, workspaces and dashboard-only routes are enforced", async () => {
    const read = await key(ws.accountId, ws.userId, ["specs:read"]);
    const all = await key(ws.accountId, ws.userId, ["*"]);
    expect((await call("GET", `/api/v1/specs/${ws.accountId}`, read.token)).status).toBe(200);
    const create = await call("POST", `/api/v1/specs/${ws.accountId}`, read.token, { name: "From CI" });
    expect(create.status).toBe(403);
    expect(create.body.message).toMatch(/specs:write/);
    expect((await call("GET", `/api/v1/specs/${other}`, all.token)).status).toBe(403);
    // Sharing has no API key scope: dashboard sign-in only.
    const spec = await call("POST", `/api/v1/specs/${ws.accountId}`, all.token, { name: "CI spec" });
    expect(spec.status).toBe(201);
    const share = await call("PUT", `/api/v1/specs/${ws.accountId}/${spec.body.data.id}/sharing`, all.token, { visibility: "PUBLIC" });
    expect(share.status).toBe(401);
    expect(share.body.message).toMatch(/dashboard sign-in/);
    // The key acts as its creator.
    const issue = await call("POST", `/api/v1/team/${ws.accountId}/issues`, all.token, { title: "From CI" });
    expect(issue.status).toBe(201);
    expect((await prisma.teamIssue.findFirst({ where: { accountId: ws.accountId, number: issue.body.data.number } }))!.createdById).toBe(ws.userId);
  });

  it("revoked, expired and rotated keys", async () => {
    const revoked = await key(ws.accountId, ws.userId, ["*"], { status: "REVOKED" });
    expect((await call("GET", "/api/v1/platform/whoami", revoked.token)).status).toBe(401);
    const expired = await key(ws.accountId, ws.userId, ["*"], { expiresAt: new Date(Date.now() - 1000) });
    expect((await call("GET", "/api/v1/platform/whoami", expired.token)).body.message).toMatch(/expired/);
    // After a rotation the old secret works during the grace window only.
    const old = crypto.randomBytes(32).toString("hex");
    const k = await key(ws.accountId, ws.userId, ["*"], { previousSecretHash: crypto.createHmac("sha256", PEPPER).update(old).digest("hex"), rotationGraceEndsAt: new Date(Date.now() + 60_000) });
    expect((await call("GET", "/api/v1/platform/whoami", `${k.keyId}.${old}`)).status).toBe(200);
    await prisma.apiKey.update({ where: { keyId: k.keyId }, data: { rotationGraceEndsAt: new Date(Date.now() - 1) } });
    expect((await call("GET", "/api/v1/platform/whoami", `${k.keyId}.${old}`)).status).toBe(401);
    expect((await call("GET", "/api/v1/platform/whoami", k.token)).status).toBe(200);
  });

  it("a key stops working when its creator leaves the workspace", async () => {
    const k = await key(ws.accountId, ws.userId, ["team:read"]);
    expect((await call("GET", `/api/v1/team/${ws.accountId}/issues`, k.token)).status).toBe(200);
    await prisma.accountMember.update({ where: { userId_accountId: { userId: ws.userId, accountId: ws.accountId } }, data: { roleLevel: 100 } });
    const helper = await prisma.user.create({ data: { email: `${tag}-gone@papi.test`, password: "x" } });
    users.push(helper.id);
    const role = await prisma.role.findFirst({ where: { accountId: ws.accountId } });
    await prisma.accountMember.create({ data: { userId: helper.id, accountId: ws.accountId, roleId: role!.id, roleLevel: 10 } });
    const hk = await key(ws.accountId, helper.id, ["team:read"]);
    expect((await call("GET", `/api/v1/team/${ws.accountId}/issues`, hk.token)).status).toBe(200);
    await prisma.accountMember.delete({ where: { userId_accountId: { userId: helper.id, accountId: ws.accountId } } });
    expect((await call("GET", `/api/v1/team/${ws.accountId}/issues`, hk.token)).status).toBe(403);
  });
});
