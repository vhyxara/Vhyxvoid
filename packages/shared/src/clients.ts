// packages/shared/src/clients.ts
// Redis client factory — used by both apps/api and apps/hub.
// NO Prisma here — each app creates its own Prisma instance with its own path.
//
// Also exports buildDbApiKeyLoader() — a helper that wraps any Prisma-like
// client into the DbApiKeyLoader interface validateApiKey.ts needs.

import { Redis } from "@upstash/redis";
import type { DbApiKeyLoader, ApiKeyRow } from "./types";

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
      } satisfies ApiKeyRow;
    } catch {
      return null;
    }
  };
}
