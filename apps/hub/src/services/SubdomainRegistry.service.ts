// apps/hub/src/services/SubdomainRegistry.ts
//
// Manages the subdomain → agent mapping in Redis.
// Written on agent connect, deleted on agent disconnect.
//
// Key format: tunnel:sub:{label}.{accountSlug}
// Value:      JSON { agentId, accountId, label, hubInstanceId }
//
// TTL: none — key lives until explicitly deleted on disconnect.
// If the hub crashes without deleting, the key becomes stale.
// HubServer.evictStaleForInstance() handles this on startup.

import { Redis } from '@upstash/redis';

const PREFIX = 'tunnel:sub:';

export interface SubdomainEntry {
  agentId: string;
  accountId: string;
  label: string;
  accountSlug: string;
  hubInstanceId: string;
}

export class SubdomainRegistry {
  constructor(private readonly redis: Redis) {}

  // Per-key async mutex. register()/unregister() for the same
  // (label,accountSlug) key run from two genuinely independent WS
  // connections (an old agent's close handler and a new agent's register
  // handler) with no ordering guarantee between their Redis round-trips —
  // this serializes them so they can never interleave. See context.md
  // risk #19 and decision.md, 2026-09-14, "onAgentClose cross-connection
  // race, real fix".
  private readonly locks = new Map<string, Promise<unknown>>();

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve();
    const result = prior.then(fn, fn);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, settled);
    settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key);
    });
    return result;
  }

  // Called in handleAgentRegister after session is persisted
  async register(entry: SubdomainEntry): Promise<void> {
    const key = this.key(entry.label, entry.accountSlug);
    return this.withLock(key, async () => {
      await this.redis.set(key, JSON.stringify(entry));
    });
  }

  // Called in onAgentClose (and HttpTunnelHandler's stale-entry cleanup).
  // expectedAgentId makes this a compare-and-delete, not a blind delete:
  // combined with the per-key lock above, this is what actually closes
  // the race, not just narrows it. Without it, a slow unregister() from
  // an old connection could run (in either order) around a fast
  // register() from a reconnecting agent on the same label and delete the
  // brand-new, correct entry — the exact bug context.md risk #19
  // documented as still open after the 2026-09-12 await fix. With the
  // identity check, an unregister() that loses the race (a newer agentId
  // has already taken over this label by the time it runs) becomes a
  // correct no-op instead of an incorrect delete, regardless of which of
  // the two independent async chains happens to finish first.
  async unregister(label: string, accountSlug: string, expectedAgentId: string): Promise<void> {
    const key = this.key(label, accountSlug);
    return this.withLock(key, async () => {
      const current = await this.getEntry(key);
      if (!current) return; // already gone — nothing to do
      if (current.agentId !== expectedAgentId) return; // superseded — not ours to remove
      await this.redis.del(key);
    });
  }

  private async getEntry(key: string): Promise<SubdomainEntry | null> {
    const raw = await this.redis.get<string>(key);
    if (!raw) return null;
    try {
      if (typeof raw === 'object') return raw as unknown as SubdomainEntry;
      return JSON.parse(raw) as SubdomainEntry;
    } catch {
      return null;
    }
  }

  // Called by hub HTTP handler to route incoming requests
  async resolve(label: string, accountSlug: string): Promise<SubdomainEntry | null> {
    return this.getEntry(this.key(label, accountSlug));
  }

  // Called on hub startup to clean up stale keys from crashed instances
  async unregisterAllForHub(hubInstanceId: string): Promise<void> {
    let cursor = 0;
    do {
      const res = await this.redis.scan(cursor, {
        match: `${PREFIX}*`,
        count: 100,
      });
      cursor = Number(res[0]);
      const keys = res[1] as string[];

      for (const key of keys) {
        const raw = await this.redis.get<string>(key);
        if (!raw) continue;
        try {
          // const entry = JSON.parse(raw) as SubdomainEntry;
          const entry =
            typeof raw === 'object'
              ? (raw as unknown as SubdomainEntry)
              : (JSON.parse(raw) as SubdomainEntry);
          if (entry.hubInstanceId === hubInstanceId) {
            await this.redis.del(key);
          }
        } catch {
          // Corrupted key — delete it
          await this.redis.del(key);
        }
      }
    } while (cursor !== 0);
  }

  // private key(label: string, accountSlug: string): string {
  //   return `${PREFIX}${label}.${accountSlug}`;
  // }
  // Change the key format to match:
  private key(label: string, accountSlug: string): string {
    return `${PREFIX}${accountSlug}--${label}`;
  }
}
