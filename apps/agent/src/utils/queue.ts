// apps/agent/src/queue.ts
import fs from "fs";
import path from "path";
import { forwardToLocalBackend } from "./utility";

export const QUEUE_FILE = path.resolve(
  process.cwd(),
  process.env.QUEUE_FILE || "queue.jsonl"
);
const TMP_FILE = QUEUE_FILE + ".tmp";

const ROTATE_MAX_BYTES = Number(
  process.env.QUEUE_ROTATE_MAX_BYTES || 10 * 1024 * 1024
); // 10 MB
const ROTATE_KEEP = Number(process.env.QUEUE_ROTATE_KEEP || 5); // keep 5 old files

const REPLAY_CONCURRENCY = Number(process.env.REPLAY_CONCURRENCY || 3);
const REPLAY_MAX_ATTEMPTS = Number(process.env.REPLAY_MAX_ATTEMPTS || 5);
const REPLAY_RETRY_BASE_MS = Number(process.env.REPLAY_RETRY_BASE_MS || 500);
const REPLAY_BATCH_SIZE = Number(process.env.REPLAY_BATCH_SIZE || 8);

// -----------------------------
// Types
// -----------------------------
export type Direction = "inbound" | "outbound";
export type QueueItem = {
  id: string;
  direction: Direction;
  payload: any; // the actual WS message (for outbound) or request object (for inbound)
  ts: number;
  attempts?: number;
};

// -----------------------------
// Utilities: file operations
// -----------------------------
function ensureQueueFile() {
  if (!fs.existsSync(QUEUE_FILE)) {
    fs.writeFileSync(QUEUE_FILE, "", "utf8");
  }
}

function appendLine(obj: any) {
  ensureQueueFile();
  const line = JSON.stringify(obj) + "\n";
  // synchronous append for durability
  fs.appendFileSync(QUEUE_FILE, line, { encoding: "utf8" });
  tryRotateIfLarge();
}

function readAllLines(): QueueItem[] {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  const raw = fs.readFileSync(QUEUE_FILE, "utf8").trim();
  if (!raw) return [];
  const lines = raw.split("\n");
  const items: QueueItem[] = [];
  for (const l of lines) {
    if (!l) continue;
    try {
      const parsed = JSON.parse(l);
      items.push(parsed);
    } catch (e) {
      console.error("[queue] invalid jsonl line, skipping:", l);
    }
  }
  return items;
}

function rewriteAll(items: QueueItem[]) {
  const jsonl =
    items.map((i) => JSON.stringify(i)).join("\n") + (items.length ? "\n" : "");
  fs.writeFileSync(TMP_FILE, jsonl, "utf8");
  fs.renameSync(TMP_FILE, QUEUE_FILE);
  tryRotateIfLarge();
}

function tryRotateIfLarge() {
  try {
    const stat = fs.existsSync(QUEUE_FILE) ? fs.statSync(QUEUE_FILE) : null;
    if (!stat) return;
    if (stat.size < ROTATE_MAX_BYTES) return;

    // rotate: move existing file to .1, .2 ... (older)
    for (let i = ROTATE_KEEP - 1; i >= 1; i--) {
      const from = `${QUEUE_FILE}.${i}`;
      const to = `${QUEUE_FILE}.${i + 1}`;
      if (fs.existsSync(from)) {
        try {
          fs.renameSync(from, to);
        } catch {}
      }
    }
    // move current to .1
    fs.renameSync(QUEUE_FILE, `${QUEUE_FILE}.1`);
    // create new empty file
    fs.writeFileSync(QUEUE_FILE, "", "utf8");

    // remove beyond keep
    const oldest = `${QUEUE_FILE}.${ROTATE_KEEP + 1}`;
    if (fs.existsSync(oldest)) {
      try {
        fs.unlinkSync(oldest);
      } catch {}
    }
    console.log("[queue] rotated queue file due to size");
  } catch (e) {
    console.error("[queue] rotate error", e);
  }
}

// -----------------------------
// In-memory helper (fast path)
// -----------------------------
let memoryQueue: QueueItem[] = [];

/**
 * Load file into memory on startup.
 * Call this once from agent init if you want the in-memory snapshot.
 */
export function loadQueueIntoMemory() {
  memoryQueue = readAllLines();
  console.log(`[queue] loaded ${memoryQueue.length} items from ${QUEUE_FILE}`);
}

/**
 * Return current queue length (file-backed + memory snapshot is authoritative).
 */
export function readQueueLength() {
  const items = readAllLines();
  return items.length;
}

