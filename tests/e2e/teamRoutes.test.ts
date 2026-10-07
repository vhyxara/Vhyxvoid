// Phase 6 against a real database (opt-in: VHYXVOID_TEST_DATABASE_URL): the
// team space routes (chat, documents, comments, issues), notifications, the
// WebSocket fan-out and the email digest.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { PrismaClient } from "../../packages/shared/generated/prisma";
import { teamChatRoutes } from "../../apps/api/src/modules/platform/team/chat.routes";
import { teamDocRoutes } from "../../apps/api/src/modules/platform/team/docs.routes";
import { teamIssueRoutes } from "../../apps/api/src/modules/platform/team/issues.routes";
import { teamCommentRoutes } from "../../apps/api/src/modules/platform/team/comments.routes";
import { createTeamRealtime, TEAM_WS_PATH } from "../../apps/api/src/modules/platform/team/realtime";
import { runTeamDigest } from "../../apps/api/src/modules/platform/team/digest";

const req = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const Fastify = req("fastify");
const WebSocket = req("ws");
const url = process.env.VHYXVOID_TEST_DATABASE_URL;

describe.skipIf(!url)("team space routes", () => {
  let prisma: PrismaClient;
  let f: any;
  const tag = `team-${Date.now()}`;
  const users: string[] = [];
  let accountId = "";
  let other = "";
  const u = { owner: "", ada: "", bob: "", outsider: "" };
  let actAs = "";
  let features = true;

  async function user(name: string) {
    const x = await prisma.user.create({ data: { email: `${tag}-${name}@team.test`, password: "x", firstName: name[0].toUpperCase() + name.slice(1) } });
    users.push(x.id);
    return x.id;
  }
  async function join(userId: string, acc: string, level: number) {
    const role = await prisma.role.create({ data: { accountId: acc, name: `r${level}-${userId.slice(0, 4)}`, level } });
    await prisma.accountMember.create({ data: { userId, accountId: acc, roleId: role.id, roleLevel: level } });
  }
  const as = (who: string) => (actAs = who);
  const call = async (method: string, path: string, payload?: unknown, acc = accountId) => {
    const res = await f.inject({ method, url: `/api/v1/team/${acc}${path}`, payload: payload as never });
    return { status: res.statusCode, body: res.json() };
  };
  const notifications = (userId: string) => prisma.notification.findMany({ where: { userId, accountId }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    u.owner = await user("owner");
    u.ada = await user("ada");
    u.bob = await user("bob");
    u.outsider = await user("eve");
    const a = await prisma.account.create({ data: { name: `${tag} ws`, slug: `${tag}-a`, type: "ORGANIZATION", createdById: u.owner } });
    accountId = a.id;
    const b = await prisma.account.create({ data: { name: `${tag} other`, slug: `${tag}-b`, type: "ORGANIZATION", createdById: u.outsider } });
    other = b.id;
    await join(u.owner, accountId, 100);
    await join(u.ada, accountId, 10);
    await join(u.bob, accountId, 10);
    await join(u.outsider, other, 100);
    actAs = u.owner;
    f = Fastify();
    f.decorate("prisma", prisma);
    f.decorate("platformSettings", { get: async (k: string) => (k.startsWith("features.") ? features : undefined) });
    // x-test-user lets concurrent requests act as different people.
    f.decorate("userAuthGuard", async (r: any) => {
      const who = (r.headers["x-test-user"] as string | undefined) ?? actAs;
      r.user = { userId: who, id: who };
    });
    f.setErrorHandler((err: any, _r: any, reply: any) => reply.code(err.name === "ZodError" ? 400 : (err.statusCode ?? 500)).send({ message: err.message }));
    for (const r of [teamChatRoutes, teamDocRoutes, teamIssueRoutes, teamCommentRoutes]) await f.register(r, { prefix: "/api/v1/team" });
    await f.ready();
  });

  afterAll(async () => {
    await f?.close();
    await prisma.teamEvent.deleteMany({ where: { accountId: { in: [accountId, other] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.account.deleteMany({ where: { id: { in: [accountId, other] } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  let general = "";
  let api = "";
  let secret = "";

  it("creates #general on first use; channels, private visibility, DMs", async () => {
    const o = await call("GET", "/chat");
    expect(o.status).toBe(200);
    general = o.body.data.channels.find((c: any) => c.name === "general").id;
    expect(o.body.data.people.map((p: any) => p.name).sort()).toEqual(["Ada", "Bob", "Owner"]);
    expect((await call("POST", "/chat/channels", { name: "API Reviews" })).status).toBe(400);
    const made = await call("POST", "/chat/channels", { name: "api-reviews", topic: "Specs and breaking changes" });
    expect(made.status).toBe(201);
    api = made.body.data.id;
    expect((await call("POST", "/chat/channels", { name: "api-reviews" })).status).toBe(409);
    secret = (await call("POST", "/chat/channels", { name: "secret", isPrivate: true, memberIds: [u.ada, u.outsider] })).body.data.id;
    // Bob doesn't see the private channel; Ada does; the outsider wasn't added (not in the workspace).
    as(u.bob);
    expect((await call("GET", "/chat")).body.data.channels.map((c: any) => c.name)).toEqual(["api-reviews", "general"]);
    expect((await call("GET", `/chat/channels/${secret}/messages`)).status).toBe(404);
    as(u.ada);
    const ada = (await call("GET", "/chat")).body.data.channels;
    expect(ada.find((c: any) => c.id === secret).memberIds.sort()).toEqual([u.owner, u.ada].sort());
    // A DM is reused for the same people, whoever opens it.
    const dm = (await call("POST", "/chat/dms", { userIds: [u.bob] })).body.data.id;
    as(u.bob);
    expect((await call("POST", "/chat/dms", { userIds: [u.ada] })).body.data.id).toBe(dm);
    expect((await call("GET", "/chat")).body.data.channels.find((c: any) => c.id === dm)).toMatchObject({ kind: "DM", name: "Ada" });
    expect((await call("POST", "/chat/dms", { userIds: [u.outsider] })).status).toBe(400);
    as(u.outsider);
    expect((await call("GET", "/chat")).status).toBe(403);
    as(u.owner);
  });

  it("messages: mentions notify, links become cards, threads notify participants, unread counts", async () => {
    const mock = await prisma.mockApi.create({ data: { accountId, label: "users", name: "Users mock", endpoints: [{ id: "e1", method: "GET", path: "/users", enabled: true, responses: [{ id: "r1", status: 200 }] }] as never } });
    const foreign = await prisma.mockApi.create({ data: { accountId: other, label: "x", name: "Not yours" } });
    as(u.ada);
    await call("POST", `/chat/channels/${api}/join`);
    as(u.owner);
    const sent = await call("POST", `/chat/channels/${api}/messages`, {
      body: `<@${u.ada}> look at https://app.example/organizations/${accountId}/mocks/${mock.id}?endpoint=e1 and /organizations/${other}/mocks/${foreign.id}`,
    });
    expect(sent.status).toBe(201);
    expect(sent.body.data.cards).toEqual([{ kind: "mockEndpoint", href: `/organizations/${accountId}/mocks/${mock.id}?endpoint=e1`, title: "GET /users", subtitle: "Endpoint of the mock API Users mock", badge: "1 responses" }]);
    const n = await notifications(u.ada);
    expect(n.at(-1)).toMatchObject({ type: "TEAM_MENTION", title: "Owner mentioned you in #api-reviews", actionUrl: `/organizations/${accountId}/team/chat?c=${api}` });
    expect(n.at(-1)!.body).toContain("@Ada look at");

    // Ada sees one unread with a mention; reading clears both the count and the notification.
    as(u.ada);
    expect((await call("GET", "/chat")).body.data.channels.find((c: any) => c.id === api)).toMatchObject({ unread: 1, mentions: 1, joined: true });
    expect((await call("POST", `/chat/channels/${api}/read`)).status).toBe(200);
    expect((await call("GET", "/chat")).body.data.channels.find((c: any) => c.id === api)).toMatchObject({ unread: 0, mentions: 0 });
    expect((await notifications(u.ada)).filter((x) => !x.readAt)).toHaveLength(0);

    // Thread: Ada replies; the root's author hears about it, and later Bob's reply reaches both.
    const reply = await call("POST", `/chat/channels/${api}/messages`, { body: "On it", parentId: sent.body.data.id });
    expect(reply.status).toBe(201);
    as(u.bob);
    await call("POST", `/chat/channels/${api}/messages`, { body: "Me too", parentId: sent.body.data.id });
    expect((await notifications(u.owner)).filter((x) => x.type === "TEAM_REPLY")).toHaveLength(2);
    expect((await notifications(u.ada)).filter((x) => x.type === "TEAM_REPLY")).toHaveLength(1);
    const thread = await call("GET", `/chat/messages/${sent.body.data.id}/thread`);
    expect(thread.body.data.root.replyCount).toBe(2);
    expect(thread.body.data.replies.map((r: any) => `${r.authorName}: ${r.body}`)).toEqual(["Ada: On it", "Bob: Me too"]);
    // Replies don't count as unread top-level messages; the channel page lists roots only.
    const page = await call("GET", `/chat/channels/${api}/messages`);
    expect(page.body.data.messages).toHaveLength(1);

    // Mentions in a private channel only notify its members.
    as(u.owner);
    await call("POST", `/chat/channels/${secret}/messages`, { body: `<@${u.bob}> <@${u.ada}> private` });
    expect((await notifications(u.bob)).some((x) => x.title.includes("#secret"))).toBe(false);
    expect((await notifications(u.ada)).some((x) => x.title.includes("#secret"))).toBe(true);
  });

  it("edit, delete and reactions follow the rules", async () => {
    as(u.ada);
    const m = (await call("POST", `/chat/channels/${general}/messages`, { body: "first draft" })).body.data;
    expect((await call("PATCH", `/chat/messages/${m.id}`, { body: `final <@${u.bob}>` })).body.data).toMatchObject({ body: `final <@${u.bob}>`, editedAt: expect.any(String) });
    expect((await notifications(u.bob)).at(-1)!.title).toBe("Ada mentioned you in #general");
    as(u.bob);
    expect((await call("PATCH", `/chat/messages/${m.id}`, { body: "hijack" })).status).toBe(403);
    expect((await call("DELETE", `/chat/messages/${m.id}`)).status).toBe(403);
    // Reactions toggle; concurrent reactions both land.
    const react = (who: string) => f.inject({ method: "POST", url: `/api/v1/team/${accountId}/chat/messages/${m.id}/reactions`, payload: { emoji: "👍" }, headers: { "x-test-user": who } });
    await Promise.all([react(u.bob), react(u.owner), react(u.ada)]);
    const after = await prisma.teamMessage.findUnique({ where: { id: m.id } });
    expect([...(after!.reactions as any)["👍"]].sort()).toEqual([u.bob, u.owner, u.ada].sort());
    as(u.bob);
    const r1 = await call("POST", `/chat/messages/${m.id}/reactions`, { emoji: "🎉" });
    expect(r1.body.data.reactions.find((x: any) => x.emoji === "🎉")).toMatchObject({ count: 1, mine: true });
    const r2 = await call("POST", `/chat/messages/${m.id}/reactions`, { emoji: "🎉" });
    expect(r2.body.data.reactions.find((x: any) => x.emoji === "🎉")).toBeUndefined();
    // An admin can delete anyone's message; it stays as a placeholder.
    as(u.owner);
    expect((await call("DELETE", `/chat/messages/${m.id}`)).status).toBe(200);
    const page = await call("GET", `/chat/channels/${general}/messages`);
    expect(page.body.data.messages.find((x: any) => x.id === m.id)).toMatchObject({ deleted: true, body: "", reactions: [] });
  });

  it("history beyond the plan is hidden, not deleted; search respects visibility", async () => {
    const old = await prisma.teamMessage.create({ data: { accountId, channelId: general, authorId: u.owner, body: "ancient needle", createdAt: new Date(Date.now() - 200 * 86_400_000) } });
    await prisma.teamMessage.create({ data: { accountId, channelId: secret, authorId: u.owner, body: "private needle" } });
    const page = await call("GET", `/chat/channels/${general}/messages`);
    expect(page.body.data.messages.some((x: any) => x.id === old.id)).toBe(false);
    expect(page.body.data.hiddenByPlan).toBe(1);
    as(u.bob);
    let s = await call("GET", "/search?q=needle");
    expect(s.body.data.messages).toEqual([]);
    as(u.ada);
    s = await call("GET", "/search?q=needle");
    expect(s.body.data.messages.map((x: any) => x.channel)).toEqual(["#secret"]);
    await prisma.account.update({ where: { id: accountId }, data: { limitOverrides: { teamHistoryDays: null } } });
    expect((await call("GET", "/search?q=needle")).body.data.messages).toHaveLength(2);
    await prisma.account.update({ where: { id: accountId }, data: { limitOverrides: null } });
    as(u.owner);
  });

  let docId = "";

  it("documents: folders, optimistic saves, sessions of history, diff, restore, cards", async () => {
    const folder = (await call("POST", "/docs/folders", { name: "Runbooks" })).body.data;
    const sub = (await call("POST", "/docs/folders", { name: "Payments", parentId: folder.id })).body.data;
    expect((await call("PATCH", `/docs/folders/${folder.id}`, { parentId: sub.id })).status).toBe(400);
    const d = await call("POST", "/docs", { title: "Release checklist", folderId: sub.id, body: "# Release\n\n## Before\n- tests" });
    expect(d.status).toBe(201);
    docId = d.body.data.id;
    // Quick saves by the same person update one version; another author starts a new one.
    let v = d.body.data.version;
    for (const body of ["# Release\n\n## Before\n- tests\n- changelog", `# Release\n\n## Before\n- tests\n- changelog\n\nSee /organizations/${accountId}/team/issues/1 <@${u.bob}>`]) {
      const s = await call("PUT", `/docs/${docId}`, { body, expectedVersion: v });
      expect(s.status).toBe(200);
      v = s.body.data.version;
    }
    expect((await call("PUT", `/docs/${docId}`, { body: "stale", expectedVersion: 1 })).status).toBe(409);
    expect((await notifications(u.bob)).at(-1)!.title).toBe("Owner mentioned you in “Release checklist”");
    as(u.ada);
    await call("PUT", `/docs/${docId}`, { title: "Release checklist v2", body: "# Release\n\n## Before\n- tests\n- changelog\n- docs", expectedVersion: v });
    as(u.owner);
    const versions = (await call("GET", `/docs/${docId}/versions`)).body.data.versions;
    expect(versions.map((x: any) => `${x.number}:${x.author}`)).toEqual(["2:Ada", "1:Owner"]);
    const diff = (await call("GET", `/docs/${docId}/diff?from=1&to=2`)).body.data;
    expect(diff).toMatchObject({ added: 1, removed: 2, titleChanged: { from: "Release checklist", to: "Release checklist v2" } });
    const got = (await call("GET", `/docs/${docId}`)).body.data;
    expect(got.outline.map((h: any) => h.anchor)).toEqual(["release", "before"]);
    expect(got.latestVersion).toBe(2);
    expect((await call("POST", `/docs/${docId}/versions/1/restore`)).status).toBe(200);
    const restored = (await call("GET", `/docs/${docId}`)).body.data;
    expect(restored.title).toBe("Release checklist");
    expect(restored.latestVersion).toBe(3);
    // Deleting a folder moves its documents up.
    await call("DELETE", `/docs/folders/${sub.id}`);
    expect((await prisma.teamDoc.findUnique({ where: { id: docId } }))!.folderId).toBe(folder.id);
    as(u.bob);
    expect((await call("DELETE", `/docs/${docId}`)).status).toBe(403);
    as(u.owner);
  });

  let issueNo = 0;

  it("issues: numbering, filters, board moves, activity, assignment notifications, linked objects", async () => {
    const coll = await prisma.apiCollection.create({ data: { accountId, name: "Smoke", requests: [{ id: "q1", name: "List users", method: "GET", url: "https://x/users" }] as never } });
    const mk = (b: Record<string, unknown>) => call("POST", "/issues", b);
    const a = (await mk({ title: "Login fails", labels: ["Bug", "auth"], priority: "HIGH", assigneeId: u.ada, links: [`/organizations/${accountId}/api-client/${coll.id}?request=q1`] })).body.data;
    const b = (await mk({ title: "Docs typo", labels: ["docs"], dueDate: "2000-01-01" })).body.data;
    const c = (await mk({ title: "Rate limit headers", status: "IN_PROGRESS", body: `see /organizations/${accountId}/team/docs/${docId}` })).body.data;
    expect([a.number, b.number, c.number]).toEqual([1, 2, 3]);
    issueNo = a.number;
    expect((await notifications(u.ada)).at(-1)).toMatchObject({ type: "TEAM_ASSIGNED", title: "Owner assigned you #1" });
    expect((await mk({ title: "x", assigneeId: u.outsider })).status).toBe(400);
    const list = async (q: string) => (await call("GET", `/issues?q=${encodeURIComponent(q)}`)).body.data.issues.map((i: any) => i.number);
    expect(await list("")).toEqual([3, 2, 1]);
    expect(await list("label:bug")).toEqual([1]);
    expect(await list("due:overdue")).toEqual([2]);
    expect(await list("status:doing")).toEqual([3]);
    expect(await list("typo")).toEqual([2]);
    expect(await list("#3")).toEqual([3]);
    as(u.ada);
    expect(await list("assignee:me")).toEqual([1]);
    as(u.owner);
    const all = (await call("GET", "/issues")).body.data;
    expect(all.labels).toEqual(["auth", "bug", "docs"]);
    expect(all.counts).toMatchObject({ TODO: 2, IN_PROGRESS: 1 });

    // Board: drop #2 above #1 in To do, then move #1 to In progress below #3.
    await call("POST", `/issues/2/move`, { status: "TODO", before: null, after: 1 });
    expect((await call("GET", "/issues?sort=rank&q=status:todo")).body.data.issues.map((i: any) => i.number)).toEqual([2, 1]);
    await call("POST", `/issues/1/move`, { status: "IN_PROGRESS", before: 3, after: null });
    expect((await call("GET", "/issues?sort=rank&q=status:doing")).body.data.issues.map((i: any) => i.number)).toEqual([3, 1]);
    expect((await notifications(u.ada)).at(-1)!.title).toBe("Owner moved #1 to In progress");

    // Changes become activity; reassigning notifies the new assignee.
    await call("PATCH", "/issues/1", { assigneeId: u.bob, status: "DONE", labels: ["bug"] });
    const one = (await call("GET", "/issues/1")).body.data;
    expect(one.events.map((e: any) => e.kind)).toEqual(["created", "status", "status", "assignee", "labels"]);
    expect(one.events[3]).toMatchObject({ fromName: "Ada", toName: "Bob" });
    expect(one.closedAt).not.toBeNull();
    expect(one.links[0].card).toMatchObject({ kind: "request", title: "List users", badge: "GET" });
    expect((await notifications(u.bob)).at(-1)!.title).toBe("Owner assigned you #1");
    expect((await call("GET", "/issues/3")).body.data.links[0].card).toMatchObject({ kind: "doc", title: "Release checklist" });
    // Editing the body keeps explicit links and replaces body links.
    await call("PATCH", "/issues/3", { body: "no links now" });
    expect((await call("GET", "/issues/3")).body.data.links).toEqual([]);
    expect((await call("PATCH", "/issues/1", { dueDate: "tomorrow" })).status).toBe(400);
  });

  it("comments notify owners and mentions; heading comments are counted on the doc", async () => {
    as(u.bob);
    const c = await call("POST", "/comments", { target: `issue:${issueNo}`, body: `Fixed in staging, <@${u.ada}>?` });
    expect(c.status).toBe(201);
    expect((await notifications(u.ada)).at(-1)!.title).toBe("Bob mentioned you in a comment on #1");
    expect((await notifications(u.owner)).at(-1)!.title).toBe("Bob commented on #1");
    expect((await call("GET", "/issues/1")).body.data.comments.map((x: any) => x.body)).toEqual([`Fixed in staging, <@${u.ada}>?`]);
    const dc = await call("POST", "/comments", { target: `doc:${docId}`, body: "Add the rollback step", anchor: "before" });
    expect((await call("GET", `/docs/${docId}`)).body.data.openComments).toEqual({ before: 1 });
    expect((await call("POST", "/comments", { target: `issue:${issueNo}`, body: "x", anchor: "y" })).status).toBe(400);
    as(u.owner);
    expect((await call("PATCH", `/comments/${dc.body.data.id}`, { body: "edit" })).status).toBe(403);
    expect((await call("PATCH", `/comments/${dc.body.data.id}`, { resolved: true })).body.data.resolved).toBe(true);
    expect((await call("GET", `/docs/${docId}`)).body.data.openComments).toEqual({});
  });

  it("limits and the feature switch", async () => {
    await prisma.account.update({ where: { id: accountId }, data: { limitOverrides: { maxTeamIssues: 3, maxTeamDocs: 1, maxTeamChannels: 3 } } });
    expect((await call("POST", "/issues", { title: "one too many" })).status).toBe(402);
    expect((await call("POST", "/docs", { title: "two" })).status).toBe(402);
    expect((await call("POST", "/chat/channels", { name: "fourth" })).status).toBe(402);
    expect((await call("POST", "/chat/dms", { userIds: [u.ada] })).status).toBe(200); // DMs don't count
    await prisma.account.update({ where: { id: accountId }, data: { limitOverrides: null } });
    features = false;
    try {
      expect((await call("POST", `/chat/channels/${general}/messages`, { body: "hi" })).status).toBe(403);
      expect((await call("GET", "/chat")).body.data.enabled).toBe(false);
      expect((await call("GET", `/chat/channels/${general}/messages`)).status).toBe(200);
    } finally {
      features = true;
    }
  });

  it("live updates reach the right sockets of the workspace", async () => {
    const tokens: Record<string, string> = { "t-owner": u.owner, "t-bob": u.bob, "t-eve": u.outsider };
    const rt = createTeamRealtime(prisma, async (t) => (tokens[t] ? { userId: tokens[t] } : null));
    const server = http.createServer();
    server.on("upgrade", (r, s, h) => rt.handleUpgrade(r, s, h) || s.destroy());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const open = (token: string, acc = accountId) =>
      new Promise<{ ws: any; events: any[]; status: string }>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${TEAM_WS_PATH}`);
        const out = { ws, events: [] as any[], status: "open" };
        ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token, accountId: acc })));
        ws.on("message", (m: Buffer) => {
          const msg = JSON.parse(String(m));
          if (msg.type === "ready") resolve({ ...out, status: "ready" });
          else if (msg.type === "error") resolve({ ...out, status: "error" });
          else out.events.push(msg);
        });
      });
    try {
      const owner = await open("t-owner");
      const bob = await open("t-bob");
      expect(owner.status).toBe("ready");
      expect((await open("t-eve")).status).toBe("error"); // not in this workspace
      expect((await open("nope")).status).toBe("error");
      as(u.owner);
      await call("POST", `/chat/channels/${general}/messages`, { body: "everyone" });
      await call("POST", `/chat/channels/${secret}/messages`, { body: "members only" });
      await rt.pollOnce();
      await new Promise((r) => setTimeout(r, 100));
      const bodies = (s: { events: any[] }) => s.events.filter((e) => e.kind === "message").map((e) => e.payload.message.body);
      expect(bodies(owner)).toEqual(["everyone", "members only"]);
      expect(bodies(bob)).toEqual(["everyone"]);
      owner.ws.close();
      bob.ws.close();
    } finally {
      rt.close();
      server.close();
    }
  });

  it("the digest emails unread team notifications once a day, unless turned off", async () => {
    const sent: any[] = [];
    const svc = { sendTeamDigest: { execute: async (p: any) => void sent.push(p) } } as any;
    const later = Date.now() + 3_600_000;
    await runTeamDigest(prisma, svc, later);
    const mine = sent.filter((s) => s.accountName === `${tag} ws`);
    expect(mine.map((s) => s.to).sort()).toEqual([`${tag}-ada@team.test`, `${tag}-bob@team.test`, `${tag}-owner@team.test`].sort());
    const bob = mine.find((s) => s.to.startsWith(`${tag}-bob`));
    expect(bob.items[0].url).toMatch(/^https?:\/\/.+\/organizations\//);
    sent.length = 0;
    await runTeamDigest(prisma, svc, later + 3_600_000);
    expect(sent.filter((s) => s.accountName === `${tag} ws`)).toHaveLength(0); // once a day
    as(u.ada);
    expect((await call("PUT", "/prefs", { emailDigest: false })).body.data.emailDigest).toBe(false);
    await runTeamDigest(prisma, svc, later + 2 * 86_400_000);
    expect(sent.filter((s) => s.to.startsWith(`${tag}-ada`))).toHaveLength(0);
    as(u.owner);
  });
});
