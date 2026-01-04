// import WebSocket from "ws";
// const ws = new WebSocket(process.env.HUB_URL || "ws://localhost:9000");
// ws.on("open", () => console.log("Agent Connected"));

import WebSocket from "ws";
import dotenv from "dotenv";
import { handleRequestMessage } from "./utils/utility";
import { v4 as uuidv4 } from "uuid";
import {
  enqueueOfflineRequest,
  pushToDurableQueue,
  replayQueue,
} from "./utils/queue";

dotenv.config();

const HUB_URL = process.env.HUB_URL || "ws://localhost:9000/ws";
const AGENT_ID = process.env.AGENT_ID || `agent-${uuidv4()}`;
const BACKEND_KEY = process.env.BACKEND_KEY || "dev_backend_key";

// Reconnect/backoff params (tweak via env)
const RECONNECT_BASE_MS = Number(process.env.RECONNECT_BASE_MS || 1000); // initial 1s
const RECONNECT_MAX_MS = Number(process.env.RECONNECT_MAX_MS || 30_000); // cap 30s
const RECONNECT_MAX_ATTEMPTS = Number(process.env.RECONNECT_MAX_ATTEMPTS || 30); // optional cap
const PING_INTERVAL = Number(process.env.AGENT_PING_INTERVAL_MS || 10_000); // 10s
const PONG_TIMEOUT_MS = Number(process.env.AGENT_PONG_TIMEOUT_MS || 30_000); // If no pong in 30s, reconnect

// Batching config (env tunables)
const BATCH_MAX_ITEMS = Number(process.env.BATCH_MAX_ITEMS || 20);
const BATCH_FLUSH_MS = Number(process.env.BATCH_FLUSH_MS || 250); // flush every 250ms or when max hit
const REPLAY_BATCH_SIZE = Number(process.env.REPLAY_BATCH_SIZE || 8);
export const REPLAY_CONCURRENCY = Number(process.env.REPLAY_CONCURRENCY || 3);
export const REPLAY_MAX_ATTEMPTS = Number(process.env.REPLAY_MAX_ATTEMPTS || 5);
export const REPLAY_RETRY_BASE_MS = Number(
  process.env.REPLAY_RETRY_BASE_MS || 500
);

// in-memory batch queue for outgoing WS messages
let outgoingBatch: any[] = [];
let batchTimer: NodeJS.Timeout | null = null;
let sendingBatch = false;

let reconnectAttempts = 0;

function getReconnectDelay(attempt: number): number {
  // If attempt is missing or invalid → reset
  if (!attempt || Number.isNaN(attempt)) attempt = 1;

  // Exponential backoff: 500ms → 30s max
  const delay = Math.min(30000, 500 * Math.pow(2, attempt - 1));

  return delay;
}

function scheduleReconnect() {
  reconnectAttempts++;

  const retryDelay = getReconnectDelay(reconnectAttempts);

  console.log(
    `[agent] scheduling reconnect attempt ${reconnectAttempts} in ${retryDelay}ms`
  );

  setTimeout(() => {
    connect();
  }, retryDelay);
}

// push outgoing message (e.g., a response) to batcher
function pushOutgoingMessage(msg: any) {
  outgoingBatch.push(msg);
  if (outgoingBatch.length >= BATCH_MAX_ITEMS) {
    flushOutgoingBatch();
    return;
  }
  if (!batchTimer) {
    batchTimer = setTimeout(() => {
      batchTimer = null;
      flushOutgoingBatch();
    }, BATCH_FLUSH_MS);
  }
}

// flush batch (send as batch over ws)
function flushOutgoingBatch() {
  if (sendingBatch) return; // avoid concurrent flush
  if (!outgoingBatch.length) return;

  const items = outgoingBatch.splice(0, outgoingBatch.length);
  sendingBatch = true;

  // build the payload
  const payload = { type: "batch", messages: items };

  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      enqueueOfflineRequest({
        direction: "outbound",
        ts: Date.now(),
        payload: payload,
      });
      console.warn("[batch] ws not open — persisting batch to disk");
      // persist each message separately so replay logic can handle them
      for (const it of items)
        pushToDurableQueue({
          direction: "outbound",
          item: it,
          ts: Date.now(),
          attempts: 0,
          id: uuidv4(),
        });
    }
  } catch (e) {
    console.error("[batch] failed to send batch", e);
    // persist as fallback
    for (const it of items)
      pushToDurableQueue({
        direction: "outbound",
        item: it,
        ts: Date.now(),
        attempts: 0,
        id: uuidv4(),
      });
  } finally {
    sendingBatch = false;
  }
}

let ws: WebSocket | null = null;
let shouldStop = false;
// let reconnectAttempts = 0;
let pingTimer: NodeJS.Timeout | null = null;
let pongTimer: NodeJS.Timeout | null = null;
let lastPong = Date.now();

export function setQueueWebSocket(socket: WebSocket) {
  ws = socket;
}

async function withRetry(fn: () => Promise<any>, maxAttempts = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      const base = 200 * Math.pow(2, attempt); // ms
      const jitter = Math.floor(Math.random() * 100);
      await new Promise((r) => setTimeout(r, base + jitter));
    }
  }
}

function jitter(ms: number) {
  // ±20% jitter
  const dj = Math.floor(ms * 0.2);
  const rand = Math.floor(Math.random() * (dj * 2 + 1)) - dj;
  return Math.max(0, ms + rand);
}

async function safeReplayQueue() {
  try {
    await replayQueue(ws);
  } catch (e) {
    console.error("[agent] replayQueue error after reconnect", e);
  }
}

