// now let me share everything :
// // AGENTS :

// // utils/backoff.ts
// export async function withRetry(fn: () => Promise<any>, maxAttempts = 3) {
//   let attempt = 0;
//   while (true) {
//     try {
//       return await fn();
//     } catch (err) {
//       attempt++;
//       if (attempt >= maxAttempts) throw err;
//       const base = 200 * Math.pow(2, attempt); // ms
//       const jitter = Math.floor(Math.random() * 100);
//       await new Promise((r) => setTimeout(r, base + jitter));
//     }
//   }
// }

// // apps/agent/src/forward.ts
// import axios from "axios";

// export async function forwardToLocalBackend(msg: any) {
//   const host = process.env.BACKEND_HOST || "localhost";
//   const port = process.env.BACKEND_PORT || "5050";
//   const url = `http://${host}:${port}${msg.path || "/"}`;

//   const data = msg.isBase64
//     ? Buffer.from(msg.body, "base64")
//     : msg.body ?? undefined;

//   const r = await axios.request({
//     url,
//     method: msg.method || "GET",
//     headers: msg.headers || {},
//     data,
//     timeout: 15000,
//     responseType: "arraybuffer",
//   });

//   return {
//     status: r.status,
//     headers: r.headers,
//     body: Buffer.from(r.data).toString("base64"),
//   };
// }

// import WebSocket from "ws";
// import dotenv from "dotenv";
// import { handleRequestMessage, replayQueue } from "./router";
// import { v4 as uuidv4 } from "uuid";

// dotenv.config();

// const HUB_URL = process.env.HUB_URL || "ws://localhost:9000/ws";
// const AGENT_ID = process.env.AGENT_ID || `agent-${uuidv4()}`;
// const BACKEND_KEY = process.env.BACKEND_KEY || "dev_backend_key";
// const PING_INTERVAL = 10000;

// let lastPong = Date.now();
// let ws: WebSocket | null = null;

// function connect() {
//   ws = new WebSocket(HUB_URL);

//   ws.on("open", async () => {
//     console.log("[agent] connected to hub", HUB_URL);
//     ws!.send(
//       JSON.stringify({
//         type: "register",
//         agentId: AGENT_ID,
//         backendKey: BACKEND_KEY,
//       })
//     );
//     try {
//       await replayQueue();
//     } catch (e) {
//       console.error("[agent] replayQueue error", e);
//     }
//   });

//   ws.on("message", async (data) => {
//     try {
//       const msg = JSON.parse(data.toString());
//       if (msg.type === "request") {
//         const resp = await handleRequestMessage(msg);
//         // resp: { status, headers, body } (body base64)
//         ws!.send(
//           JSON.stringify({
//             type: "response",
//             requestId: msg.requestId,
//             status: resp.status,
//             headers: resp.headers,
//             body: resp.body,
//           })
//         );
//       } else if (msg.type === "ping") {
//         // ws!.send(JSON.stringify({ type: "pong" }));
//         ws?.send(
//           JSON.stringify({ type: "pong", agentId: AGENT_ID, ts: Date.now() })
//         );
//       }
//     } catch (e) {
//       console.error("[agent] msg parse", e);
//     }
//   });

//   setInterval(() => {
//     try {
//       ws?.send(
//         JSON.stringify({ type: "heartbeat", agentId: AGENT_ID, ts: Date.now() })
//       );
//     } catch {}
//   }, PING_INTERVAL);

//   ws.on("close", () => {
//     console.log("[agent] disconnected. reconnecting in 1s");
//     setTimeout(connect, 1000);
//   });

//   ws.on("error", (err) => console.error("[agent] ws error", err));
// }

// connect();

// const QPATH = path.resolve(process.cwd(), "hub-queue.jsonl");


// export function pushToQueue(obj: any) {
//   fs.appendFileSync(QPATH, JSON.stringify(obj) + "\n", { encoding: "utf8" });
// }

