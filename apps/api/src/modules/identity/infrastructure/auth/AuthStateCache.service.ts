// ─────────────────────────────────────────────────────────────────────────────
// AuthStateCache
//
// Access tokens are self-contained JWTs, so on their own they can't be revoked:
// logout, password reset, admin disable and super-admin demotion used to take
// effect only when the token expired (100 h before audit H2). The guards now
// check each token against the subject's CURRENT auth state:
//
//   user  → tokenVersion (bumped by logout, logout-all, password reset/change)
//           and whether the user is still active (status, not deleted)
//   admin → whether the admin is still active, and the real isSuperAdmin
//           (the JWT claim is only what was true at sign time)
//
// Cached in Redis for AUTH_STATE_TTL_SEC so a request costs one Redis GET, not
// a Postgres query. Every code path that changes this state calls
// invalidateUser()/invalidateAdmin() after its write commits, so those changes
// apply on the next request; the TTL bounds anything that changes without a
// hook (e.g. isSuperAdmin edited directly in the database: no API route can
// change it). Redis failures fall back to Postgres (correct, just slower).
//
// Invalidation follows AccountKeyCacheInvalidator's pattern (billing, S4): a
// thin service injected where the state changes, failing soft because the
// database write has already committed. See api/decision.md, 2026-09-24, "H2".
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis } from "@upstash/redis";

export interface UserAuthState {
  tokenVersion: number;
  active: boolean;
}

export interface AdminAuthState {
  active: boolean;
  isSuperAdmin: boolean;
}

export interface AuthStateLoaders {
  loadUser(userId: string): Promise<UserAuthState | null>;
  loadAdmin(adminId: string): Promise<AdminAuthState | null>;
}

export const AUTH_STATE_TTL_SEC = 30;

const KEY = {
  user: (id: string) => `auth:user:${id}`,
  admin: (id: string) => `auth:admin:${id}`,
} as const;

export class AuthStateCache {
  constructor(
    // A getter, not a client: the api's Redis client is initialised by a
    // plugin registered after the guards.
    private readonly getRedis: () => Redis | null,
    private readonly loaders: AuthStateLoaders,
  ) {}

  getUser(userId: string): Promise<UserAuthState | null> {
    return this.get(KEY.user(userId), () => this.loaders.loadUser(userId));
  }

  getAdmin(adminId: string): Promise<AdminAuthState | null> {
    return this.get(KEY.admin(adminId), () => this.loaders.loadAdmin(adminId));
  }

  invalidateUser(userId: string): Promise<void> {
    return this.invalidate(KEY.user(userId));
  }

  invalidateAdmin(adminId: string): Promise<void> {
    return this.invalidate(KEY.admin(adminId));
  }

  private async get<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const redis = this.getRedis();
    if (redis) {
      try {
        const hit = await redis.get<T | string>(key);
        if (hit !== null && hit !== undefined) {
          return (typeof hit === "string" ? JSON.parse(hit) : hit) as T;
        }
      } catch {
        // Fall through to Postgres.
      }
    }

    const state = await load();
    // Only a real subject is cached; an unknown id is rejected by the caller.
    if (state && redis) {
      try {
        await redis.set(key, JSON.stringify(state), { ex: AUTH_STATE_TTL_SEC });
      } catch {
        // Not fatal: the next request reads Postgres again.
      }
    }
    return state;
  }

  private async invalidate(key: string): Promise<void> {
    const redis = this.getRedis();
    if (!redis) return;
    try {
      await redis.del(key);
    } catch (err) {
      console.error(
        { key, err: (err as Error).message },
        "[auth] failed to invalidate cached auth state; it expires on its own within the TTL",
      );
    }
  }
}

/** Postgres loaders for the real app (Prisma client from fastify.prisma). */
export function prismaAuthStateLoaders(prisma: {
  user: { findUnique(args: any): Promise<any> };
  adminUser: { findUnique(args: any): Promise<any> };
}): AuthStateLoaders {
  return {
    async loadUser(userId) {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { tokenVersion: true, status: true, deletedAt: true },
      });
      return u ? { tokenVersion: u.tokenVersion, active: !!u.status && !u.deletedAt } : null;
    },
    async loadAdmin(adminId) {
      const a = await prisma.adminUser.findUnique({
        where: { id: adminId },
        select: { status: true, deletedAt: true, isSuperAdmin: true },
      });
      return a ? { active: !!a.status && !a.deletedAt, isSuperAdmin: !!a.isSuperAdmin } : null;
    },
  };
}
