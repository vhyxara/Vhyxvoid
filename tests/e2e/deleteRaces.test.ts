// Deletes racing with writes, and downgrades racing with creates, against a
// real database (opt-in: VHYXVOID_TEST_DATABASE_URL). Found 2026-10-12:
//   - a write that lost to a delete hit Prisma's "record not found" or
//     "foreign key" error and answered 500 (98 of them in one probe);
//   - comments, docs and subfolders created while their doc or folder was
//     deleted kept its id (orphans; the docs and folders dropped out of the
//     tree), monitors kept a deleted environment's id (even one at a time),
//     and deleting a mock left docs' try-it pointing at it;
//   - creates queued behind the create lock used the limits they read before
//     queuing, so a downgrade committed meanwhile didn't apply to them;
//   - a save that lost to a delete said "someone saved" (409), not 404.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { errorHandler } from "../../apps/api/src/core/middleware/error-handler.middleware";
import { apiClientRoutes } from "../../apps/api/src/modules/platform/apiclient/apiClient.routes";
import { monitorRoutes } from "../../apps/api/src/modules/platform/perf/monitors.routes";
import { runMonitor } from "../../apps/api/src/modules/platform/perf/monitors.worker";
import { mockRoutes } from "../../apps/api/src/modules/platform/mocks/mocks.routes";
import { specRoutes } from "../../apps/api/src/modules/platform/specs/specs.routes";
import { teamChatRoutes } from "../../apps/api/src/modules/platform/team/chat.routes";
import { teamDocRoutes } from "../../apps/api/src/modules/platform/team/docs.routes";
import { teamIssueRoutes } from "../../apps/api/src/modules/platform/team/issues.routes";
import { teamCommentRoutes } from "../../apps/api/src/modules/platform/team/comments.routes";
import { lockedCreate } from "../../apps/api/src/modules/platform/shared/createLock";

const Fastify = createRequire(new URL("../../apps/api/package.json", import.meta.url))("fastify");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe("Prisma errors from a row deleted meanwhile", () => {
  const send = (code: string) => {
    let status = 0;
    let body: any;
    const reply: any = { status: (s: number) => ((status = s), reply), send: (b: unknown) => ((body = b), reply) };
    const err = Object.assign(new Error("Invalid `db.x.update()` invocation"), { name: "PrismaClientKnownRequestError", code });
    errorHandler(err, { id: "r1", method: "PUT", url: "/x", log: { error: () => undefined } } as never, reply);
    return { status, body };
  };
  it("answer 404 / 409, not 500, and say nothing about the query", () => {
    expect(send("P2025")).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    expect(send("P2003")).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
    expect(send("P2002")).toMatchObject({ status: 409, body: { code: "CONFLICT" } });
    expect(send("P2025").body.message).not.toMatch(/invocation|update/);
    expect(send("P1001").status).toBe(500); // anything else is still a server error
  });
});