// export function readQueue(): any[] {
//   if (!fs.existsSync(QPATH)) return [];
//   const data = fs.readFileSync(QPATH, "utf8").trim();
//   if (!data) return [];
//   return data.split("\n").map((line) => JSON.parse(line));
// }

// export function clearQueue() {
//   if (fs.existsSync(QPATH)) fs.unlinkSync(QPATH);
// }

// async function replayQueue() {
//   const items = readQueue();
//   if (!items.length) return;
//   for (const it of items) {
//     try {
//       // forward to local backend using same forward function (no ws)
//       //   await forwardToLocalBackend(it.msg);
//       // if success continue
//     } catch (e) {
//       console.log("[agent] replay failed, keeping queue");
//       return; // stop replay until backend fixed
//     }
//   }
//   clearQueue();
// }
// replayQueue();

// async function replayQueue() {
//   const items = readQueue();
//   if (!items.length) return;
//   for (const it of items) {
//     try {
//       // forward to local backend using same forward function (no ws)
//       await forwardToLocalBackend(it.msg);
//       // if success continue
//     } catch (e) {
//       console.log("[agent] replay failed, keeping queue");
//       return; // stop replay until backend fixed
//     }
//   }
//   clearQueue();
// }
// replayQueue();

// export async function handleRequestMessage(msg: any) {
//   const host = process.env.BACKEND_HOST || "localhost";
//   const port = process.env.BACKEND_PORT || "5050";
//   const url = `http://${host}:${port}${msg.path || "/"}`;

//   // If client sent body as object or base64, support both
//   let data: any = undefined;
//   if (msg.body != null) {
//     if (msg.isBase64) {
//       data = Buffer.from(msg.body, "base64");
//     } else {
//       data = msg.body;
//     }
//   }

//   try {
//     const r = await axios.request({
//       url,
//       method: (msg.method || "GET") as any,
//       headers: msg.headers || {},
//       data,
//       timeout: 15000,
//       responseType: "arraybuffer",
//     });

//     const headers: Record<string, string> = {};
//     for (const k in r.headers) headers[k] = String((r.headers as any)[k]);

//     const bodyBase64 = Buffer.from(r.data).toString("base64");
//     return { status: r.status, headers, body: bodyBase64 };
//   } catch (err: any) {
//     try {
//       pushToQueue({ msg, ts: Date.now() });
//       console.log("[agent] backend forward failed — queued");
//       // let frontend know we queued it (status 202)
//       return {
//         status: 202,
//         headers: { "content-type": "text/plain" },
//         body: Buffer.from("queued").toString("base64"),
//       };
//     } catch (qerr) {
//       console.error("[agent] queue push failed", qerr);
//       return {
//         status: 502,
//         headers: { "content-type": "text/plain" },
//         body: Buffer.from(String(err?.message || "error")).toString("base64"),
//       };
//     }
//   }
// }

// export async function replayQueue() {
//   const items = readQueue();
//   if (!items.length) return;
//   console.log(`[agent] replaying ${items.length} queued requests`);
//   for (const item of items) {
//     try {
//       await forwardToLocalBackend(item.msg);
//       // continue on success
//       console.log(
//         "[agent] replayed request ok",
//         item.msg.requestId || item.msg.path
//       );
//     } catch (e: any) {
//       console.log(
//         "[agent] replay failed — stopping, will try later",
//         e?.message || e
//       );
//       return; // stop replay to preserve order
//     }
//   }
//   // if all succeeded, clear queue
//   clearQueue();
// }

// // Hub :
// export function verifySignature(payload: {
//   method: string;
//   path: string;
//   bodyBase64?: string | null;
//   requestId: string;
//   ts: number;
//   signature: string;
//   frontendKey: string;
// }) {
//   const { method, path, bodyBase64, requestId, ts, signature, frontendKey } =
//     payload;
//   const secret = getFrontendSecret(frontendKey);
//   if (!secret) return false;

