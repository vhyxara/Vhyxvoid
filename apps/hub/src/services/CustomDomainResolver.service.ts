// apps/hub/src/services/CustomDomainResolver.service.ts
//
// Maps a verified custom hostname (customer's own domain) to the tunnel it
// serves. Only hostnames that are not the platform's own are looked up
// (isCandidate), answers are cached (found 60 s, not found 30 s), and the
// API drops an entry at once through /internal/domains/invalidate when a
// domain is verified, moved to another tunnel or removed.
//
// A lookup failure answers "not found" for this request without caching it:
// the caller then serves a 404 rather than guessing a route.

import { isIP } from 'node:net';

import type { TunnelRoute } from '@/handlers/HttpTunnel.handler';

const FOUND_TTL_MS = 60_000;
const MISSING_TTL_MS = 30_000;
const MAX_ENTRIES = 50_000;

type Prisma = any; // the generated client (apps/api owns the schema)

export interface ResolvedDomain extends TunnelRoute {
  accountId: string;
}

export class CustomDomainResolver {
  private readonly cache = new Map<string, { value: ResolvedDomain | null; expiresAt: number }>();

  constructor(
    private readonly prisma: Prisma,
    private readonly platformDomain: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Could this hostname be a customer's domain (as opposed to ours, an IP, a container name)? */
  isCandidate(hostname: string): boolean {
    if (!hostname || hostname.length > 253 || !hostname.includes('.')) return false;
    if (isIP(hostname) || hostname.startsWith('[')) return false;
    const p = this.platformDomain.toLowerCase();
    if (hostname === p || hostname.endsWith(`.${p}`)) return false;
    return hostname !== 'localhost' && !hostname.endsWith('.localhost');
  }

  async resolve(hostname: string): Promise<ResolvedDomain | null> {
    const hit = this.cache.get(hostname);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    let value: ResolvedDomain | null = null;
    try {
      const row = await this.prisma.customDomain.findFirst({
        where: { hostname, verifiedAt: { not: null } },
        select: { accountId: true, label: true, account: { select: { slug: true, status: true } } },
      });
      if (row?.account?.slug && row.account.status !== 'DELETED') {
        value = { accountId: row.accountId, label: row.label, accountSlug: row.account.slug };
      }
    } catch (err) {
      console.warn({ err: (err as Error).message, hostname }, '[domains] lookup failed');
      return null;
    }
    if (this.cache.size >= MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(hostname, { value, expiresAt: this.now() + (value ? FOUND_TTL_MS : MISSING_TTL_MS) });
    return value;
  }

  invalidate(hostname?: string): void {
    if (hostname) this.cache.delete(hostname.toLowerCase());
    else this.cache.clear();
  }
}