describe.skipIf(!url)("deletes racing with writes", { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let f: any;
  const tag = `delr-${Date.now()}`;
  let accountId = "";
  let userId = "";
  const big = 100_000;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    userId = (await prisma.user.create({ data: { email: `${tag}@delrace.test`, password: "x", firstName: "Ada" } })).id;
    accountId = (
      await prisma.account.create({
        data: { name: `${tag} ws`, slug: tag, type: "ORGANIZATION", createdById: userId, limitOverrides: { maxApiCollections: big, maxMonitors: big, minMonitorIntervalMinutes: 1, maxTeamChannels: big, maxTeamDocs: big, maxTeamIssues: big, maxApiSpecs: big, maxMockApis: big } },
      })
    ).id;
    const role = await prisma.role.create({ data: { accountId, name: "r", level: 100 } });
    await prisma.accountMember.create({ data: { userId, accountId, roleId: role.id, roleLevel: 100 } });
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", { get: async (k: string) => (k.startsWith("features.") ? true : undefined) });
    f.decorate("userAuthGuard", async (r: any) => void (r.user = { userId, id: userId }));
    f.setErrorHandler(errorHandler);
    await f.register(apiClientRoutes, { prefix: "/api/v1/api-client" });
    await f.register(monitorRoutes, { prefix: "/api/v1/monitors" });
    await f.register(mockRoutes, { prefix: "/api/v1/mocks", hub: { invalidatePolicy: async () => undefined } });
    await f.register(specRoutes, { prefix: "/api/v1/specs", hub: { invalidateDomain: async () => undefined }, dns: {} });
    for (const r of [teamChatRoutes, teamDocRoutes, teamIssueRoutes, teamCommentRoutes]) await f.register(r, { prefix: "/api/v1/team" });
    await f.ready();
  });

  afterAll(async () => {
    await f?.close();
    await prisma.teamEvent.deleteMany({ where: { accountId } }).catch(() => undefined);
    await prisma.account.deleteMany({ where: { id: accountId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const call = (method: string, path: string, payload?: unknown) => f.inject({ method, url: `/api/v1${path.replace("{acc}", accountId)}`, payload: payload as never }).then((r: any) => ({ status: r.statusCode as number, body: r.json() }));
  const data = async (method: string, path: string, payload?: unknown) => {
    const r = await call(method, path, payload);
    if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data;
  };
  /** Runs the delete together with the writes, `rounds` times; returns every status. */
  async function race(rounds: number, setup: () => Promise<any>, del: (c: any) => Promise<{ status: number }>, writes: ((c: any) => Promise<{ status: number }>)[]) {
    const statuses: number[] = [];
    for (let i = 0; i < rounds; i++) {
      const c = await setup();
      const rs = await Promise.all([...writes.map((w) => w(c)), del(c)]);
      statuses.push(...rs.map((r) => r.status));
    }
    return statuses;
  }
  const no5xx = (s: number[]) => expect(s.filter((x) => x >= 500)).toEqual([]);

  it("writes that lose to a delete answer 4xx, never 500", async () => {
    const channel = () => data("POST", "/team/{acc}/chat/channels", { name: `c-${Math.random().toString(36).slice(2, 8)}` });
    no5xx(await race(6, channel, (c) => call("DELETE", `/team/{acc}/chat/channels/${c.id}`), [(c) => call("POST", `/team/{acc}/chat/channels/${c.id}/messages`, { body: "hi" }), (c) => call("PATCH", `/team/{acc}/chat/channels/${c.id}`, { topic: "t" })]));
    const issue = () => data("POST", "/team/{acc}/issues", { title: "i" });
    no5xx(await race(6, issue, (c) => call("DELETE", `/team/{acc}/issues/${c.number}`), [(c) => call("PATCH", `/team/{acc}/issues/${c.number}`, { status: "DONE" }), (c) => call("DELETE", `/team/{acc}/issues/${c.number}`)]));
    const col = () => data("POST", "/api-client/{acc}/collections", { name: "c" });
    no5xx(await race(6, col, (c) => call("DELETE", `/api-client/{acc}/collections/${c.id}`), [(c) => call("POST", "/monitors/{acc}", { name: "m", collectionId: c.id, intervalMinutes: 5 }), (c) => call("PUT", `/api-client/{acc}/collections/${c.id}`, { description: "x" })]));
  });

  it("a save after a delete is 404, a save after another save is 409", async () => {
    const d = await data("POST", "/team/{acc}/docs", { title: "d" });
    await data("DELETE", `/team/{acc}/docs/${d.id}`);
    // The doc is gone before the save's lookup here, so this is the route's own 404; the
    // versioned update losing the race is covered by staleOrGone below.
    expect((await call("PUT", `/team/{acc}/docs/${d.id}`, { body: "x" })).status).toBe(404);
    const { staleOrGone } = await import("../../apps/api/src/modules/platform/shared/http");
    await expect(staleOrGone(Promise.resolve(null), "document")).rejects.toMatchObject({ statusCode: 404 });
    await expect(staleOrGone(Promise.resolve({ id: "x" }), "document")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("no comment outlives its doc or issue, and no doc or folder its folder", async () => {
    const doc = () => data("POST", "/team/{acc}/docs", { title: "d" });
    await race(8, doc, (c) => call("DELETE", `/team/{acc}/docs/${c.id}`), [(c) => call("POST", "/team/{acc}/comments", { target: `doc:${c.id}`, body: "c" }), (c) => call("POST", "/team/{acc}/comments", { target: `doc:${c.id}`, body: "c2" })]);
    const issue = () => data("POST", "/team/{acc}/issues", { title: "i" });
    await race(8, issue, (c) => call("DELETE", `/team/{acc}/issues/${c.number}`), [(c) => call("POST", "/team/{acc}/comments", { target: `issue:${c.number}`, body: "c" })]);
    const folder = () => data("POST", "/team/{acc}/docs/folders", { name: "f" });
    await race(8, folder, (c) => call("DELETE", `/team/{acc}/docs/folders/${c.id}`), [(c) => call("POST", "/team/{acc}/docs", { title: "in", folderId: c.id }), (c) => call("POST", "/team/{acc}/docs/folders", { name: "sub", parentId: c.id })]);

    const comments = await prisma.teamComment.findMany({ where: { accountId }, select: { targetKind: true, targetId: true } });
    const docs = new Set((await prisma.teamDoc.findMany({ where: { accountId }, select: { id: true } })).map((d) => d.id));
    const issues = new Set((await prisma.teamIssue.findMany({ where: { accountId }, select: { id: true } })).map((i) => i.id));
    expect(comments.filter((c) => !(c.targetKind === "doc" ? docs : issues).has(c.targetId))).toEqual([]);
    const folders = await prisma.teamFolder.findMany({ where: { accountId }, select: { id: true, parentId: true } });
    const folderIds = new Set(folders.map((x) => x.id));
    expect(folders.filter((x) => x.parentId && !folderIds.has(x.parentId))).toEqual([]);
    const inFolders = await prisma.teamDoc.findMany({ where: { accountId, folderId: { not: null } }, select: { folderId: true } });
    expect(inFolders.filter((d) => !folderIds.has(d.folderId!))).toEqual([]);
  });

  it("the doc list shows docs and folders whose folder is gone at the top level", async () => {
    const ghost = "00000000-0000-4000-8000-000000000001";
    const d = await prisma.teamDoc.create({ data: { accountId, title: "stray", folderId: ghost } });
    const fo = await prisma.teamFolder.create({ data: { accountId, name: "stray folder", parentId: ghost } });
    const list = await data("GET", "/team/{acc}/docs");
    expect(list.docs.find((x: any) => x.id === d.id).folderId).toBeNull();
    expect(list.folders.find((x: any) => x.id === fo.id).parentId).toBeNull();
  });

  it("an environment in use by a monitor can't be deleted, even at the same time as the monitor is saved", async () => {
    const col = await data("POST", "/api-client/{acc}/collections", { name: "for monitors" });
    const used = await data("POST", "/api-client/{acc}/environments", { name: "used" });
    const mon = await data("POST", "/monitors/{acc}", { name: "Nightly", collectionId: col.id, environmentId: used.id, intervalMinutes: 5 });
    const refused = await call("DELETE", `/api-client/{acc}/environments/${used.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/"Nightly"/);
    for (let i = 0; i < 8; i++) {
      const env = await data("POST", "/api-client/{acc}/environments", { name: `e${i}` });
      await Promise.all([call("POST", "/monitors/{acc}", { name: `m${i}`, collectionId: col.id, environmentId: env.id, intervalMinutes: 5 }), call("PUT", `/monitors/{acc}/${mon.id}`, { environmentId: env.id }), call("DELETE", `/api-client/{acc}/environments/${env.id}`)]);
      await call("PUT", `/monitors/{acc}/${mon.id}`, { environmentId: used.id });
    }
    const monitors = await prisma.apiMonitor.findMany({ where: { accountId, environmentId: { not: null } }, select: { environmentId: true } });
    const envs = new Set((await prisma.apiEnvironment.findMany({ where: { accountId }, select: { id: true } })).map((e) => e.id));
    expect(monitors.filter((m) => !envs.has(m.environmentId!))).toEqual([]);
  });

  it("a monitor whose environment is gone fails its run and says why", async () => {
    const col = await data("POST", "/api-client/{acc}/collections", { name: "run me" });
    const m = await prisma.apiMonitor.create({ data: { accountId, name: "orphan", collectionId: col.id, environmentId: "00000000-0000-4000-8000-000000000002", intervalMinutes: 5, nextRunAt: new Date() } });
    const out = await runMonitor(prisma, { ...m, consecutiveFailures: 0 } as never);
    expect(out.ok).toBe(false);
    expect((await prisma.apiMonitor.findUnique({ where: { id: m.id } }))!.lastError).toMatch(/environment was deleted/);
  });

  it("deleting a mock turns off docs try-it on it; a spec can't be made from a mock being deleted", async () => {
    const mock = await data("POST", "/mocks/{acc}", { label: `tm${Date.now() % 100000}`, name: "m" });
    const spec = await data("POST", "/specs/{acc}", { name: "From mock", mockId: mock.id });
    expect((await prisma.apiSpec.findUnique({ where: { id: spec.id } }))!.tryMockId).toBe(mock.id);
    await data("DELETE", `/mocks/{acc}/${mock.id}`);
    expect((await prisma.apiSpec.findUnique({ where: { id: spec.id } }))!.tryMockId).toBeNull();
    for (let i = 0; i < 6; i++) {
      const mk = await data("POST", "/mocks/{acc}", { label: `tr${i}${Date.now() % 10000}`, name: "m" });
      await Promise.all([call("POST", "/specs/{acc}", { name: `s${i}-${Date.now()}`, mockId: mk.id }), call("DELETE", `/mocks/{acc}/${mk.id}`)]);
    }
    const tries = await prisma.apiSpec.findMany({ where: { accountId, tryMockId: { not: null } }, select: { tryMockId: true } });
    const mocks = new Set((await prisma.mockApi.findMany({ where: { accountId }, select: { id: true } })).map((m) => m.id));
    expect(tries.filter((s) => !mocks.has(s.tryMockId!))).toEqual([]);
  });

  it("creates waiting on the lock apply a downgrade that committed meanwhile", async () => {
    const before = await prisma.apiCollection.count({ where: { accountId } });
    let release!: () => void;
    let held!: () => void;
    const isHeld = new Promise<void>((r) => (held = r));
    // Hold the collections lock, queue creates behind it (they read the old limit), then downgrade.
    const holder = lockedCreate(prisma, accountId, "apiCollection", () => new Promise<void>((r) => ((release = r), held())));
    await isHeld;
    const queued = Array.from({ length: 5 }, (_, i) => call("POST", "/api-client/{acc}/collections", { name: `q${i}` }));
    await new Promise((r) => setTimeout(r, 300));
    const row = await prisma.account.findUnique({ where: { id: accountId }, select: { limitOverrides: true } });
    await prisma.account.update({ where: { id: accountId }, data: { limitOverrides: { ...(row!.limitOverrides as object), maxApiCollections: before } } });
    release();
    await holder;
    const statuses = (await Promise.all(queued)).map((r) => r.status);
    expect(statuses).toEqual([402, 402, 402, 402, 402]);
    expect(await prisma.apiCollection.count({ where: { accountId } })).toBe(before);
  });
});