//   // reconstruct canonical string
//   const body = bodyBase64 ? Buffer.from(bodyBase64, "base64").toString() : "";
//   const bodyHash = body
//     ? crypto.createHash("sha256").update(body).digest("hex")
//     : "";
//   const canonical = `${method.toUpperCase()}|${path}|${bodyHash}|${requestId}|${ts}`;

//   const expected = crypto
//     .createHmac("sha256", secret)
//     .update(canonical)
//     .digest("hex");

//   // timing safe compare
//   try {
//     const a = Buffer.from(expected, "hex");
//     const b = Buffer.from(signature, "hex");
//     if (a.length !== b.length) return false;
//     if (!crypto.timingSafeEqual(a, b)) return false;
//   } catch {
//     return false;
//   }

//   const signatureMatch = crypto.timingSafeEqual(
//     Buffer.from(expected),
//     Buffer.from(signature)
//   );

//   // time window (ms)
//   const now = Date.now();
//   const delta = Math.abs(now - ts);
//   const MAX_WINDOW = Number(process.env.SIGNATURE_TIME_WINDOW_MS || 60_000);
//   if (delta > MAX_WINDOW) return false;

//   return signatureMatch;
// }

// import Fastify from "fastify";
// import { createWebSocketServer, routeRequestToAgent } from "./ws";
// import { initRedis } from "./redis";
// import dotenv from "dotenv";
// import { initKeyStoreFromEnv } from "./store";

// dotenv.config();
// initKeyStoreFromEnv();

// const server = Fastify({ logger: true });
// const PORT = Number(process.env.PORT || 9000);

// async function start() {
//   await initRedis(process.env.REDIS_URL || "redis://localhost:6379");

//   // simple HTTP health
//   server.get("/health", async () => ({ ok: true, ts: Date.now() }));

//   // optional HTTP proxy endpoint for simple tooling / curl / tests:
//   server.post("/hub", async (req, reply) => {
//     /* expected body:
//        { method, path, headers?, body?, agentId? }
//     */
//     const payload: any = req.body as any;
//     try {
//       const agentId = payload.agentId; // optional
//       const result = await routeRequestToAgent(agentId, {
//         method: payload.method || "GET",
//         path: payload.path || "/",
//         headers: payload.headers || {},
//         body: payload.body ?? null,
//       });

//       // result.body is base64
//       const buf = result.body
//         ? Buffer.from(result.body, "base64")
//         : Buffer.from("");
//       // try to parse JSON
//       let parsed: any = buf.toString();
//       try {
//         parsed = JSON.parse(parsed);
//       } catch {
//         /* keep string */
//       }

//       return reply.code(Number(result.status || 200)).send(parsed);
//     } catch (err: any) {
//       return reply.code(502).send({ error: err.message || "agent_error" });
//     }
//   });

//   await server.listen({ port: PORT, host: "0.0.0.0" });
//   console.log(`[hub] HTTP listening on ${PORT}`);

//   // attach websocket server (on same server)
//   createWebSocketServer(server.server as any, { path: "/ws" });
// }

// start().catch((e) => {
//   console.error(e);
//   process.exit(1);
// });

// import { getRedis } from "./redis";

// export async function allowRequest(
//   orgId: string,
//   capacity = 100,
//   refillSeconds = 60
// ) {
//   const redis = getRedis();
//   const key = `rate:${orgId}`;
//   const now = Date.now();
//   // simple token bucket approximation: counter with expiry
//   const cur = await redis.incr(key);
//   if (cur === 1) {
//     await redis.expire(key, refillSeconds);
//   }
//   return cur <= capacity;
// }
// import Redis from "ioredis";
// let client: Redis | null = null;

// export async function initRedis(url: string) {
//   if (client) return client;
//   client = new Redis(url);
//   client.on("connect", () => console.log("[hub] redis connected"));
//   client.on("error", (e) => console.error("[hub] redis error", e));
//   // wait ready
//   await new Promise<void>((resolve, reject) => {
//     const t = setTimeout(() => reject(new Error("redis_timeout")), 5000);
//     client!.once("ready", () => {
//       clearTimeout(t);
//       resolve();
//     });
//     client!.once("error", (e) => {
//       clearTimeout(t);
//       reject(e);
//     });
//   });
//   return client;
// }

