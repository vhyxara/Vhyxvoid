// packages/agent/src/batcher/MessageBatcher.ts
// In-memory only. Never written to disk. Never persisted.
// If WS drops while items are buffered → flush() hands them to the fallback
// (AgentClient holds them in memory until re-registered).

import {
  TunnelResponseMsg,
  TunnelAgentErrorMsg,
  AgentPongMsg,
  serialize,
  TIMING,
} from "@vhyxvoid/protocol";
import { debugLog } from "../debug";

// tunnel:ws:* frames are deliberately NOT batchable: they must stay ordered with
// tunnel:ws:close/error, which are sent immediately, and must never reach the
// durable queue (ws-tunnel-design.md, D2/D6). The type keeps them out.
export type BatchableMsg = TunnelResponseMsg | TunnelAgentErrorMsg | AgentPongMsg;

type FlushFn = (data: string) => void;
type QueueFallback = (msg: TunnelResponseMsg | TunnelAgentErrorMsg) => void;
type IsConnected = () => boolean;

/**
 * Largest agent:batch frame the batcher builds (serialized bytes). A message
 * bigger than this on its own is sent un-batched. Without a byte limit, eleven
 * ~10 MB responses inside one 50 ms window became one ~150 MB frame, over the
 * hub's 100 MiB maxPayload, and the hub closed the connection with 1009
 * (audit part2 G4).
 */
export const BATCH_MAX_BYTES = 1024 * 1024;

export class MessageBatcher {
  /** Each message kept with its JSON, serialized once in add(). */
  private buffer: { msg: BatchableMsg; json: string }[] = [];
  private bufferBytes = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    /** Called with serialized data when WS is available */
    private readonly onFlush: FlushFn,
    /** Called with individual messages when WS is down (AgentClient holds them in memory) */
    private readonly onQueueFallback: QueueFallback,
    /** Returns true when WS connection is CONNECTED */
    private readonly isConnected: IsConnected,
  ) {}

  /**
   * Add a message to the batch. Flushes first if the message would push the
   * batch over BATCH_MAX_BYTES; sends a message over that limit on its own
   * (after flushing what's buffered, so order is kept); flushes when
   * BATCH_MAX_SIZE messages are buffered; otherwise within BATCH_WINDOW_MS.
   */
  add(msg: BatchableMsg): void {
    debugLog("[batcher] add msg type:", msg.type);

    const json = serialize(msg);
    const bytes = Buffer.byteLength(json);

    if (bytes > BATCH_MAX_BYTES) {
      this.flush();
      this.send([{ msg, json }]);
      return;
    }
    if (this.bufferBytes + bytes > BATCH_MAX_BYTES) this.flush();

    this.buffer.push({ msg, json });
    this.bufferBytes += bytes;

    if (this.buffer.length >= TIMING.BATCH_MAX_SIZE) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), TIMING.BATCH_WINDOW_MS);
    }
  }

  /**
   * Flush the buffer.
   * - If WS is connected: send as batch (or single message if only one item)
   * - If WS is down: hand non-pong messages to the fallback
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    debugLog(
      "[batcher] flush, connected:",
      this.isConnected(),
      "messages:",
      this.buffer.length,
    );

    const entries = this.buffer.splice(0);
    this.bufferBytes = 0;
    this.send(entries);
  }

  private send(entries: { msg: BatchableMsg; json: string }[]): void {
    if (!this.isConnected()) {
      // WS is down — hand responses/errors to the fallback, discard pongs (ephemeral)
      for (const { msg } of entries) {
        if (msg.type !== "agent:pong") {
          this.onQueueFallback(msg as TunnelResponseMsg | TunnelAgentErrorMsg);
        }
      }
      return;
    }

    // Same bytes serialize({ v, type: "agent:batch", messages }) would produce,
    // without stringifying every (possibly multi-MB) message a second time.
    const serialized =
      entries.length === 1
        ? entries[0].json
        : `{"v":"1","type":"agent:batch","messages":[${entries.map((e) => e.json).join(",")}]}`;
    debugLog("[batcher] sending serialized, length:", serialized.length);

    this.onFlush(serialized);
  }

  /**
   * Called on WS close BEFORE reconnect starts.
   * Hands everything currently in the buffer to the fallback.
   * Pongs are discarded (they are point-in-time, not meaningful after disconnect).
   */
  flushToQueue(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const entries = this.buffer.splice(0);
    this.bufferBytes = 0;
    for (const { msg } of entries) {
      if (msg.type !== "agent:pong") {
        this.onQueueFallback(msg as TunnelResponseMsg | TunnelAgentErrorMsg);
      }
    }
  }

  /** Number of messages currently buffered (for diagnostics). */
  size(): number {
    return this.buffer.length;
  }
}
