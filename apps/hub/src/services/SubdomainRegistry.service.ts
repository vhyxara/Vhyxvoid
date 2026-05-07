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

  // Called in handleAgentRegister after session is persisted
  async register(entry: SubdomainEntry): Promise<void> {
    const key = this.key(entry.label, entry.accountSlug);
    await this.redis.set(key, JSON.stringify(entry));
  }

  // Called in onAgentClose
  async unregister(label: string, accountSlug: string): Promise<void> {
    await this.redis.del(this.key(label, accountSlug));
  }

  // Called by hub HTTP handler to route incoming requests
  async resolve(label: string, accountSlug: string): Promise<SubdomainEntry | null> {
    const raw = await this.redis.get<string>(this.key(label, accountSlug));
    if (!raw) return null;
    try {
      // Upstash may return already-parsed object — handle both cases
      if (typeof raw === 'object') return raw as unknown as SubdomainEntry;
      return JSON.parse(raw) as SubdomainEntry;
    } catch {
      return null;
    }
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
