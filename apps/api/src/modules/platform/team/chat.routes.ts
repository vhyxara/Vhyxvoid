// /api/v1/team/:accountId/chat — channels, direct messages, threads, mentions,
// reactions, read state and search (internal-tools/shared/api-platform-plan.md, phase 6).
//
//   GET    /chat                         channels I can see with unread/mention counts, people, limits
//   POST   /chat/channels                { name, topic?, isPrivate?, memberIds?, refKind?, refId? } (plan maxTeamChannels)
//   PATCH  /chat/channels/:cid           { name?, topic?, archived? } (creator, owners/admins)
//   DELETE /chat/channels/:cid           (owners/admins)
//   POST   /chat/channels/:cid/join      join a public channel
//   POST   /chat/channels/:cid/leave
//   POST   /chat/channels/:cid/members   { userIds } add people (members of the channel)
//   POST   /chat/dms                     { userIds } open (or reuse) a direct conversation
//   GET    /chat/channels/:cid/messages  ?before=<iso>&limit= newest first page, oldest first in it
//   POST   /chat/channels/:cid/messages  { body, parentId? }
//   GET    /chat/messages/:mid/thread    the root and its replies
//   PATCH  /chat/messages/:mid           { body } (author)
//   DELETE /chat/messages/:mid           (author, owners/admins)
//   POST   /chat/messages/:mid/reactions { emoji } toggle mine
//   POST   /chat/channels/:cid/read      mark read up to now
//   POST   /chat/channels/:cid/typing    "someone is typing" for 5 s
//   GET    /search?q=                    messages, documents and issues I can see
//   GET    /prefs, PUT /prefs            { emailDigest }
//
// Public channels are open to every member of the workspace (join to get
// unread counts); private channels and DMs only to their members. A #general
// channel is created on first use and everyone is joined to it.
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ConflictError, ForbiddenError, NotFoundError, PlanLimitExceededError, ValidationError } from "@/core/errors/error.format";
import { successResponse } from "@/core/utils/response.util";
import { TEAM_BOUNDS, channelNameProblem, excerpt, mentionsOf, plainText, refsInText, type TeamRef } from "@vhyxvoid/shared";
import { cardKey, resolveCards, teamContext, type Db, type Member } from "./team.shared";

const params = z.object({ accountId: z.string().uuid() });
const chParams = params.extend({ cid: z.string().uuid() });
const msgParams = params.extend({ mid: z.string().uuid() });
const name = z.string().trim().toLowerCase().superRefine((v, ctx) => {
  const p = channelNameProblem(v);
  if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p });
});
const body = z.string().trim().min(1, "Write something").max(TEAM_BOUNDS.messageLength);

type Channel = { id: string; accountId: string; kind: string; name: string | null; topic: string; isPrivate: boolean; dmKey: string | null; refKind: string | null; refId: string | null; archivedAt: Date | null; createdById: string | null; lastMessageAt: Date | null; createdAt: Date };
type Message = { id: string; accountId: string; channelId: string; parentId: string | null; authorId: string; body: string; mentions: string[]; refs: unknown; reactions: unknown; replyCount: number; lastReplyAt: Date | null; editedAt: Date | null; deletedAt: Date | null; createdAt: Date };

