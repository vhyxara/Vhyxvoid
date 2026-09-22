// apps/hub/src/services/AccountStatusSweep.service.ts
//
// Closes the "no status check exists on live traffic" half of context.md
// Known Risk #57's E6: an account's status is checked at agent-registration
// time (HubAuthService.authenticateAgent) but never again for the lifetime
// of the connection, so a suspension or cancellation did nothing to an
// agent that was already connected. This periodic sweep (same shape as
// HeartbeatService, which it runs alongside, not instead of) closes that —
// every ~60s it reads the real current status of every connected account
// and evicts any that are no longer connectable, sending a real hub:error
// first so the agent can print why (matching the same AUTH_FAILED wording
// and fatal-stop behavior the agent already has for a rejected handshake —
// AgentClient.onHubError treats them identically, so a suspension midway
// through a session and a suspension the agent discovers by trying to
// reconnect look the same to a developer reading the output).
//
// See shared/decision.md, 2026-09-22, "S4".

import { serialize } from '@vhyxvoid/protocol';
import { isConnectableAccountStatus } from '@vhyxvoid/shared';
import type { AgentRegistry, AgentSession } from '@/registry/Agent.registry';
import type { PendingRegistry } from '@/registry/Pending.registry';
import type { TunnelSessionRepository } from '@/repositories/TunnelSession.repository';
import type { HttpTunnelHandler } from '@/handlers/HttpTunnel.handler';

const SWEEP_INTERVAL_MS = 60_000;

export class AccountStatusSweepService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly pendingRegistry: PendingRegistry,
    private readonly sessionRepo: TunnelSessionRepository,
    private readonly httpTunnelHandler: HttpTunnelHandler,
    private readonly redis: { del: (key: string) => Promise<unknown> },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), SWEEP_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    const sessions = this.agentRegistry.allSessions();
    if (sessions.length === 0) return;

    // One batched query for every distinct connected account, not one per
    // session — a sweep is O(accounts), not O(agents), at the database.
    const accountIds = [...new Set(sessions.map((s) => s.accountId))];
    let statuses: Map<string, string>;
    try {
      statuses = await this.sessionRepo.findStatusesByAccountIds(accountIds);
    } catch (err) {
      // A failed sweep this interval is not an outage — it just tries again
      // in ~60s. Never let a DB hiccup here touch a live connection.
      console.error({ err }, '[sweep] failed to read account statuses, skipping this tick');
      return;
    }

    for (const session of sessions) {
      const status = statuses.get(session.accountId);
      // An account whose row we couldn't find (deleted, or a transient read
      // gap) is treated the same as any other non-connectable status —
      // never treated as implicitly fine.
      if (status !== undefined && isConnectableAccountStatus(status)) continue;
      this.evict(session, status ?? 'unknown');
    }
  }

  private evict(session: AgentSession, accountStatus: string): void {
    // Sent before any cleanup — a socket that's already gone just no-ops
    // (sendToWs-style catch), it never blocks the eviction itself.
    try {
      session.ws.send(
        serialize({
          v: '1',
          type: 'hub:error',
          code: 'AUTH_FAILED',
          message: 'Account is not active',
          fatal: true,
        } as any),
      );
    } catch {
      // socket already closed — nothing to send to
    }

    this.agentRegistry.evict(session.accountId, session.label);
    const rejected = this.pendingRegistry.rejectAllForAgent(session.accountId, session.label);
    this.httpTunnelHandler.closeAllForAgent(session.agentId, 1008, 'Account is not active');

    this.sessionRepo.markDisconnected(session.agentId, 'EVICTED').catch(() => {});
    this.redis.del(`hub:agent:${session.accountId}:${session.label}`).catch(() => {});

    try {
      session.ws.close();
    } catch {
      // already closed
    }

    console.info(
      {
        agentId: session.agentId,
        accountId: session.accountId,
        label: session.label,
        accountStatus,
        rejected,
      },
      '[sweep] agent evicted — account not connectable',
    );
  }
}
