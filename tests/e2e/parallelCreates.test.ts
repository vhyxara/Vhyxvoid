// Plan limits and numbering under parallel requests, against a real database
// (opt-in: VHYXVOID_TEST_DATABASE_URL). Found 2026-10-08: 12 simultaneous
// creates on a free workspace made 10 collections, 10 specs and 11 API keys
// (limit 3), and 7 of 12 simultaneous issues failed with "Could not number
// the issue". Creates of one kind in one workspace now count and insert under
// a Postgres advisory lock (platform/shared/createLock.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { apiClientRoutes } from "../../apps/api/src/modules/platform/apiclient/apiClient.routes";
import { specRoutes } from "../../apps/api/src/modules/platform/specs/specs.routes";
import { teamDocRoutes } from "../../apps/api/src/modules/platform/team/docs.routes";
import { teamIssueRoutes } from "../../apps/api/src/modules/platform/team/issues.routes";
import { lockedCreate } from "../../apps/api/src/modules/platform/shared/createLock";
import { PrismaApiKeyRepository } from "../../apps/api/src/modules/key-management/domain/repositories/ApiKey.repositories";
import { ApiKey } from "../../apps/api/src/modules/key-management/domain/entities/apiKey.entities";
import { ApiKeyEnvironment } from "../../apps/api/src/core/constant/apikey.constant";

const Fastify = createRequire(new URL("../../apps/api/package.json", import.meta.url))("fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;
const N = 12;

describe.skipIf(!url)("parallel creates", { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let f: any;
  const tag = `par-${Date.now()}`;
  let accountId = "";
  let userId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    userId = (await prisma.user.create({ data: { email: `${tag}@parallel.test`, password: "x", firstName: "Ada" } })).id;
    accountId = (await prisma.account.create({ data: { name: `${tag} ws`, slug: tag, type: "ORGANIZATION", createdById: userId } })).id;
    const role = await prisma.role.create({ data: { accountId, name: "r", level: 100 } });
    await prisma.accountMember.create({ data: { userId, accountId, roleId: role.id, roleLevel: 100 } });
    f = Fastify({ bodyLimit: 20 * 1024 * 1024 });
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", { get: async (k: string) => (k.startsWith("features.") ? true : undefined) });
    f.decorate("userAuthGuard", async (r: any) => void (r.user = { userId, id: userId }));
    f.setErrorHandler((err: any, _r: any, reply: any) => reply.code(err.name === "ZodError" ? 400 : (err.statusCode ?? 500)).send({ message: err.message }));
    await f.register(apiClientRoutes, { prefix: "/api/v1/api-client" });
    await f.register(specRoutes, { prefix: "/api/v1/specs", hub: { invalidateDomain: async () => undefined }, dns: {} });
    for (const r of [teamDocRoutes, teamIssueRoutes]) await f.register(r, { prefix: "/api/v1/team" });
    await f.ready();
  });

  afterAll(async () => {
    await f?.close();
    await prisma.teamEvent.deleteMany({ where: { accountId } }).catch(() => undefined);
    await prisma.account.deleteMany({ where: { id: accountId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const burst = (path: string, body: (i: number) => unknown) =>
    Promise.all(Array.from({ length: N }, (_, i) => f.inject({ method: "POST", url: path, payload: body(i) }))).then((rs: any[]) => rs.map((r) => r.statusCode).sort());

  it("holds the free plan's 3 collections and 3 specs", async () => {
    const cols = await burst(`/api/v1/api-client/${accountId}/collections`, (i) => ({ name: `c${i}` }));
    expect(cols.filter((s) => s === 201)).toHaveLength(3);
    expect(cols.filter((s) => s !== 201).every((s) => s === 402)).toBe(true);
    expect(await prisma.apiCollection.count({ where: { accountId } })).toBe(3);

    // Same name for all: the slug is still picked uniquely under the lock.
    const specs = await burst(`/api/v1/specs/${accountId}`, () => ({ name: "Orders" }));
    expect(specs.filter((s) => s === 201)).toHaveLength(3);
    expect(specs.filter((s) => s !== 201).every((s) => s === 402)).toBe(true);
    const slugs = (await prisma.apiSpec.findMany({ where: { accountId }, select: { slug: true } })).map((s) => s.slug).sort();
    expect(slugs).toEqual(["orders", "orders-2", "orders-3"]);
  });

  it("numbers parallel issues without gaps or failures", async () => {
    const rs = await burst(`/api/v1/team/${accountId}/issues`, (i) => ({ title: `issue ${i}` }));
    expect(rs.every((s) => s === 201)).toBe(true);
    const numbers = (await prisma.teamIssue.findMany({ where: { accountId }, select: { number: true } })).map((i) => i.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it("counts API keys under the lock", async () => {
    const repo = new PrismaApiKeyRepository(prisma);
    const make = () => ApiKey.create({ accountId, createdById: userId, name: "k", environment: ApiKeyEnvironment.DEV, scopes: ["tunnel:connect"], pepper: "p".repeat(40) }).key;
    const out = await Promise.all(Array.from({ length: N }, () => repo.createWithinLimit(make(), 3)));
    expect(out.filter((x) => x === null)).toHaveLength(3);
    expect(out.filter((x) => x !== null).every((x) => x === 3)).toBe(true);
    expect(await repo.countActiveByAccount(accountId)).toBe(3);
  });

  it("other workspaces and kinds don't wait on each other; inside a transaction it reuses it", async () => {
    let inside = 0;
    let peak = 0;
    const hold = (kind: string) =>
      lockedCreate(prisma, accountId, kind, async () => {
        peak = Math.max(peak, ++inside);
        await new Promise((r) => setTimeout(r, 100));
        inside--;
      });
    await Promise.all([hold("a"), hold("b"), hold("c")]);
    expect(peak).toBe(3);
    await prisma.$transaction(async (tx) => {
      const n = await lockedCreate(tx, accountId, "a", async (t) => t.apiCollection.count({ where: { accountId } }));
      expect(n).toBe(3);
    });
  });
});
