// packages/agent/src/batcher/MessageBatcher.ts
// In-memory only. Never written to disk. Never persisted.
// If WS drops while items are buffered → flush() routes to DurableQueue.

import {
  TunnelResponseMsg,
  TunnelAgentErrorMsg,
  AgentPongMsg,
  AgentBatchMsg,
  serialize,
  TIMING,
} from "@platform/protocol";

export type BatchableMsg =
  | TunnelResponseMsg
  | TunnelAgentErrorMsg
  | AgentPongMsg;

type FlushFn = (data: string) => void;
type QueueFallback = (msg: TunnelResponseMsg | TunnelAgentErrorMsg) => void;
type IsConnected = () => boolean;

export class MessageBatcher {
  private buffer: BatchableMsg[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    /** Called with serialized data when WS is available */
    private readonly onFlush: FlushFn,
    /** Called with individual messages when WS is down — routes to DurableQueue */
    private readonly onQueueFallback: QueueFallback,
    /** Returns true when WS connection is CONNECTED */
    private readonly isConnected: IsConnected,
  ) {}

  /** Add a message to the batch. Flushes immediately if MAX_BATCH_SIZE reached. */
  add(msg: BatchableMsg): void {
    this.buffer.push(msg);

    if (this.buffer.length >= TIMING.BATCH_MAX_SIZE) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), TIMING.BATCH_WINDOW_MS);
    }
  }

  /**
   * Flush the buffer.
   * - If WS is connected: send as batch (or single message if only one item)
   * - If WS is down: route non-pong messages to DurableQueue
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const messages = this.buffer.splice(0);

    if (!this.isConnected()) {
      // WS is down — persist responses/errors, discard pongs (ephemeral)
      for (const msg of messages) {
        if (msg.type !== "agent:pong") {
          this.onQueueFallback(msg as TunnelResponseMsg | TunnelAgentErrorMsg);
        }
      }
      return;
    }

    // WS is up — send
    const serialized =
      messages.length === 1
        ? serialize(messages[0] as any)
        : serialize({ v: "1", type: "agent:batch", messages } as AgentBatchMsg);

    this.onFlush(serialized);
  }

  /**
   * Called on WS close BEFORE reconnect starts.
   * Moves everything currently in the buffer to DurableQueue.
   * Pongs are discarded (they are point-in-time, not meaningful after disconnect).
   */
  flushToQueue(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const messages = this.buffer.splice(0);
    for (const msg of messages) {
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