/**
 * Append a new item to durable queue (file + memory)
 */
export function enqueue(item: { direction: Direction; item: any }) {
  const q: QueueItem = {
    id: crypto.randomUUID(),
    direction: item.direction,
    payload: item.item,
    ts: Date.now(),
    attempts: 0,
  };
  // append to disk (durable)
  try {
    appendLine(q);
  } catch (e) {
    console.error("[queue] appendLine failed", e);
  }
  // also update memory snapshot (best-effort)
  memoryQueue.push(q);
  return q.id;
}

/**
 * Clear full queue (use with care).
 */
export function clearQueue() {
  try {
    rewriteAll([]);
    memoryQueue = [];
  } catch (e) {
    console.error("[queue] clearQueue error", e);
  }
}

// -----------------------------
// WS injection
// -----------------------------
let injectedWs: WebSocket | null = null;

/**
 * Set the active WebSocket instance so replay logic can use it.
 * Call this in agent when ws is (re)created: setWs(ws)
 */
export function setWs(ws: WebSocket | null) {
  injectedWs = ws;
}

// -----------------------------
// Replay logic
// -----------------------------
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Send one outbound QueueItem to the hub via provided WebSocket (or injectedWs if not given).
 * Returns true on success, false on persistent failure.
 */
async function sendOutboundItem(
  wsArg: WebSocket | null,
  q: QueueItem
): Promise<boolean> {
  const wsToUse = wsArg ?? injectedWs;
  if (!wsToUse || wsToUse.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    // q.payload should already be a WS message object (e.g., { type: 'response', requestId, status, ... })
    wsToUse.send(JSON.stringify(q.payload));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Forward one inbound QueueItem to local backend. Use forwardToLocalBackend helper.
 */
async function sendInboundItem(q: QueueItem): Promise<boolean> {
  try {
    await forwardToLocalBackend(q.payload);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * processList - generic list processor with concurrency and per-item retry/backoff.
 * - processor: (q) => Promise<boolean> ; should return true when item successfully processed
 * - returns array of failed items (that should be persisted back)
 */
async function processList(
  list: QueueItem[],
  processor: (q: QueueItem) => Promise<boolean>
) {
  const failures: QueueItem[] = [];
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= list.length) break;
      const q = list[i];
      let ok = false;
      const startAttempts = q.attempts || 0;
      for (
        let attempt = startAttempts + 1;
        attempt <= REPLAY_MAX_ATTEMPTS;
        attempt++
      ) {
        try {
          ok = await processor(q);
        } catch (e) {
          ok = false;
        }
        if (ok) break;
        // backoff
        const backoff = Math.min(
          REPLAY_RETRY_BASE_MS * Math.pow(2, attempt - 1),
          5000
        );
        await delay(backoff + Math.floor(Math.random() * 100));
      }
      if (!ok) {
        q.attempts = (q.attempts || 0) + 1;
        failures.push(q);
      }
    }
  }

  const concurrency = Math.max(1, Math.min(REPLAY_CONCURRENCY, list.length));
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return failures;
}

/**
 * Public: replayQueue
 * - reads queue file
 * - processes outbound groups first (in small batches)
 * - then inbound groups
 * - writes back only failures (atomic)
 * - accepts optional ws parameter (if provided it's used for outbound sends)
 */
export async function replayQueue(wsArg?: WebSocket | null) {
  const items = readAllLines();
  if (!items || items.length === 0) return;
  console.log(`[queue] replaying ${items.length} queued items`);

  // Separate lists (keep original order within each group)
  const outbound = items.filter((i) => i.direction === "outbound");
  const inbound = items.filter((i) => i.direction === "inbound");

  const failedOutbound: QueueItem[] = [];
  for (let i = 0; i < outbound.length; i += REPLAY_BATCH_SIZE) {
    const group = outbound.slice(i, i + REPLAY_BATCH_SIZE);
    const f = await processList(group, async (q) =>
      sendOutboundItem(wsArg ?? injectedWs, q)
    );
    failedOutbound.push(...f);
    // small pause
    await delay(25);
  }

  const failedInbound: QueueItem[] = [];
  for (let i = 0; i < inbound.length; i += REPLAY_BATCH_SIZE) {
    const group = inbound.slice(i, i + REPLAY_BATCH_SIZE);
    const f = await processList(group, sendInboundItem);
    failedInbound.push(...f);
    await delay(25);
  }

  const failed = [...failedOutbound, ...failedInbound];
  if (failed.length === 0) {
    // clear file
    try {
      rewriteAll([]);
      memoryQueue = [];
      console.log("[queue] replayQueue: all items processed");
    } catch (e) {
      console.error("[queue] replayQueue clear error", e);
    }
  } else {
    // persist failures (atomic rewrite)
    try {
      rewriteAll(failed);
      memoryQueue = failed.slice();
      console.log(
        `[queue] replayQueue: ${failed.length} items failed, persisted for later`
      );
    } catch (e) {
      console.error("[queue] replayQueue: failed to persist failed items", e);
    }
  }
}

// -----------------------------
// Convenience helpers for agent
// -----------------------------

/**
 * Add a response object to the queue (outbound).
 * Prefer calling enqueue({direction:'outbound', item: wsMessageObject })
 */
export function enqueueOutbound(wsMessageObj: any) {
  return enqueue({ direction: "outbound", item: wsMessageObj });
}

/**
 * Add an inbound request to the queue (inbound)
 */
export function enqueueInbound(requestObj: any) {
  return enqueue({ direction: "inbound", item: requestObj });
}

// -----------------------------
// Export small admin helpers
// -----------------------------
export function peekAll(): QueueItem[] {
  return readAllLines();
}

// near your existing replayQueue or replace it
// export async function replayQueue(ws: WebSocket | null) {
//   const items = readDurableQueue();
//   if (!items.length) return;
//   console.log(`[agent] replaying ${items.length} queued items`);

//   // process outbound items first (these are responses we couldn't send)
//   const outbound = items.filter((i) => i.direction === "outbound");
//   const inbound = items.filter((i) => i.direction === "inbound");

//   // helper to process an outbound item (send via ws)
//   async function processOutbound(it: any) {
//     try {
//       if (!ws || ws.readyState !== WebSocket.OPEN)
//         throw new Error("ws_not_open");
//       ws.send(JSON.stringify(it.item)); // item already is a message (response or request)
//       return true;
//     } catch (e) {
//       return false;
//     }
//   }

//   // helper to process inbound item (forward to local backend)
//   // reuses your forwardToLocalBackend or handleRequestMessage pipeline:
//   async function processInbound(it: any) {
//     try {
//       // `it.item` contains original msg (like { method, path, headers, body })
//       await forwardToLocalBackend(it.item);
//       return true;
//     } catch (e) {
//       return false;
//     }
//   }

//   // process lists with concurrency and per-item retry/backoff
//   async function processList(
//     list: any[],
//     processor: (it: any) => Promise<boolean>
//   ) {
//     // Work on a copy; we'll rewrite disk queue at end with failures
//     const failures: any[] = [];
//     const sem = { running: 0 };
//     let idx = 0;

//     async function worker() {
//       while (idx < list.length) {
//         const i = idx++;
//         sem.running++;
//         const it = list[i];
//         let ok = false;
//         for (
//           let attempt = (it.attempts || 0) + 1;
//           attempt <= REPLAY_MAX_ATTEMPTS;
//           attempt++
//         ) {
//           try {
//             ok = await processor(it);
//             if (ok) break;
//           } catch {}
//           // backoff
//           const backoff = Math.min(
//             REPLAY_RETRY_BASE_MS * Math.pow(2, attempt - 1),
//             5000
//           );
//           await new Promise((r) => setTimeout(r, backoff));
//         }
//         if (!ok) {
//           it.attempts = (it.attempts || 0) + 1;
//           failures.push(it);
//         }
//         sem.running--;
//       }
//     }

//     // spawn concurrency workers
//     const workers: Promise<void>[] = [];
//     const concurrency = Math.max(1, Math.min(REPLAY_CONCURRENCY, list.length));
//     for (let i = 0; i < concurrency; i++) workers.push(worker());
//     await Promise.all(workers);

//     return failures;
//   }

//   // Process outbound first (to get responses to hub asap)
//   const failedOutbound = await processList(outbound, processOutbound);
//   const failedInbound = await processList(inbound, processInbound);

//   const failed = failedOutbound.concat(failedInbound);

//   if (failed.length === 0) {
//     clearDurableQueue();
//     console.log("[agent] replayQueue: all items processed");
//   } else {
//     // rewrite file with failed items only (overwrite)
//     try {
//       const tmp = items.filter((it) =>
//         failed.some(
//           (f) => f.ts === it.ts && f.item?.requestId === it.item?.requestId
//         )
//       );
//       // naive approach: re-serialize failures
//       fs.writeFileSync(
//         QUEUE_PATH,
//         failed.map((f) => JSON.stringify(f)).join("\n") + "\n",
//         "utf8"
//       );
//       console.log(
//         `[agent] replayQueue: ${failed.length} items failed, persisted for later`
//       );
//     } catch (e) {
//       console.error("[agent] replayQueue: failed to persist failed items", e);
//     }
//   }
// }

const QUEUE_PATH = path.resolve(process.cwd(), "bridge-queue.jsonl");

// durable append
export function pushToDurableQueue(obj: QueueItem) {
  try {
    fs.appendFileSync(QUEUE_PATH, JSON.stringify(obj) + "\n", {
      encoding: "utf8",
    });
  } catch (e) {
    console.error("[batch] failed to push to durable queue", e);
  }
}

export function readDurableQueue(): any[] {
  try {
    if (!fs.existsSync(QUEUE_PATH)) return [];
    const data = fs.readFileSync(QUEUE_PATH, "utf8").trim();
    if (!data) return [];
    return data.split("\n").map((l) => JSON.parse(l));
  } catch (e) {
    console.error("[batch] read durable queue failed", e);
    return [];
  }
}

export function clearDurableQueue() {
  try {
    if (fs.existsSync(QUEUE_PATH)) fs.unlinkSync(QUEUE_PATH);
  } catch (e) {
    console.error("[batch] clear durable queue failed", e);
  }
}

/**
 * Append a single event as JSONL.
 * Safe for crashes because append is atomic on modern OS.
 */
export async function appendToQueueFile(event: any) {
  ensureQueueFile();
  const line = JSON.stringify(event) + "\n";

  return new Promise((resolve, reject) => {
    fs.appendFile(QUEUE_FILE, line, (err) => {
      if (err) reject(err);
      else resolve(null);
    });
  });
}

/**
 * Read all queued items into memory.
 */
export function readQueueFile(): any[] {
  ensureQueueFile();
  const raw = fs.readFileSync(QUEUE_FILE, "utf8");
  if (!raw.trim()) return [];
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        console.error("[agent] corrupted line in queue file:", line);
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Atomically replace file with a new set of lines.
 * Uses a temp file + rename → atomic.
 */
export function rewriteQueueFile(items: any[]) {
  ensureQueueFile();

  const jsonl = items.map((e) => JSON.stringify(e)).join("\n") + "\n";

  // write to tmp first
  fs.writeFileSync(TMP_FILE, jsonl, "utf8");

  // atomic replace
  fs.renameSync(TMP_FILE, QUEUE_FILE);
}

// in-memory queue
let offlineQueue: any[] = [];

const BATCH_MAX_ITEMS = 25; // how many items per replay batch
const BATCH_INTERVAL_MS = 200; // pause between batches to prevent overload

//-----------------------------------------------------------------
// Load queue from disk on startup
//-----------------------------------------------------------------
export function loadOfflineQueue() {
  offlineQueue = readQueueFile();
  console.log(`[agent] loaded ${offlineQueue.length} items from disk`);
}

//-----------------------------------------------------------------
// Add request to offline memory + file
//-----------------------------------------------------------------
export function enqueueOfflineRequest(event: any) {
  offlineQueue.push(event);

  appendToQueueFile(event).catch((err) =>
    console.error("[agent] failed to append queue file:", err)
  );
}

//-----------------------------------------------------------------
// Replay Queue (Batched)
//-----------------------------------------------------------------
export async function flushOfflineQueue(
  sendFn: (payload: any) => Promise<void>
) {
  if (offlineQueue.length === 0) return;

  console.log(`[agent] starting replay: ${offlineQueue.length} items`);

  while (offlineQueue.length > 0) {
    // TAKE NEXT BATCH
    const batch = offlineQueue.slice(0, BATCH_MAX_ITEMS);

    console.log(
      `[agent] replaying batch of ${batch.length} items (remaining: ${offlineQueue.length})`
    );

    try {
      // send each item in batch
      for (const item of batch) {
        await sendFn(item);
      }

      // remove sent items from memory
      offlineQueue.splice(0, batch.length);

      // update file atomically
      rewriteQueueFile(offlineQueue);
    } catch (e) {
      console.error("[agent] replay batch failed:", e);

      // ALWAYS persist remaining queue so it's not lost
      rewriteQueueFile(offlineQueue);

      // stop replay at first failure
      break;
    }

    // small delay to avoid hammering server
    if (offlineQueue.length > 0) {
      await new Promise((r) => setTimeout(r, BATCH_INTERVAL_MS));
    }
  }

  console.log("[agent] replay complete");
}

/**
 * Clear queue file
 */
export function clearFile() {
  try {
    if (fs.existsSync(QUEUE_FILE)) fs.unlinkSync(QUEUE_FILE);
  } catch (e) {
    console.error("[queueStorage] clearFile error", e);
  }
}

/**
 * Process outbound queue items: send them to hub (transparent: item.item is already a WS message object)
 * Returns array of failed items (to persist back)
 */
async function processOutbound(ws: WebSocket | null, items: any[]) {
  const failures: any[] = [];
  // process with concurrency
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      const it = items[i];
      let success = false;
      const startAttempts = it.attempts || 0;
      for (
        let attempt = startAttempts + 1;
        attempt <= REPLAY_MAX_ATTEMPTS;
        attempt++
      ) {
        try {
          if (!ws || ws.readyState !== WebSocket.OPEN)
            throw new Error("ws_not_open");
          // Send as individual message (transparent)
          ws.send(JSON.stringify(it.item));
          success = true;
          break;
        } catch (e) {
          // wait with backoff
          const backoff = Math.min(
            REPLAY_RETRY_BASE_MS * Math.pow(2, attempt - 1),
            5000
          );
          await delay(backoff + Math.floor(Math.random() * 100));
        }
      }
      if (!success) {
        it.attempts = (it.attempts || 0) + 1;
        failures.push(it);
      }
    }
  };

  const workers = [];
  const concurrency = Math.max(1, Math.min(REPLAY_CONCURRENCY, items.length));
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return failures;
}

