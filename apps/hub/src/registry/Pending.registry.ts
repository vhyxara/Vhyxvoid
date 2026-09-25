// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/registry/PendingRegistry.ts
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis } from '@upstash/redis';
import type { TunnelResponseMsg, TunnelErrorCode } from '@vhyxvoid/protocol';

export interface PendingRequest {
  requestId: string;
  accountId: string;
  agentLabel: string;
  keyId: string;
  enqueuedAt: number;
  resolve: (r: TunnelResponseMsg) => void;
  reject: (code: TunnelErrorCode, msg: string) => void;
  timer: NodeJS.Timeout;
  /**
   * Set for requests forwarded with acceptStream. A streamed response calls
   * start once, chunk per piece, end once; the entry stays pending until
   * end (so an agent disconnect still fails the caller).
   */
  stream?: {
    start: (status: number, headers: Record<string, string>) => void;
    chunk: (data: Buffer) => void;
    end: (error?: string) => void;
  };
}

export class PendingRegistry {
  private readonly pending = new Map<string, PendingRequest>();

  // The Redis client is no longer used; the parameter stays so callers
  // don't change.
  constructor(_redis?: Redis) {}

  // In memory only. Each request used to SET and DEL a hub:pending:<id> key
  // in Redis that nothing ever read (reserved for a multi-hub design that
  // doesn't exist): two billed Upstash commands per tunnelled request.
  async enqueue(req: PendingRequest): Promise<void> {
    this.pending.set(req.requestId, req);
  }

  resolve(requestId: string, response: TunnelResponseMsg): boolean {
    const req = this.pending.get(requestId);
    if (!req) return false;
    clearTimeout(req.timer);
    this.pending.delete(requestId);
    req.resolve(response);
    return true;
  }

  reject(requestId: string, code: TunnelErrorCode, message: string): boolean {
    const req = this.pending.get(requestId);
    if (!req) return false;
    clearTimeout(req.timer);
    this.pending.delete(requestId);
    req.reject(code, message);
    return true;
  }

  streamStart(requestId: string, status: number, headers: Record<string, string>): boolean {
    const req = this.pending.get(requestId);
    if (!req?.stream) return false;
    // The request timeout covers waiting for a response to begin; a stream
    // may then run as long as the caller keeps it open.
    clearTimeout(req.timer);
    req.stream.start(status, headers);
    return true;
  }

  streamChunk(requestId: string, data: Buffer): boolean {
    const req = this.pending.get(requestId);
    if (!req?.stream) return false;
    req.stream.chunk(data);
    return true;
  }

  streamEnd(requestId: string, error?: string): boolean {
    const req = this.pending.get(requestId);
    if (!req?.stream) return false;
    clearTimeout(req.timer);
    this.pending.delete(requestId);
    req.stream.end(error);
    return true;
  }

  /** The caller went away: forget the request without answering it. */
  drop(requestId: string): boolean {
    const req = this.pending.get(requestId);
    if (!req) return false;
    clearTimeout(req.timer);
    this.pending.delete(requestId);
    return true;
  }

  rejectAllForAgent(accountId: string, agentLabel: string): number {
    let count = 0;
    for (const [id, req] of this.pending) {
      if (req.accountId === accountId && req.agentLabel === agentLabel) {
        clearTimeout(req.timer);
        this.pending.delete(id);
        req.reject('AGENT_DISCONNECTED', 'Agent disconnected while processing your request');
        count++;
      }
    }
    return count;
  }

  size(): number {
    return this.pending.size;
  }
}