// export function getRedis() {
//   if (!client) throw new Error("redis not initialized");
//   return client;
// }

// type FrontKey = { key: string; secret: string };

// const FRONTEND_KEYS: Map<string, string> = new Map();

// export function initKeyStoreFromEnv() {
//   const v = process.env.FRONTEND_KEYS || "";
//   if (!v) return;
//   const pairs = v.split(",");
//   for (const p of pairs) {
//     const [k, s] = p.split(":");
//     if (k && s) FRONTEND_KEYS.set(k.trim(), s.trim());
//   }
//   console.log(
//     "[store] loaded frontend keys:",
//     Array.from(FRONTEND_KEYS.keys())
//   );
// }

// export function getFrontendSecret(frontendKey: string): string | null {
//   return FRONTEND_KEYS.get(frontendKey) ?? null;
// }

// // helper to add keys programmatically (used by dashboard later)
// export function addFrontendKey(key: string, secret: string) {
//   FRONTEND_KEYS.set(key, secret);
//   return true;
// }

// export interface AgentSession {
//   ws: WebSocket;
//   missed: number;
//   lastSeen: number;
// }

// export const AGENTS: Map<string, AgentSession> = new Map();

// const HEARTBEAT_INTERVAL = 10000; // 10s
// const HEARTBEAT_TIMEOUTS = 3; // miss 3 -> offline

// // call this once after server starts
// export function startHeartbeatLoop() {
//   setInterval(() => {
//     const now = Date.now();
//     for (const [agentId, a] of AGENTS) {
//       try {
//         a.ws.send(JSON.stringify({ type: "ping", ts: now }));
//         // set a promise / timestamp/state for expected pong
//         if (!a.missed) a.missed = 0;
//       } catch {
//         a.missed = (a.missed || 0) + 1;
//       }
//     }
//     // check missed counts
//     for (const [agentId, a] of AGENTS) {
//       if ((a.missed || 0) >= HEARTBEAT_TIMEOUTS) {
//         console.log(
//           `[hub] marking agent ${agentId} offline (missed ${a.missed})`
//         );
//         AGENTS.delete(agentId);
//         // emit event to watchers if dashboard subscribes
//       }
//     }
//   }, HEARTBEAT_INTERVAL);
// }

// export function runHeartbeatCheck() {
//   const now = Date.now();
//   for (const [agentId, a] of AGENTS) {
//     try {
//       a.ws.send(JSON.stringify({ type: "ping", ts: now }));
//       if (!a.missed) a.missed = 0;
//     } catch {
//       a.missed = (a.missed || 0) + 1;
//     }
//   }
//   for (const [agentId, a] of AGENTS) {
//     if ((a.missed || 0) >= HEARTBEAT_TIMEOUTS) {
//       AGENTS.delete(agentId);
//     }
//   }
// }

// export function handlePong(agentId: string) {
//   if (!AGENTS.has(agentId)) return;
//   const a = AGENTS.get(agentId)!;
//   a.missed = 0;
//   a.lastSeen = Date.now();
// }

// type AgentConn = {
//   agentId: string;
//   backendKey?: string;
//   ws: WebSocket;
//   lastSeen: number;
// };
// type FrontendConn = {
//   frontendId: string;
//   apiKey?: string;
//   ws: WebSocket;
//   lastSeen: number;
// };
// type Pending = {
//   resolve: (r: any) => void;
//   reject: (e: any) => void;
//   timeout: NodeJS.Timeout;
// };
// const AGENTS = new Map<string, AgentConn>();
// const FRONTENDS = new Map<string, FrontendConn>();

// const PENDING = new Map<string, Pending>();

// export function createWebSocketServer(
//   server: http.Server,
//   opts?: { path?: string }
// ) {
//   const path = opts?.path ?? "/ws";
//   const wss = new WebSocketServer({ server, path });
//   console.log(`[hub] WS ready at ${path}`);

