// packages/agent/src/replay/replayQueue.ts
// Single replay path. Outbound first, then inbound.

import { QueueItem } from "../queue/DurableQueue";
import { BackendProxy } from "../proxy/BackendProxy";
import {
  TunnelForwardMsg,
  TunnelResponseMsg,
  TunnelAgentErrorMsg,
  serialize,
  PROTOCOL_VERSION,
} from "@vhyxvoid/protocol";
type SendFn = (data: string) => void;

type QueueLike = {
  drainForReplay(): QueueItem[];
  markSuccess(id: string): void;
  markFailed(id: string): void;
  count(): { ready: number; pending: number; deadLetter: number };
};

export interface ReplayResult {
  succeeded: number;
  failed: number;
  skipped: number;
}

export async function replayQueue(
  queue: QueueLike,
  send: SendFn,
  proxy: BackendProxy,
): Promise<ReplayResult> {
  const items = queue.drainForReplay();

  if (items.length === 0) {
    return { succeeded: 0, failed: 0, skipped: 0 };
  }

  console.info(`[replay] processing ${items.length} queued items`);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      if (item.direction === "outbound") {
        await replayOutbound(item, send);
      } else {
        await replayInbound(item, send, proxy);
      }
      queue.markSuccess(item.id);
      succeeded++;
    } catch (err) {
      queue.markFailed(item.id);
      failed++;
      console.warn(
        `[replay] item ${item.id} failed (attempt ${item.attempts + 1}): ${(err as Error).message}`,
      );
    }
  }

  const counts = queue.count();
  console.info(
    `[replay] done — succeeded: ${succeeded}, failed: ${failed}, ` +
      `remaining: ${counts.ready + counts.pending}`,
  );

  return { succeeded, failed, skipped };
}

// ── Direction handlers ────────────────────────────────────────────────────────

async function replayOutbound(item: QueueItem, send: SendFn): Promise<void> {
  // Outbound = a response/error the agent computed but couldn't send
  // because WS was down. Just send it now.
  const msg = JSON.parse(item.payload) as
    | TunnelResponseMsg
    | TunnelAgentErrorMsg;
  send(serialize(msg as any));
}

async function replayInbound(
  item: QueueItem,
  send: SendFn,
  proxy: BackendProxy,
): Promise<void> {
  // Inbound = a tunnel:forward the agent received but couldn't forward
  // to the local backend (backend was down). Try forwarding again now.
  const forward = JSON.parse(item.payload) as TunnelForwardMsg;

  const result = await proxy.forward(forward);

  const response: TunnelResponseMsg = {
    v: PROTOCOL_VERSION,
    type: "tunnel:response",
    requestId: forward.requestId,
    ...result,
  };

  send(serialize(response));
}
