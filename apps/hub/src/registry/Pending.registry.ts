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
  /**
   * The agent the request was forwarded to. Only that agent's socket may
   * answer it (audit M2): any other socket's response is dropped.
   */
  agentId?: string;
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
    // Ids are hub-generated, so a collision is a bug, never something a
    // client can cause (audit M3). Refuse rather than orphan the first timer.
    if (this.pending.has(req.requestId)) {
      clearTimeout(req.timer);
      throw new Error(`duplicate pending requestId ${req.requestId}`);
    }
    this.pending.set(req.requestId, req);
  }

  /** The entry, if `fromAgentId` (when given) is the agent that owns it. */
  private owned(requestId: string, fromAgentId?: string): PendingRequest | undefined {
    const req = this.pending.get(requestId);
    if (!req) return undefined;
    if (fromAgentId !== undefined && req.agentId !== undefined && req.agentId !== fromAgentId) return undefined;
    return req;
  }

  /** Requests waiting for each agent's answer right now (fleet view). */
  countByAgent(): Map<string, number> {
    const out = new Map<string, number>();
    for (const req of this.pending.values()) if (req.agentId) out.set(req.agentId, (out.get(req.agentId) ?? 0) + 1);
    return out;
  }

  resolve(requestId: string, response: TunnelResponseMsg, fromAgentId?: string): boolean {
    const req = this.owned(requestId, fromAgentId);
    if (!req) return false;
    clearTimeout(req.timer);
    this.pending.delete(requestId);
    req.resolve(response);
    return true;
  }

  reject(requestId: string, code: TunnelErrorCode, message: string, fromAgentId?: string): boolean {
    const req = this.owned(requestId, fromAgentId);
    if (!req) return false;
    clearTimeout(req.timer);
    this.pending.delete(requestId);
    req.reject(code, message);
    return true;
  }

  streamStart(
    requestId: string,
    status: number,
    headers: Record<string, string>,
    fromAgentId?: string,
  ): boolean {
    const req = this.owned(requestId, fromAgentId);
    if (!req?.stream) return false;
    // The request timeout covers waiting for a response to begin; a stream
    // may then run as long as the caller keeps it open.
    clearTimeout(req.timer);
    req.stream.start(status, headers);
    return true;
  }

  streamChunk(requestId: string, data: Buffer, fromAgentId?: string): boolean {
    const req = this.owned(requestId, fromAgentId);
    if (!req?.stream) return false;
    req.stream.chunk(data);
    return true;
  }

  streamEnd(requestId: string, error?: string, fromAgentId?: string): boolean {
    const req = this.owned(requestId, fromAgentId);
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
