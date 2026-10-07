// Live updates for the team space over WebSocket: GET /api/v1/team/ws.
//
// Protocol (JSON text frames):
//   client -> { type: "auth", token, accountId }      first frame, within 10 s
//   server -> { type: "ready" } | { type: "error", message } then close
//   server -> { type: "event", seq, kind, payload }   chat, docs and issues changes
//   client -> { type: "ping" }  server -> { type: "pong" }
//
// Fan-out works across API instances without a pub/sub service: routes write
// a TeamEvent row; every instance polls rows newer than the last it saw (once
// a second while it has sockets) and pushes each to its sockets of that
// workspace, filtered by the event's audience (private channels, DMs). A
// socket re-checks its sign-in and membership every minute and closes when
// either is gone. Events are kept a day.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";

import { eventVisibleTo } from "@vhyxvoid/shared";
import type { Db } from "./team.shared";

export const TEAM_WS_PATH = "/api/v1/team/ws";
const POLL_MS = 1_000;
const RECHECK_MS = 60_000;
const AUTH_TIMEOUT_MS = 10_000;
const KEEP_EVENTS_MS = 24 * 3_600_000;
const MAX_SOCKETS_PER_USER = 10;

/** Who a token belongs to, or null (expired, revoked, not a user token). */
export type Authenticate = (token: string) => Promise<{ userId: string } | null>;

type Client = { ws: WebSocket; userId: string; accountId: string; alive: boolean };

export function createTeamRealtime(db: Db, authenticate: Authenticate, log: Pick<FastifyInstance["log"], "warn"> = console) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Set<Client>();
  let lastSeq: bigint | null = null;
  let polling = false;
  let timer: NodeJS.Timeout | null = null;
  let recheck: NodeJS.Timeout | null = null;
  let lastPrune = 0;

  const send = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const isMember = async (userId: string, accountId: string) => !!(await db.accountMember.findUnique({ where: { userId_accountId: { userId, accountId } }, select: { userId: true } }));

  async function pollOnce(): Promise<number> {
    if (polling) return 0;
    polling = true;
    try {
      if (lastSeq === null) {
        const top = await db.teamEvent.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
        lastSeq = top?.seq ?? 0n;
        return 0;
      }
      const rows: Array<{ seq: bigint; accountId: string; kind: string; userIds: string[]; payload: unknown }> = await db.teamEvent.findMany({ where: { seq: { gt: lastSeq } }, orderBy: { seq: "asc" }, take: 500 });
      for (const e of rows) {
        lastSeq = e.seq;
        for (const c of clients) if (c.accountId === e.accountId && eventVisibleTo(e, c.userId)) send(c.ws, { type: "event", seq: String(e.seq), kind: e.kind, payload: e.payload });
      }
      if (Date.now() - lastPrune > 10 * 60_000) {
        lastPrune = Date.now();
        await db.teamEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_EVENTS_MS) } } });
      }
      return rows.length;
    } catch (err) {
      log.warn({ err }, "[team] realtime poll failed");
      return 0;
    } finally {
      polling = false;
    }
  }

  function ensureLoops() {
    if (!timer) {
      timer = setInterval(() => void pollOnce(), POLL_MS);
      timer.unref?.();
    }
    if (!recheck) {
      recheck = setInterval(async () => {
        for (const c of clients) {
          // Dead connections (no pong since the last round) are dropped.
          if (!c.alive) {
            c.ws.terminate();
            continue;
          }
          c.alive = false;
          c.ws.ping();
          if (!(await isMember(c.userId, c.accountId).catch(() => true))) {
            send(c.ws, { type: "error", message: "You are no longer in this workspace" });
            c.ws.close(4403, "not a member");
          }
        }
      }, RECHECK_MS);
      recheck.unref?.();
    }
  }
  function stopLoopsIfIdle() {
    if (clients.size) return;
    if (timer) clearInterval(timer);
    if (recheck) clearInterval(recheck);
    timer = recheck = null;
    lastSeq = null; // re-read the head next time, so an idle instance never replays a backlog
  }

  wss.on("connection", (ws: WebSocket) => {
    let client: Client | null = null;
    const authTimer = setTimeout(() => !client && ws.close(4401, "auth timeout"), AUTH_TIMEOUT_MS);
    ws.on("message", async (raw) => {
      let msg: { type?: string; token?: string; accountId?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return ws.close(4400, "bad frame");
      }
      if (msg.type === "ping") return send(ws, { type: "pong" });
      if (msg.type !== "auth" || client) return;
      const who = typeof msg.token === "string" ? await authenticate(msg.token).catch(() => null) : null;
      const accountId = typeof msg.accountId === "string" && /^[0-9a-f-]{36}$/i.test(msg.accountId) ? msg.accountId : "";
      if (!who || !accountId || !(await isMember(who.userId, accountId).catch(() => false))) {
        send(ws, { type: "error", message: "Not signed in to this workspace" });
        return ws.close(4401, "unauthorized");
      }
      if ([...clients].filter((c) => c.userId === who.userId).length >= MAX_SOCKETS_PER_USER) {
        send(ws, { type: "error", message: "Too many open tabs" });
        return ws.close(4429, "too many sockets");
      }
      clearTimeout(authTimer);
      client = { ws, userId: who.userId, accountId, alive: true };
      clients.add(client);
      ensureLoops();
      if (lastSeq === null) await pollOnce();
      send(ws, { type: "ready" });
    });
    ws.on("pong", () => client && (client.alive = true));
    ws.on("close", () => {
      clearTimeout(authTimer);
      if (client) clients.delete(client);
      stopLoopsIfIdle();
    });
    ws.on("error", () => ws.terminate());
  });

  return {
    /** Hand an HTTP upgrade to the socket server when it is for TEAM_WS_PATH. */
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      if ((req.url ?? "").split("?")[0] !== TEAM_WS_PATH) return false;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return true;
    },
    pollOnce,
    clientCount: () => clients.size,
    close() {
      for (const c of clients) c.ws.close(1001, "server shutting down");
      clients.clear();
      stopLoopsIfIdle();
      wss.close();
    },
  };
}
