// ─────────────────────────────────────────────────────────────────────────────
// apps/hub/src/services/HubPubSub.ts
// Cross-hub message routing via Redis pub/sub.
// Phase 1: single hub — all methods are noops.
// Phase 2: uncomment Redis subscribe/publish for multi-hub deployment.
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis as RedisU } from '@upstash/redis';
import type { TunnelForwardMsg } from '@platform/protocol';

export class HubPubSub {
  constructor(
    private readonly redis: RedisU,
    private readonly hubInstanceId: string,
    private readonly onForward: (msg: TunnelForwardMsg) => void,
  ) {}

  async start(): Promise<void> {
    // Phase 2: subscribe to hub:instance:{hubInstanceId} channel
    // For now: noop — single instance owns all agents
  }

  async stop(): Promise<void> {
    // Phase 2: unsubscribe
  }

  /**
   * Find which hub instance owns an agent.
   * Returns null if agent not registered in any hub (truly offline).
   * Used by MessageRouter to support cross-hub routing.
   */
  async findAgentHub(accountId: string, label: string): Promise<string | null> {
    return this.redis.get<string>(`hub:agent:${accountId}:${label}`);
  }

  /**
   * Publish a forward request to another hub instance.
   * Phase 1: noop (same-instance routing handled directly).
   * Phase 2: publish to hub:instance:{targetHubId} Redis channel.
   */
  async publishForward(targetHubId: string, msg: TunnelForwardMsg): Promise<void> {
    if (targetHubId === this.hubInstanceId) return; // local — handle directly
    // Phase 2: await this.redis.publish(`hub:instance:${targetHubId}`, JSON.stringify(msg));
  }
}