/**
 * Process inbound queue items: forward to local backend using forwardToLocalBackend
 * Returns array of failed items
 */
async function processInbound(items: any[]) {
  const failures: any[] = [];

  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      const it = items[i];
      let success = false;
      const startAttempts = it.attempts || 0;
      for (
        let attempt = startAttempts + 1;
        attempt <= REPLAY_MAX_ATTEMPTS;
        attempt++
      ) {
        try {
          // forwardToLocalBackend should throw on failure
          await forwardToLocalBackend(it.item);
          success = true;
          break;
        } catch (e) {
          const backoff = Math.min(
            REPLAY_RETRY_BASE_MS * Math.pow(2, attempt - 1),
            5000
          );
          await delay(backoff + Math.floor(Math.random() * 100));
        }
      }
      if (!success) {
        it.attempts = (it.attempts || 0) + 1;
        failures.push(it);
      }
    }
  };

  const workers = [];
  const concurrency = Math.max(1, Math.min(REPLAY_CONCURRENCY, items.length));
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return failures;
}

/**
 * Public replay function:
 * - reads the durable queue
 * - splits outbound/inbound
 * - processes outbound first (so hub gets responses)
 * - rewrites queue with failed items only
 */
// export async function replayQueue(ws: WebSocket | null) {
//   const items = readDurableQueue();
//   if (!items || items.length === 0) return;
//   console.log(`[agent] replaying ${items.length} queued items`);