//   wss.on("connection", (ws: WebSocket) => {
//     const connId = uuidv4();
//     console.log(`[hub] ws connection ${connId}`);

//     ws.on("message", (data) => {
//       try {
//         const msg = JSON.parse(data.toString());
//         handleMessage(ws, msg);
//       } catch (e) {
//         console.warn("[hub] invalid ws message", e);
//         ws.send(JSON.stringify({ type: "error", error: "invalid_json" }));
//       }
//     });

//     ws.on("close", () => {
//       // cleanup maps
//       for (const [k, v] of AGENTS)
//         if (v.ws === ws) {
//           AGENTS.delete(k);
//           console.log("[hub] agent disconnected", k);
//         }
//       for (const [k, v] of FRONTENDS)
//         if (v.ws === ws) {
//           FRONTENDS.delete(k);
//           console.log("[hub] frontend disconnected", k);
//         }
//     });

//     ws.on("error", (e) => console.error("[hub] ws error", e));
//   });
// }

// function handleMessage(ws: WebSocket, msg: any) {
//   if (!msg || !msg.type)
//     return ws.send(JSON.stringify({ type: "error", error: "missing_type" }));
//   // if (msg.type === "pong") {
//   //   handlePong(msg.agentId);
//   //   return;
//   // }
//   switch (msg.type) {
//     case "register":
//     case "register_agent": {
//       const agentId = msg.agentId || uuidv4();
//       AGENTS.set(agentId, {
//         agentId,
//         backendKey: msg.backendKey,
//         ws,
//         lastSeen: Date.now(),
//       });
//       ws.send(JSON.stringify({ type: "registered", agentId }));
//       console.log("[hub] agent registered", agentId);
//       return;
//     }

//     case "register_frontend":
//     case "register_front": {
//       const frontendId = msg.frontendId || uuidv4();
//       FRONTENDS.set(frontendId, {
//         frontendId,
//         apiKey: msg.apiKey,
//         ws,
//         lastSeen: Date.now(),
//       });
//       ws.send(JSON.stringify({ type: "frontend_registered", frontendId }));
//       console.log("[hub] frontend registered", frontendId);
//       return;
//     }

//     case "request": {
//       return handleFrontendRequest(ws, msg);
//     }

//     case "response": {
//       return handleAgentResponse(msg);
//     }

//     case "heartbeat": {
//       if (msg.agentId && AGENTS.has(msg.agentId))
//         AGENTS.get(msg.agentId)!.lastSeen = Date.now();
//       if (msg.frontendId && FRONTENDS.has(msg.frontendId))
//         FRONTENDS.get(msg.frontendId)!.lastSeen = Date.now();
//       return;
//     }

//     case "pong": {
//       handlePong(msg.agentId);
//       return;
//     }

//     default:
//       return ws.send(JSON.stringify({ type: "error", error: "unknown_type" }));
//   }
// }

// function handleFrontendRequest(ws: WebSocket, msg: any) {
//   const targetAgentId =
//     msg.agentId || (AGENTS.size === 1 ? Array.from(AGENTS.keys())[0] : null);
//   const requestId = msg.requestId || uuidv4();
//   msg.requestId = requestId;

//   // Signature metadata expected in msg.meta or msg.signature fields:
//   // msg.meta = { frontendKey, signature, ts }
//   const meta = msg.meta || {};
//   const frontendKey = meta.frontendKey || msg.frontendKey || null;
//   const signature = meta.signature || msg.signature || null;
//   const ts = meta.ts || msg.ts || null;

//   if (!frontendKey || !signature || !ts) {
//     ws.send(
//       JSON.stringify({ type: "error", error: "missing_signature", requestId })
//     );
//     return;
//   }

//   const ok = verifySignature({
//     method: msg.method || "GET",
//     path: msg.path || "/",
//     bodyBase64: msg.body || null,
//     requestId,
//     ts,
//     signature,
//     frontendKey,
//   });

