// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/registry/PendingRegistry.ts
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis } from '@upstash/redis';
import type { TunnelResponseMsg, TunnelErrorCode } from '@vhyxvoid/protocol';
import { getPendingTtlMs } from '@/utils/tunnelTimeout';

export interface PendingRequest {
  requestId: string;
  accountId: string;
  agentLabel: string;
  keyId: string;
  enqueuedAt: number;
  resolve: (r: TunnelResponseMsg) => void;
  reject: (code: TunnelErrorCode, msg: string) => void;
  timer: NodeJS.Timeout;
}

export class PendingRegistry {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly redis: Redis) {}

  async enqueue(req: PendingRequest): Promise<void> {
    this.pending.set(req.requestId, req);
    await this.redis
      .set(
        `hub:pending:${req.requestId}`,
        JSON.stringify({
          accountId: req.accountId,
          agentLabel: req.agentLabel,
          ts: req.enqueuedAt,
        }),
        { px: getPendingTtlMs() },
      )
      .catch(() => {});
  }

  resolve(requestId: string, response: TunnelResponseMsg): boolean {
    const req = this.pending.get(requestId);
    if (!req) return false;
    clearTimeout(req.timer);
    this.pending.delete(requestId);
    this.redis.del(`hub:pending:${requestId}`).catch(() => {});
    req.resolve(response);
    return true;
  }

  reject(requestId: string, code: TunnelErrorCode, message: string): boolean {
    const req = this.pending.get(requestId);
    if (!req) return false;
    clearTimeout(req.timer);
    this.pending.delete(requestId);
    this.redis.del(`hub:pending:${requestId}`).catch(() => {});
    req.reject(code, message);
    return true;
  }

  rejectAllForAgent(accountId: string, agentLabel: string): number {
    let count = 0;
    for (const [id, req] of this.pending) {
      if (req.accountId === accountId && req.agentLabel === agentLabel) {
        clearTimeout(req.timer);
        this.pending.delete(id);
        this.redis.del(`hub:pending:${id}`).catch(() => {});
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