function startHeartbeat() {
  stopHeartbeat(); // ensure single timer
  lastPong = Date.now();

  // Ping interval: send ping and schedule pong check.
  pingTimer = setInterval(() => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "ping", agentId: AGENT_ID, ts: Date.now() })
        );
      }
    } catch (e) {
      console.error("[agent] ping send failed", e);
    }

    // set/restart pong timeout check
    if (pongTimer) clearTimeout(pongTimer);
    pongTimer = setTimeout(() => {
      const delta = Date.now() - lastPong;
      if (delta > PONG_TIMEOUT_MS) {
        console.warn(
          "[agent] pong timeout — assuming connection dead, reconnecting"
        );
        safeCloseAndReconnect();
      }
    }, PONG_TIMEOUT_MS + 1000); // small buffer
  }, PING_INTERVAL);
}

function stopHeartbeat() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (pongTimer) {
    clearTimeout(pongTimer);
    pongTimer = null;
  }
}

function safeCloseAndReconnect() {
  try {
    if (ws) {
      // remove all listeners to avoid duplicate events
      ws.removeAllListeners();
      try {
        ws.terminate();
      } catch {}
      try {
        ws.close();
      } catch {}
      ws = null;
    }
  } finally {
    // start reconnect flow
    scheduleReconnect();
  }
}

let reconnectTimer: NodeJS.Timeout | null = null;

function resetReconnectState() {
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function connect() {
  if (shouldStop) return;
  console.log("[agent] connecting to hub:", HUB_URL);

  ws = new WebSocket(HUB_URL);

  ws.on("open", async () => {
    console.log("[agent] connected to hub", HUB_URL);
    resetReconnectState();

    try {
      ws!.send(
        JSON.stringify({
          type: "register",
          agentId: AGENT_ID,
          backendKey: BACKEND_KEY,
        })
      );
      console.log("[agent] registration sent");
    } catch (e) {
      console.error("[agent] registration send error", e);
    }
    startHeartbeat();
    setQueueWebSocket(ws as WebSocket);

    await safeReplayQueue();
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "registered") {
        console.log("[agent] hub confirmed registration:", msg.agentId);

        // Now safe to replay queued items: outbound responses and inbound requests
        // run replay in background (non-blocking)
        replayQueue(ws).catch((e) =>
          console.error("[agent] replayQueue error after registered", e)
        );
        lastPong = Date.now();
        return;
      }
      // reset lastPong if pong
      if (msg.type === "pong" || msg.type === "heartbeat") {
        lastPong = Date.now();
        return;
      }
      if (msg.type === "batch" && Array.isArray(msg.messages)) {
        for (const inner of msg.messages) {
          // re-dispatch as if received individually
          // Note: if these are requests, they will be handled in the same code path below
          try {
            await handleIncomingMessage(inner);
          } catch (e) {
            console.error("[agent] error handling batched message item", e);
          }
        }
        return;
      }
      await handleIncomingMessage(msg);
    } catch (e) {
      console.error("[agent] msg parse", e);
    }
  });

  async function handleIncomingMessage(msg: any) {
    if (msg.type === "request") {
      try {
        const resp = await handleRequestMessage(msg); // calls forwardToLocalBackend internally and may push inbound queue
        // push response into outgoing batcher (transparent)
        pushOutgoingMessage({
          type: "response",
          requestId: msg.requestId,
          status: resp.status,
          headers: resp.headers,
          body: resp.body,
        });
      } catch (e) {
        console.error("[agent] error handling request", e);
        // in failure, we should persist inbound request for replay to backend (if needed)
        pushToDurableQueue({
          direction: "inbound",
          item: msg,
          ts: Date.now(),
          attempts: 0,
          id: uuidv4(),
        });
      }
    } else if (msg.type === "ping") {
      // respond with pong immediately
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ type: "pong", agentId: AGENT_ID, ts: Date.now() })
          );
        }
      } catch (e) {}
    } else {
      // handle other types if needed
    }
  }

  setInterval(() => {
    try {
      ws?.send(
        JSON.stringify({ type: "heartbeat", agentId: AGENT_ID, ts: Date.now() })
      );
    } catch {}
  }, PING_INTERVAL);

  ws.on("close", (code, reason) => {
    console.warn("[agent] ws closed", code, reason && reason.toString());
    stopHeartbeat();
    // schedule a reconnect (with backoff)
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[agent] ws error", err);
    // many ws errors will trigger 'close' as well; proactively reconnect
    stopHeartbeat();
    scheduleReconnect();
  });
}

// Graceful shutdown helper
function shutdown() {
  shouldStop = true;
  stopHeartbeat();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) {
    try {
      ws.removeAllListeners();
      ws.terminate();
    } catch {}
    ws = null;
  }
  console.log("[agent] stopped");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

connect();

// function scheduleReconnect() {
//   if (shouldStop) return;
//   reconnectAttempts++;
//   if (
//     RECONNECT_MAX_ATTEMPTS > 0 &&
//     reconnectAttempts > RECONNECT_MAX_ATTEMPTS
//   ) {
//     console.error(
//       "[agent] reached max reconnect attempts, stopping reconnects"
//     );
//     return;
//   }

//   // exponential backoff
//   const backoff = Math.min(
//     RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts - 1),
//     RECONNECT_MAX_MS
//   );
//   const delay = jitter(backoff);
//   console.log(
//     `[agent] scheduling reconnect attempt ${reconnectAttempts} in ${delay}ms`
//   );

//   if (reconnectTimer) clearTimeout(reconnectTimer);
//   reconnectTimer = setTimeout(() => {
//     reconnectTimer = null;
//     connect(); // attempt reconnect
//   }, delay);
// }
