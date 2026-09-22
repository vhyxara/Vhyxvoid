// packages/shared/src/clients.ts
// Redis client factory — used by both apps/api and apps/hub.
// NO Prisma here — each app creates its own Prisma instance with its own path.
//
// Also exports buildDbApiKeyLoader() — a helper that wraps any Prisma-like
// client into the DbApiKeyLoader interface validateApiKey.ts needs.

import { Redis } from "@upstash/redis";
import type { DbApiKeyLoader, ApiKeyRow } from "./types";
import { PLAN_LIMITS } from "./planLimits";
import { resolvePlanForAccount } from "./planResolver";
import { toStoredRateLimit } from "./validateApiKey";

// ── Redis factory ─────────────────────────────────────────────────────────────

let redisInstance: Redis | null = null;

/**
 * Get (or create) the Redis singleton for this process.
 * Call once in main.ts, pass the instance via DI.
 */
export function getRedisClient(): Redis {
  if (!redisInstance) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      throw new Error(
        "Missing env vars: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
      );
    }

    redisInstance = new Redis({ url, token });
  }
  return redisInstance;
}

export function createRedisClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN",
    );
  }
  return new Redis({ url, token });
}

// ── DbApiKeyLoader builder ────────────────────────────────────────────────────
//
// Usage in apps/hub/src/main.ts:
//
//   import { PrismaClient } from '@/generated/prisma';  // your app's generated path
//   import { buildDbApiKeyLoader } from '@vhyxvoid/shared';
//
//   const prisma  = new PrismaClient();
//   const loadKey = buildDbApiKeyLoader(prisma);
//   const validateKeyUseCase = buildValidateApiKeyUseCase({ redis, loadKey });
//
// The prisma object is typed as `any` here so shared/ doesn't need to import
// from @prisma/client or @/generated/prisma — both of which are app-specific.

export function buildDbApiKeyLoader(prisma: any): DbApiKeyLoader {
  return async (keyId: string): Promise<ApiKeyRow | null> => {
    try {
      const row = await prisma.apiKey.findUnique({
        where: { keyId },
        include: {
          scopes: { select: { scope: true } },
          account: { select: { status: true } },
        },
      });

      if (!row) return null;

      // The plan's per-minute rate limit, by the same rule API-key creation
      // uses, so a cache reload (after the 5-minute TTL, a rotation, an update,
      // a revoke...) yields the same limit CreateApiKey cached. If the plan
      // lookup fails the key is left unlimited, as every reload was before.
      let rateLimitPerMinute: number | undefined;
      try {
        const plan = await resolvePlanForAccount(prisma, row.accountId);
        // ENTERPRISE's limit is Infinity; store the same -1 convention
        // rowToCache below uses, rather than leaving Infinity on the row for
        // whatever JSON.stringifies it next to turn into null (E2b's class
        // of bug).
        rateLimitPerMinute = toStoredRateLimit(PLAN_LIMITS[plan].rateLimitPerMinute);
      } catch {
        rateLimitPerMinute = undefined;
      }

      return {
        keyId: row.keyId,
        secretHash: row.secretHash,
        previousSecretHash: row.previousSecretHash ?? null,
        rotationGraceEndsAt: row.rotationGraceEndsAt ?? null,
        status: row.status,
        accountId: row.accountId,
        accountStatus: row.account.status,
        scopes: row.scopes.map((s: { scope: string }) => s.scope),
        expiresAt: row.expiresAt ?? null,
        rateLimitPerMinute,
      } satisfies ApiKeyRow;
    } catch {
      return null;
    }
  };
}