//   if (!ok) {
//     ws.send(
//       JSON.stringify({
//         type: "error",
//         error: "invalid_signature",
//         requestId,
//         code: 403,
//       })
//     );
//     return;
//   }

//   if (!targetAgentId || !AGENTS.has(targetAgentId)) {
//     ws.send(
//       JSON.stringify({ type: "error", error: "agent_not_found", requestId })
//     );
//     return;
//   }

//   routeRequestToAgent(targetAgentId, msg)
//     .then((agentResp) => {
//       try {
//         ws.send(JSON.stringify({ type: "response", requestId, ...agentResp }));
//       } catch (e) {
//         console.error("[hub] failed send to frontend", e);
//       }
//     })
//     .catch((err) => {
//       try {
//         ws.send(
//           JSON.stringify({
//             type: "error",
//             error: err.message || "agent_error",
//             requestId,
//           })
//         );
//       } catch {}
//     });
// }

// export function routeRequestToAgent(
//   agentId: string | undefined,
//   payload: any
// ): Promise<any> {
//   return new Promise((resolve, reject) => {
//     if (!agentId) return reject(new Error("no_agent"));
//     const agent = AGENTS.get(agentId);
//     if (!agent) return reject(new Error("agent_offline"));

//     const rid = payload.requestId || uuidv4();
//     payload.requestId = rid;

//     const timeout = setTimeout(() => {
//       PENDING.delete(rid);
//       reject(new Error("timeout"));
//     }, 30000);

//     PENDING.set(rid, { resolve, reject, timeout });

//     try {
//       agent.ws.send(JSON.stringify({ type: "request", ...payload }));
//     } catch (e) {
//       clearTimeout(timeout);
//       PENDING.delete(rid);
//       reject(new Error("send_failed"));
//     }
//   });
// }

// function handleAgentResponse(msg: any) {
//   const { requestId } = msg;
//   if (!requestId) return console.warn("[hub] response missing requestId");

//   const pending = PENDING.get(requestId);
//   if (!pending) return console.warn("[hub] no pending request", requestId);

//   clearTimeout(pending.timeout);
//   PENDING.delete(requestId);
//   pending.resolve({
//     status: msg.status,
//     headers: msg.headers || {},
//     body: msg.body || null,
//   });
// }

// // SDK :
// import crypto from "crypto";

// export function buildSignature({
//   method,
//   path,
//   body,
//   requestId,
//   ts,
//   secret,
// }: {
//   method: string;
//   path: string;
//   body?: string | null;
//   requestId: string;
//   ts: number;
//   secret: string;
// }) {
//   const bodyStr = body
//     ? typeof body === "string"
//       ? body
//       : JSON.stringify(body)
//     : "";

//   const bodyHash = bodyStr
//     ? crypto.createHash("sha256").update(bodyStr).digest("hex")
//     : "";
//   const canonical = `${method.toUpperCase()}|${path}|${bodyHash}|${requestId}|${ts}`;
//   const sig = crypto
//     .createHmac("sha256", secret)
//     .update(canonical)
//     .digest("hex");
//   return { sig, ts, canonical };
// }

// const client = new HubClient({
//   hubUrl: process.env.HUB_URL || "ws://localhost:9000/ws",
//   apiKey: "front-demo",
// });
// client.connect();

// client.ws.onopen = () => {
//   console.log("WebSocket connection established.");
// };

// client.ws.onclose = () => {
//   console.log("WebSocket connection closed.");
// };

// client.ws.onerror = (error) => {
//   console.error("WebSocket error:", error);
// };
// setTimeout(async () => {
//   try {
//     const res = await client.fetch("/hello", { method: "GET" });
//     const bodyBase64 = res.body || "";
//     const body = bodyBase64 ? Buffer.from(bodyBase64, "base64").toString() : "";
//     console.log("response", res.status, body);
//     process.exit(0);
//   } catch (e) {
//     console.error("fetch failed", e);
//     process.exit(1);
//   }
// }, 800);

