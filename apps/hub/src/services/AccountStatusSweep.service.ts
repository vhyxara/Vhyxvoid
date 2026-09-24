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
import { secretFingerprint } from '@/services/HubAuth.service';
import type { AgentRegistry, AgentSession } from '@/registry/Agent.registry';
import type { PendingRegistry } from '@/registry/Pending.registry';
import type { TunnelSessionRepository } from '@/repositories/TunnelSession.repository';
import type { HttpTunnelHandler } from '@/handlers/HttpTunnel.handler';

const SWEEP_INTERVAL_MS = 60_000;

interface KeyState {
  status: string;
  expiresAt: Date | null;
  rotationGraceEndsAt: Date | null;
  secretHash?: string;
  previousSecretHash?: string | null;
}
type KeyStates = Map<string, KeyState>;

/** Why a connection's key no longer admits it, or null if it still does. */
function keyRejection(key: KeyState | undefined, session: AgentSession, now: number): string | null {
  if (!key) return 'API key no longer exists';
  if (key.status === 'REVOKED') return 'API key has been revoked';
  if (key.status === 'EXPIRED') return 'API key has expired';
  if (key.status !== 'ACTIVE') return `API key is ${key.status.toLowerCase()}`;
  if (key.expiresAt && key.expiresAt.getTime() <= now) return 'API key has expired';

  // Rotation: the connection's secret must still be the key's current one,
  // or its previous one while the grace window is open.
  if (session.secretFingerprint && key.secretHash) {
    if (secretFingerprint(key.secretHash) === session.secretFingerprint) return null;
    const graceOpen = !!key.rotationGraceEndsAt && key.rotationGraceEndsAt.getTime() > now;
    const isPrevious =
      !!key.previousSecretHash && secretFingerprint(key.previousSecretHash) === session.secretFingerprint;
    if (!(isPrevious && graceOpen)) {
      return "API key was rotated and the old secret's grace period has ended";
    }
  }
  return null;
}

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

    const accountIds = [...new Set(sessions.map((s) => s.accountId))];
    let statuses: Map<string, string>;
    try {
      statuses = await this.sessionRepo.findStatusesByAccountIds(accountIds);
    } catch (err) {
      console.error({ err }, '[sweep] failed to read account statuses, skipping this tick');
      return;
    }

    // The key each connection authenticated with: revoked, expired, deleted,
    // or (for a connection made with the previous secret) past its rotation
    // grace window. The handshake is the only other check, so without this a
    // revoked key's live agent kept serving (audit H3). Read from Postgres,
    // not the 5-minute key cache, so a revoke is seen on the next tick.
    // A failed read skips only the key checks, like the account read above.
    const keyIds = [...new Set(sessions.map((s) => s.keyId))];
    let keyStates: KeyStates | null = null;
    try {
      keyStates = await this.sessionRepo.findKeyStatesByIds(keyIds);
    } catch (err) {
      console.error({ err }, '[sweep] failed to read API key states, skipping key checks this tick');
    }

    const now = Date.now();
    for (const session of sessions) {
      const status = statuses.get(session.accountId);
      if (status === undefined || !isConnectableAccountStatus(status)) {
        this.evict(session, 'Account is not active', { accountStatus: status ?? 'unknown' });
        continue;
      }
      if (!keyStates) continue;
      const reason = keyRejection(keyStates.get(session.keyId), session, now);
      if (reason) this.evict(session, reason, { keyId: session.keyId });
    }
  }

  private evict(session: AgentSession, message: string, detail: Record<string, unknown>): void {
    // Sent before any cleanup — a socket that's already gone just no-ops
    // (sendToWs-style catch), it never blocks the eviction itself.
    try {
      session.ws.send(
        serialize({
          v: '1',
          type: 'hub:error',
          code: 'AUTH_FAILED',
          message,
          fatal: true,
        } as any),
      );
    } catch {
      // socket already closed — nothing to send to
    }

    this.agentRegistry.evict(session.accountId, session.label);
    const rejected = this.pendingRegistry.rejectAllForAgent(session.accountId, session.label);
    this.httpTunnelHandler.closeAllForAgent(session.agentId, 1008, message);

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
        reason: message,
        ...detail,
        rejected,
      },
      '[sweep] agent evicted',
    );
  }
}
