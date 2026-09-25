import type { QueueItem, InboundPayload } from "./DurableQueue";

export class NoOpQueue {
  enqueueInbound(_payload: InboundPayload): void {}
  drainForReplay(): QueueItem[] { return []; }
  markSuccess(_id: string): void {}
  markFailed(_id: string): void {}
  count(): { ready: number; pending: number; deadLetter: number } {
    return { ready: 0, pending: 0, deadLetter: 0 };
  }
  close(): void {}
}