export async function teamChatRoutes(fastify: FastifyInstance) {
  const t = teamContext(fastify);
  const db: Db = t.db;

  /** Members of a channel who get its events: [] (everyone) for public channels. */
  async function audience(ch: Channel): Promise<string[]> {
    if (ch.kind === "CHANNEL" && !ch.isPrivate) return [];
    return (await db.teamChannelMember.findMany({ where: { channelId: ch.id }, select: { userId: true } })).map((m: { userId: string }) => m.userId);
  }
  async function channel(accountId: string, cid: string, m: Member, opts: { write?: boolean } = {}): Promise<Channel> {
    const ch = (await db.teamChannel.findFirst({ where: { id: cid, accountId } })) as Channel | null;
    if (!ch) throw new NotFoundError("Channel not found");
    if (ch.kind !== "CHANNEL" || ch.isPrivate) {
      const inIt = await db.teamChannelMember.findUnique({ where: { channelId_userId: { channelId: cid, userId: m.userId } } });
      if (!inIt) throw new NotFoundError("Channel not found");
    }
    if (opts.write && ch.archivedAt) throw new ConflictError("This channel is archived");
    return ch;
  }
  async function ensureGeneral(accountId: string, userId: string) {
    let general = await db.teamChannel.findFirst({ where: { accountId, name: "general", kind: "CHANNEL" } });
    if (!general) {
      try {
        general = await db.teamChannel.create({ data: { accountId, name: "general", topic: "Everyone in the workspace", createdById: userId } });
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err;
        general = await db.teamChannel.findFirst({ where: { accountId, name: "general" } });
      }
    }
    await db.teamChannelMember.upsert({ where: { channelId_userId: { channelId: general.id, userId } }, create: { channelId: general.id, userId, accountId }, update: {} });
  }

  /** Messages as the client sees them: author names, cards for links, reactions as counts with "mine". */
  async function present(accountId: string, userId: string, rows: Message[]) {
    const refs = rows.flatMap((r) => (r.deletedAt ? [] : (r.refs as TeamRef[]) ?? []));
    const cards = refs.length ? await resolveCards(db, accountId, userId, refs) : new Map();
    const authors = await t.names(rows.map((r) => r.authorId));
    return rows.map((r) => {
      const reactions = Object.entries((r.reactions as Record<string, string[]>) ?? {})
        .filter(([, users]) => users.length)
        .map(([emoji, users]) => ({ emoji, count: users.length, mine: users.includes(userId), users: users.slice(0, 10) }));
      return {
        id: r.id,
        channelId: r.channelId,
        parentId: r.parentId,
        authorId: r.authorId,
        authorName: authors[r.authorId] ?? "Former member",
        body: r.deletedAt ? "" : r.body,
        deleted: !!r.deletedAt,
        mentions: r.mentions,
        cards: r.deletedAt ? [] : ((r.refs as TeamRef[]) ?? []).map((ref) => cards.get(cardKey(ref))).filter(Boolean),
        reactions,
        replyCount: r.replyCount,
        lastReplyAt: r.lastReplyAt,
        editedAt: r.editedAt,
        createdAt: r.createdAt,
      };
    });
  }

  fastify.get("/:accountId/chat", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const m = await t.member(request, accountId);
    const lim = await t.limits(accountId);
    if (lim.enabled && lim.maxChannels > 0) await ensureGeneral(accountId, m.userId);
    const [channels, mine, people] = await Promise.all([
      db.teamChannel.findMany({
        where: { accountId, OR: [{ kind: "CHANNEL", isPrivate: false }, { members: { some: { userId: m.userId } } }] },
        orderBy: [{ kind: "asc" }, { name: "asc" }],
        include: { members: { select: { userId: true } } },
      }),
      db.teamChannelMember.findMany({ where: { accountId, userId: m.userId }, select: { channelId: true, joined: true, lastReadAt: true, muted: true } }),
      t.people(accountId),
    ]);
    const cutoff = t.historyCutoff(lim.historyDays);
    // One query for every channel's unread and mention counts.
    const counts: Array<{ channelId: string; unread: bigint; mentions: bigint }> = await db.$queryRawUnsafe(
      `SELECT m."channelId", count(*)::bigint AS unread, count(*) FILTER (WHERE $2 = ANY(m."mentions"))::bigint AS mentions
         FROM "team_messages" m
         JOIN "team_channel_members" cm ON cm."channelId" = m."channelId" AND cm."userId" = $2 AND cm."joined"
        WHERE m."accountId" = $1 AND m."parentId" IS NULL AND m."deletedAt" IS NULL AND m."authorId" <> $2
          AND m."createdAt" > cm."lastReadAt" AND m."createdAt" > $3
        GROUP BY m."channelId"`,
      accountId,
      m.userId,
      cutoff,
    );
    const byChannel = new Map(counts.map((c) => [c.channelId, { unread: Number(c.unread), mentions: Number(c.mentions) }]));
    const myRows = new Map(mine.map((r: { channelId: string }) => [r.channelId, r]));
    const named = new Map(people.map((p) => [p.id, p.name]));
    const count = channels.filter((c: Channel) => c.kind === "CHANNEL").length;
    return successResponse(reply, "Success", 200, {
      enabled: lim.enabled && lim.maxChannels > 0,
      platformEnabled: lim.enabled,
      limits: { maxChannels: lim.maxChannels, channels: count, historyDays: lim.historyDays },
      me: m.userId,
      canManage: m.isAdmin,
      people,
      channels: channels.map((c: Channel & { members: Array<{ userId: string }> }) => {
        const row = myRows.get(c.id) as { joined: boolean; muted: boolean } | undefined;
        const others = c.members.map((x) => x.userId).filter((u) => u !== m.userId);
        return {
          id: c.id,
          kind: c.kind,
          name: c.kind === "DM" ? others.map((u) => named.get(u) ?? "Former member").join(", ") || "Just you" : c.name,
          topic: c.topic,
          isPrivate: c.isPrivate,
          refKind: c.refKind,
          refId: c.refId,
          archived: !!c.archivedAt,
          joined: !!row?.joined,
          muted: !!row?.muted,
          memberIds: c.kind === "CHANNEL" && !c.isPrivate ? null : c.members.map((x) => x.userId),
          lastMessageAt: c.lastMessageAt,
          canEdit: m.isAdmin || c.createdById === m.userId,
          ...(byChannel.get(c.id) ?? { unread: 0, mentions: 0 }),
        };
      }),
    });
  });

  fastify.post("/:accountId/chat/channels", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const b = z
      .object({ name, topic: z.string().trim().max(TEAM_BOUNDS.topicLength).default(""), isPrivate: z.boolean().default(false), memberIds: z.array(z.string().uuid()).max(500).default([]), refKind: z.enum(["spec", "mock", "collection"]).optional(), refId: z.string().uuid().optional() })
      .parse(request.body ?? {});
    const m = await t.member(request, accountId);
    const lim = await t.writable(accountId);
    const count = await db.teamChannel.count({ where: { accountId, kind: "CHANNEL" } });
    if (count >= lim.maxChannels) throw new PlanLimitExceededError({ limit: lim.maxChannels, current: count, limitKey: "maxTeamChannels", plan: lim.plan });
    if (b.refKind && b.refId) {
      const model = b.refKind === "spec" ? db.apiSpec : b.refKind === "mock" ? db.mockApi : db.apiCollection;
      if (!(await model.findFirst({ where: { id: b.refId, accountId }, select: { id: true } }))) throw new NotFoundError("The API this channel is about was not found");
    }
    const valid = new Set((await db.accountMember.findMany({ where: { accountId, userId: { in: b.memberIds } }, select: { userId: true } })).map((x: { userId: string }) => x.userId));
    let ch: Channel;
    try {
      ch = await db.teamChannel.create({
        data: { accountId, name: b.name, topic: b.topic, isPrivate: b.isPrivate, refKind: b.refKind && b.refId ? b.refKind : null, refId: b.refKind && b.refId ? b.refId : null, createdById: m.userId, members: { create: [...new Set([m.userId, ...valid])].map((userId) => ({ userId: userId as string, accountId })) } },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError(`#${b.name} already exists`);
      throw err;
    }
    await t.emit(accountId, "channel", { channelId: ch.id }, await audience(ch));
    return successResponse(reply, "Channel created", 201, { id: ch.id, name: ch.name });
  });

  fastify.patch("/:accountId/chat/channels/:cid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, cid } = chParams.parse(request.params);
    const b = z.object({ name: name.optional(), topic: z.string().trim().max(TEAM_BOUNDS.topicLength).optional(), archived: z.boolean().optional() }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const ch = await channel(accountId, cid, m);
    if (ch.kind === "DM") throw new ValidationError("Direct messages have no settings");
    if (!m.isAdmin && ch.createdById !== m.userId) throw new ForbiddenError("Only the channel's creator and owners/admins can change it");
    if (ch.name === "general" && (b.archived || (b.name && b.name !== "general"))) throw new ValidationError("#general can't be renamed or archived");
    try {
      await db.teamChannel.update({ where: { id: cid }, data: { ...(b.name ? { name: b.name } : {}), ...(b.topic !== undefined ? { topic: b.topic } : {}), ...(b.archived !== undefined ? { archivedAt: b.archived ? new Date() : null } : {}) } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw new ConflictError(`#${b.name} already exists`);
      throw err;
    }
    await t.emit(accountId, "channel", { channelId: cid }, await audience(ch));
    return successResponse(reply, "Saved", 200, { id: cid });
  });

  fastify.delete("/:accountId/chat/channels/:cid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, cid } = chParams.parse(request.params);
    const m = await t.member(request, accountId);
    const ch = await channel(accountId, cid, m);
    if (!m.isAdmin) throw new ForbiddenError("Only owners and admins can delete channels");
    if (ch.name === "general" && ch.kind === "CHANNEL") throw new ValidationError("#general can't be deleted");
    const who = await audience(ch);
    await db.teamChannel.delete({ where: { id: cid } });
    await t.emit(accountId, "channel.deleted", { channelId: cid }, who);
    return successResponse(reply, "Deleted", 200, { id: cid });
  });

  fastify.post("/:accountId/chat/channels/:cid/join", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, cid } = chParams.parse(request.params);
    const m = await t.member(request, accountId);
    await channel(accountId, cid, m);
    await db.teamChannelMember.upsert({ where: { channelId_userId: { channelId: cid, userId: m.userId } }, create: { channelId: cid, userId: m.userId, accountId }, update: { joined: true } });
    return successResponse(reply, "Joined", 200, { id: cid });
  });

  fastify.post("/:accountId/chat/channels/:cid/leave", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, cid } = chParams.parse(request.params);
    const m = await t.member(request, accountId);
    const ch = await channel(accountId, cid, m);
    if (ch.name === "general" && ch.kind === "CHANNEL") throw new ValidationError("Everyone stays in #general");
    if (ch.kind === "CHANNEL" && !ch.isPrivate) await db.teamChannelMember.updateMany({ where: { channelId: cid, userId: m.userId }, data: { joined: false } });
    else await db.teamChannelMember.deleteMany({ where: { channelId: cid, userId: m.userId } });
    await t.emit(accountId, "channel", { channelId: cid }, [m.userId]);
    return successResponse(reply, "Left", 200, { id: cid });
  });

  fastify.post("/:accountId/chat/channels/:cid/members", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, cid } = chParams.parse(request.params);
    const { userIds } = z.object({ userIds: z.array(z.string().uuid()).min(1).max(100) }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const ch = await channel(accountId, cid, m, { write: true });
    if (ch.kind === "DM") throw new ValidationError("Start a new conversation to include more people");
    const valid = (await db.accountMember.findMany({ where: { accountId, userId: { in: userIds } }, select: { userId: true } })).map((x: { userId: string }) => x.userId);
    for (const userId of valid) await db.teamChannelMember.upsert({ where: { channelId_userId: { channelId: cid, userId } }, create: { channelId: cid, userId, accountId }, update: { joined: true } });
    await t.emit(accountId, "channel", { channelId: cid }, await audience(ch));
    return successResponse(reply, "Added", 200, { added: valid.length });
  });

  fastify.post("/:accountId/chat/dms", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const { userIds } = z.object({ userIds: z.array(z.string().uuid()).min(1).max(TEAM_BOUNDS.dmMembers - 1) }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const all = [...new Set([m.userId, ...userIds])].sort();
    const valid = await db.accountMember.count({ where: { accountId, userId: { in: all } } });
    if (valid !== all.length) throw new ValidationError("Everyone in a direct message must be in this workspace");
    const dmKey = all.join("|");
    let ch = await db.teamChannel.findFirst({ where: { accountId, dmKey } });
    if (!ch) {
      try {
        ch = await db.teamChannel.create({ data: { accountId, kind: "DM", dmKey, isPrivate: true, createdById: m.userId, members: { create: all.map((userId) => ({ userId, accountId })) } } });
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err;
        ch = await db.teamChannel.findFirst({ where: { accountId, dmKey } });
      }
    }
    return successResponse(reply, "Success", 200, { id: ch.id });
  });

  fastify.get("/:accountId/chat/channels/:cid/messages", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, cid } = chParams.parse(request.params);
    const q = z.object({ before: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query ?? {});
    const m = await t.member(request, accountId);
    const ch = await channel(accountId, cid, m);
    const lim = await t.limits(accountId);
    const cutoff = t.historyCutoff(lim.historyDays);
    const rows = (await db.teamMessage.findMany({
      where: { channelId: cid, parentId: null, createdAt: { gt: cutoff, ...(q.before ? { lt: q.before } : {}) } },
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
    })) as Message[];
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit).reverse();
    const hidden = !more && lim.historyDays ? await db.teamMessage.count({ where: { channelId: cid, parentId: null, createdAt: { lte: cutoff } } }) : 0;
    const me = await db.teamChannelMember.findUnique({ where: { channelId_userId: { channelId: cid, userId: m.userId } }, select: { lastReadAt: true, joined: true } });
    return successResponse(reply, "Success", 200, {
      channel: { id: ch.id, name: ch.name, kind: ch.kind, topic: ch.topic, archived: !!ch.archivedAt },
      messages: await present(accountId, m.userId, page),
      hasMore: more,
      /** Older messages beyond the plan's history, kept but not shown. */
      hiddenByPlan: hidden,
      lastReadAt: me?.lastReadAt ?? null,
    });
  });

  fastify.get("/:accountId/chat/messages/:mid/thread", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, mid } = msgParams.parse(request.params);
    const m = await t.member(request, accountId);
    const root = (await db.teamMessage.findFirst({ where: { id: mid, accountId, parentId: null } })) as Message | null;
    if (!root) throw new NotFoundError("Message not found");
    await channel(accountId, root.channelId, m);
    const cutoff = t.historyCutoff((await t.limits(accountId)).historyDays);
    if (root.createdAt <= cutoff) throw new NotFoundError("This thread is older than your plan's chat history");
    const replies = (await db.teamMessage.findMany({ where: { parentId: mid }, orderBy: { createdAt: "asc" }, take: 500 })) as Message[];
    const [r, ...rest] = await present(accountId, m.userId, [root, ...replies]);
    return successResponse(reply, "Success", 200, { root: r, replies: rest });
  });

  fastify.post("/:accountId/chat/channels/:cid/messages", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, cid } = chParams.parse(request.params);
    const b = z.object({ body, parentId: z.string().uuid().optional() }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const ch = await channel(accountId, cid, m, { write: true });
    let root: Message | null = null;
    if (b.parentId) {
      root = await db.teamMessage.findFirst({ where: { id: b.parentId, channelId: cid, parentId: null, deletedAt: null } });
      if (!root) throw new NotFoundError("The message you reply to is gone");
    }
    const mentions = mentionsOf(b.body);
    const refs = refsInText(b.body, accountId);
    const now = new Date();
    const msg = (await db.$transaction(async (tx: Db) => {
      const created = await tx.teamMessage.create({ data: { accountId, channelId: cid, parentId: b.parentId ?? null, authorId: m.userId, body: b.body, mentions, refs: refs as never, createdAt: now } });
      if (root) await tx.teamMessage.update({ where: { id: root.id }, data: { replyCount: { increment: 1 }, lastReplyAt: now } });
      else await tx.teamChannel.update({ where: { id: cid }, data: { lastMessageAt: now } });
      // Writing in a channel joins it and marks it read for the author.
      await tx.teamChannelMember.upsert({ where: { channelId_userId: { channelId: cid, userId: m.userId } }, create: { channelId: cid, userId: m.userId, accountId, lastReadAt: now }, update: { joined: true, ...(root ? {} : { lastReadAt: now }) } });
      return created;
    })) as Message;
    const [view] = await present(accountId, m.userId, [msg]);
    const who = await audience(ch);
    await t.emit(accountId, "message", { channelId: cid, message: { ...view, cards: view.cards } }, who);

    // Notifications: mentions (only people who can see the channel), and thread replies to its participants.
    const names = await t.names([m.userId, ...mentions]);
    const visible = who.length ? mentions.filter((u) => who.includes(u)) : mentions;
    const where = ch.kind === "DM" ? "a direct message" : `#${ch.name}`;
    const path = `/organizations/${accountId}/team/chat?c=${cid}${root ? `&thread=${root.id}` : ""}`;
    const text = plainText(b.body, names);
    await t.notify(accountId, m.userId, visible, { type: "TEAM_MENTION", title: `${names[m.userId]} mentioned you in ${where}`, body: text, path, metadata: { channelId: cid, messageId: msg.id } });
    if (root) {
      const participants = [root.authorId, ...(await db.teamMessage.findMany({ where: { parentId: root.id }, distinct: ["authorId"], select: { authorId: true } })).map((x: { authorId: string }) => x.authorId)].filter((u) => !visible.includes(u) && (!who.length || who.includes(u)));
      await t.notify(accountId, m.userId, participants, { type: "TEAM_REPLY", title: `${names[m.userId]} replied in a thread in ${where}`, body: text, path, metadata: { channelId: cid, messageId: msg.id } });
    }
    return successResponse(reply, "Sent", 201, view);
  });

  fastify.patch("/:accountId/chat/messages/:mid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, mid } = msgParams.parse(request.params);
    const b = z.object({ body }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const msg = (await db.teamMessage.findFirst({ where: { id: mid, accountId, deletedAt: null } })) as Message | null;
    if (!msg) throw new NotFoundError("Message not found");
    if (msg.authorId !== m.userId) throw new ForbiddenError("Only the author can edit a message");
    const ch = await channel(accountId, msg.channelId, m, { write: true });
    const before = new Set(msg.mentions);
    const mentions = mentionsOf(b.body);
    const updated = (await db.teamMessage.update({ where: { id: mid }, data: { body: b.body, mentions, refs: refsInText(b.body, accountId) as never, editedAt: new Date() } })) as Message;
    const [view] = await present(accountId, m.userId, [updated]);
    const who = await audience(ch);
    await t.emit(accountId, "message.edited", { channelId: ch.id, message: view }, who);
    const added = mentions.filter((u) => !before.has(u) && (!who.length || who.includes(u)));
    if (added.length) {
      const names = await t.names([m.userId, ...added]);
      await t.notify(accountId, m.userId, added, { type: "TEAM_MENTION", title: `${names[m.userId]} mentioned you in ${ch.kind === "DM" ? "a direct message" : `#${ch.name}`}`, body: plainText(b.body, names), path: `/organizations/${accountId}/team/chat?c=${ch.id}${msg.parentId ? `&thread=${msg.parentId}` : ""}` });
    }
    return successResponse(reply, "Saved", 200, view);
  });

  fastify.delete("/:accountId/chat/messages/:mid", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, mid } = msgParams.parse(request.params);
    const m = await t.member(request, accountId);
    const msg = (await db.teamMessage.findFirst({ where: { id: mid, accountId, deletedAt: null } })) as Message | null;
    if (!msg) throw new NotFoundError("Message not found");
    const ch = await channel(accountId, msg.channelId, m);
    if (msg.authorId !== m.userId && !m.isAdmin) throw new ForbiddenError("Only the author and owners/admins can delete a message");
    // Kept as "deleted" so threads and replies stay in place.
    await db.teamMessage.update({ where: { id: mid }, data: { body: "", mentions: [], refs: [], reactions: {}, deletedAt: new Date() } });
    await t.emit(accountId, "message.deleted", { channelId: ch.id, messageId: mid, parentId: msg.parentId }, await audience(ch));
    return successResponse(reply, "Deleted", 200, { id: mid });
  });

  fastify.post("/:accountId/chat/messages/:mid/reactions", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, mid } = msgParams.parse(request.params);
    const { emoji } = z.object({ emoji: z.string().trim().min(1).max(TEAM_BOUNDS.emojiLength) }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await t.writable(accountId);
    const msg = (await db.teamMessage.findFirst({ where: { id: mid, accountId, deletedAt: null } })) as Message | null;
    if (!msg) throw new NotFoundError("Message not found");
    const ch = await channel(accountId, msg.channelId, m, { write: true });
    // Toggle in one statement so two people reacting at once both count.
    const rows: Array<{ reactions: Record<string, string[]> }> = await db.$queryRawUnsafe(
      `UPDATE "team_messages" SET "reactions" = CASE
           WHEN COALESCE("reactions"->$2::text, '[]'::jsonb) ? $3::text
             THEN CASE WHEN jsonb_array_length(("reactions"->$2::text) - $3::text) = 0 THEN "reactions" - $2::text ELSE jsonb_set("reactions", ARRAY[$2::text], ("reactions"->$2::text) - $3::text) END
           WHEN (SELECT count(*) FROM jsonb_object_keys("reactions")) >= $4::int AND NOT ("reactions" ? $2::text) THEN "reactions"
           ELSE jsonb_set("reactions", ARRAY[$2::text], COALESCE("reactions"->$2::text, '[]'::jsonb) || to_jsonb($3::text))
         END
       WHERE "id" = $1 RETURNING "reactions"`,
      mid,
      emoji,
      m.userId,
      TEAM_BOUNDS.reactionsPerMessage,
    );
    const reactions = rows[0]?.reactions ?? {};
    const view = Object.entries(reactions).map(([e, users]) => ({ emoji: e, count: users.length, mine: users.includes(m.userId), users: users.slice(0, 10) }));
    await t.emit(accountId, "reaction", { channelId: ch.id, messageId: mid, parentId: msg.parentId, reactions }, await audience(ch));
    return successResponse(reply, "Success", 200, { id: mid, reactions: view });
  });

  fastify.post("/:accountId/chat/channels/:cid/read", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId, cid } = chParams.parse(request.params);
    const m = await t.member(request, accountId);
    const ch = await channel(accountId, cid, m);
    const now = new Date();
    await db.teamChannelMember.upsert({ where: { channelId_userId: { channelId: cid, userId: m.userId } }, create: { channelId: cid, userId: m.userId, accountId, lastReadAt: now, joined: ch.kind !== "CHANNEL" || ch.isPrivate }, update: { lastReadAt: now } });
    // Mention notifications of this channel are read too.
    await db.notification.updateMany({ where: { userId: m.userId, accountId, readAt: null, type: { in: ["TEAM_MENTION", "TEAM_REPLY"] }, metadata: { path: ["channelId"], equals: cid } }, data: { readAt: now, status: "READ" } }).catch(() => undefined);
    await t.emit(accountId, "read", { channelId: cid }, [m.userId]);
    return successResponse(reply, "Read", 200, { id: cid, lastReadAt: now });
  });

  fastify.post("/:accountId/chat/channels/:cid/typing", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId, cid } = chParams.parse(request.params);
    const { parentId } = z.object({ parentId: z.string().uuid().optional() }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    const ch = await channel(accountId, cid, m, { write: true });
    const names = await t.names([m.userId]);
    await t.emit(accountId, "typing", { channelId: cid, parentId: parentId ?? null, userId: m.userId, name: names[m.userId] }, await audience(ch));
    return successResponse(reply, "Success", 200, {});
  });

  fastify.get("/:accountId/search", { onRequest: [fastify.userAuthGuard], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(request.query ?? {});
    const m = await t.member(request, accountId);
    const lim = await t.limits(accountId);
    const like = { contains: q, mode: "insensitive" as const };
    const [messages, docs, issues] = await Promise.all([
      db.teamMessage.findMany({
        where: { accountId, deletedAt: null, body: like, createdAt: { gt: t.historyCutoff(lim.historyDays) }, channel: { OR: [{ kind: "CHANNEL", isPrivate: false }, { members: { some: { userId: m.userId } } }] } },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { channel: { select: { name: true, kind: true } } },
      }),
      db.teamDoc.findMany({ where: { accountId, OR: [{ title: like }, { body: like }] }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, title: true, body: true, updatedAt: true } }),
      db.teamIssue.findMany({ where: { accountId, OR: [{ title: like }, { body: like }, ...(/^#?\d+$/.test(q) ? [{ number: Number(q.replace("#", "")) }] : [])] }, orderBy: { updatedAt: "desc" }, take: 20, select: { number: true, title: true, body: true, status: true } }),
    ]);
    const names = await t.names([...new Set(messages.map((x: Message) => x.authorId))] as string[]);
    return successResponse(reply, "Success", 200, {
      messages: messages.map((x: Message & { channel: { name: string | null; kind: string } }) => ({ id: x.id, channelId: x.channelId, parentId: x.parentId, channel: x.channel.kind === "DM" ? "direct message" : `#${x.channel.name}`, author: names[x.authorId] ?? "Former member", excerpt: excerpt(plainText(x.body, names), q), createdAt: x.createdAt })),
      docs: docs.map((d: { id: string; title: string; body: string; updatedAt: Date }) => ({ id: d.id, title: d.title, excerpt: excerpt(d.body, q), updatedAt: d.updatedAt })),
      issues: issues.map((i: { number: number; title: string; body: string; status: string }) => ({ number: i.number, title: i.title, status: i.status, excerpt: excerpt(i.body, q) })),
    });
  });

  fastify.get("/:accountId/prefs", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const m = await t.member(request, accountId);
    const p = await db.teamMemberPref.findUnique({ where: { userId_accountId: { userId: m.userId, accountId } } });
    return successResponse(reply, "Success", 200, { emailDigest: p?.emailDigest ?? true });
  });

  fastify.put("/:accountId/prefs", { onRequest: [fastify.userAuthGuard] }, async (request, reply) => {
    const { accountId } = params.parse(request.params);
    const { emailDigest } = z.object({ emailDigest: z.boolean() }).parse(request.body ?? {});
    const m = await t.member(request, accountId);
    await db.teamMemberPref.upsert({ where: { userId_accountId: { userId: m.userId, accountId } }, create: { userId: m.userId, accountId, emailDigest }, update: { emailDigest } });
    return successResponse(reply, "Saved", 200, { emailDigest });
  });
}