// export class HubClient {
//   ws = null;
//   pending = new Map();
//   opts;
//   retries = 5; // Max retries
//   retryInterval = 2000; // Retry interval (2 seconds)

//   constructor(opts) {
//     this.opts = opts;
//     this.connect();
//   }

//   connect(retryCount = 0) {
//     this.ws = new WebSocket(this.opts.hubUrl);

//     this.ws.onopen = () => {
//       console.log("WebSocket connected");
//       this.sendFrontendRegisterMessage();
//     };

//     this.ws.onmessage = (ev) => {
//       try {
//         const msg = JSON.parse(ev.data);
//         console.log("Received message:", msg);

//         if (msg.type === "response" && msg.requestId) {
//           const pendingRequest = this.pending.get(msg.requestId);

//           if (pendingRequest) {
//             const { resolve, reject } = pendingRequest;

//             // Ensure resolve is a function
//             if (typeof resolve === "function") {
//               this.pending.delete(msg.requestId); // Remove from pending map
//               resolve(msg);
//             } else {
//               console.error(
//                 `No resolve function for requestId: ${msg.requestId}`
//               );
//             }
//           } else {
//             console.error(
//               `No pending request found for requestId: ${msg.requestId}`
//             );
//           }
//         }
//       } catch (err) {
//         console.error("Error parsing message:", err);
//       }
//     };

//     this.ws.onclose = () => {
//       if (retryCount < this.retries) {
//         console.log(
//           `WebSocket disconnected, retrying (${retryCount + 1}/${
//             this.retries
//           })...`
//         );
//         setTimeout(() => this.connect(retryCount + 1), this.retryInterval);
//       } else {
//         console.error("WebSocket failed to connect after multiple retries");
//       }
//     };

//     this.ws.onerror = (err) => {
//       console.error("WebSocket error", err);
//     };
//   }

//   sendFrontendRegisterMessage() {
//     if (this.ws.readyState === WebSocket.OPEN) {
//       this.ws.send(
//         JSON.stringify({ type: "frontend_register", apiKey: this.opts.apiKey })
//       );
//     } else {
//       console.error("WebSocket is not open yet. Message not sent.");
//     }
//   }

//   async fetch(path, opts = {}) {
//     if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
//       console.log("WebSocket is not open yet, waiting for connection...");
//       await new Promise((resolve) => {
//         const checkConnectionInterval = setInterval(() => {
//           if (this.ws?.readyState === WebSocket.OPEN) {
//             clearInterval(checkConnectionInterval);
//             resolve();
//           }
//         }, 100); // Check every 100ms until the WebSocket is open
//       });
//     }

//     const id = randomUUID();
//     const ts = Date.now();
//     const secret = process.env.BRIDGE_SECRET || "default_secret";
//     const frontendKey = process.env.FRONTEND_KEY || "default_frontend_key";
//     const signature = buildSignature({
//       method: opts.method || "GET",
//       path,
//       body: opts.body ?? null,
//       requestId: id,
//       ts,
//       secret,
//     });
//     const meta = { frontendKey, ts, signature };
//     const payloadWithMeta = { ...opts, requestId: id, meta };
//     const payload = {
//       type: "request",
//       requestId: id,
//       path,
//       method: opts.method || "GET",
//       headers: opts.headers || {},
//       body: opts.body ?? null,
//     };

//     return new Promise((resolve, reject) => {
//       console.log(`Sending request with id: ${id}`);
//       // Store both resolve and reject functions to handle the promise lifecycle
//       this.pending.set(id, { resolve, reject });

//       if (this.ws?.readyState === WebSocket.OPEN) {
//         this.ws.send(JSON.stringify(payloadWithMeta));
//       } else {
//         reject(new Error("WebSocket is not open"));
//       }

//       // Timeout after 15 seconds
//       setTimeout(() => {
//         if (this.pending.has(id)) {
//           this.pending.delete(id);
//           reject(new Error("timeout"));
//         }
//       }, 15000); // Timeout after 15 seconds
//     });
//   }
// }
