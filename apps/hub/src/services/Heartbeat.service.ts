// apps/hub/src/services/HeartbeatService.ts
// Single heartbeat loop. Single handler. No duplicates anywhere.

import type { Redis } from '@upstash/redis';
import { serialize, TIMING } from '@vhyxvoid/protocol';
import type { AgentRegistry } from '@/registry/Agent.registry';
import type { AgentSession } from '@/registry/Agent.registry';
import type { PendingRegistry } from '@/registry/Pending.registry';
import type { TunnelSessionRepository } from '@/repositories/TunnelSession.repository';
import { releaseSubdomain, type SubdomainReleaseDeps } from '@/utils/releaseSubdomain';

export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly pendingRegistry: PendingRegistry,
    private readonly sessionRepo: TunnelSessionRepository,
    private readonly redis: Redis,
    private readonly hubInstanceId: string,
    private readonly subdomains?: SubdomainReleaseDeps,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TIMING.HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Called when agent sends agent:pong */
  handlePong(agentId: string): void {
    const session = this.agentRegistry.findByAgentId(agentId);
    if (!session) return;

    session.missedPings = 0;
    session.lastSeenAt = new Date();

    // Refresh Redis presence key so other hub instances know this agent is alive
    this.redis
      .set(`hub:agent:${session.accountId}:${session.label}`, this.hubInstanceId, {
        ex: TIMING.AGENT_PRESENCE_TTL_SEC,
      })
      .catch(() => {});
  }

  private tick(): void {
    const now = Date.now();
    const pingStr = serialize({ v: '1', type: 'hub:ping', ts: now });

    // Two-pass: send pings first, then evict — avoid mutating while iterating
    const sessions = this.agentRegistry.allSessions();

    for (const session of sessions) {
      try {
        session.ws.send(pingStr);
        session.missedPings += 1;
      } catch {
        session.missedPings += 1;
      }
    }

    for (const session of sessions) {
      if (session.missedPings >= TIMING.MAX_MISSED_PINGS) {
        this.evict(session, 'missed_pings');
      }
    }
  }

  evict(session: AgentSession, reason: string): void {
    this.agentRegistry.evict(session.accountId, session.label);

    const rejected = this.pendingRegistry.rejectAllForAgent(session.accountId, session.label);

    this.sessionRepo.markDisconnected(session.agentId, 'EVICTED').catch(() => {});
    this.redis.del(`hub:agent:${session.accountId}:${session.label}`).catch(() => {});
    void releaseSubdomain(this.subdomains, session);

    try {
      session.ws.close();
    } catch {}

    console.info(
      {
        agentId: session.agentId,
        accountId: session.accountId,
        label: session.label,
        reason,
        rejected,
      },
      '[heartbeat] agent evicted',
    );
  }
}