//   // Keep FIFO ordering for inbound items (we process them with concurrency but keep items order in file rewriting)
//   const outbound = items.filter((i) => i.direction === "outbound");
//   const inbound = items.filter((i) => i.direction === "inbound");

//   // process outbound in (optionally) batched groups to avoid monopolizing the socket:
//   const failedOutboundGroups: any[] = [];
//   for (let i = 0; i < outbound.length; i += REPLAY_BATCH_SIZE) {
//     const group = outbound.slice(i, i + REPLAY_BATCH_SIZE);
//     const failed = await processOutbound(ws, group);
//     failedOutboundGroups.push(...failed);
//     // small pause between batches to let hub process and reduce bursts
//     await delay(50);
//   }

//   // process inbound groups
//   const failedInboundGroups: any[] = [];
//   for (let i = 0; i < inbound.length; i += REPLAY_BATCH_SIZE) {
//     const group = inbound.slice(i, i + REPLAY_BATCH_SIZE);
//     const failed = await processInbound(group);
//     failedInboundGroups.push(...failed);
//     await delay(50);
//   }

//   const failed = failedOutboundGroups.concat(failedInboundGroups);

//   if (failed.length === 0) {
//     // all done: clear file
//     try { rewriteDurableQueue([]); } catch (e) { console.error("[agent] replayQueue clear error", e); }
//     console.log("[agent] replayQueue: all items processed");
//   } else {
//     // persist failures
//     try {
//       rewriteDurableQueue(failed);
//       console.log(`[agent] replayQueue: ${failed.length} items failed, persisted`);
//     } catch (e) {
//       console.error("[agent] replayQueue: failed to persist failed items", e);
//     }
//   }
// }
