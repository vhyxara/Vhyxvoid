// apps/hub/src/main.ts
// Hub process entry point. Separate Node.js process from apps/api.
// Shares Redis and Postgres with apps/api — never shares process memory.

import 'dotenv/config';
import { HubServer } from '@/HubServer';
import { TunnelSessionRepository } from '@/repositories/TunnelSession.repository';
import { TunnelRequestRepository } from '@/repositories/TunnelRequest.repository';
import {
  buildValidateApiKeyUseCase,
  buildDbApiKeyLoader,
  getRedisClient,
  createPrismaSettingsReader,
  installSettingsReader,
} from '@vhyxvoid/shared';

// ── App-specific Prisma import ────────────────────────────────────────────────
// This is the ONLY place in the hub that imports Prisma.
// Adjust the path to match your project's generator output setting.
// Common options:
//   import { PrismaClient } from '@prisma/client'         // default output
//   import { PrismaClient } from '../../src/generated/prisma' // custom output
//   import { PrismaClient } from '@/generated/prisma'     // with path alias (API only)
//
// Since hub is in apps/hub/ with no @/ alias, use relative path:
// import { PrismaClient } from '../../packages/shared/node_modules/.prisma/client';
// import { PrismaClient } from '../../../packages/shared/node_modules/@prisma/client';
import { PrismaClient } from '@vhyxvoid/shared/generated/prisma/client';
// ─── OR if you run `prisma generate` inside apps/hub/, just use:
// import { PrismaClient } from '@prisma/client';
// ─── The simplest approach: symlink/copy the generated client into hub.
// See integration-notes.ts for the full setup guide.

async function main() {
  const port = parseInt(process.env.HUB_PORT ?? '9001', 10);
  const pepper = process.env.SERVER_HMAC_PEPPER;

  // ── Env validation ──────────────────────────────────────────────────────────
  if (!pepper || pepper.length < 32) {
    throw new Error(
      'SERVER_HMAC_PEPPER must be at least 32 characters.\n' + 'Generate: openssl rand -hex 32',
    );
  }
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required');
  }
  // if (!process.env.DATABASE_URL) {
  //   throw new Error('DATABASE_URL is required');
  // }

  // const redis = new Redis({
  //   url: process.env.UPSTASH_REDIS_REST_URL,
  //   token: process.env.UPSTASH_REDIS_REST_TOKEN,
  // });

  // ── Infrastructure ───────────────────────────────────────────────────────────
  const redis = getRedisClient();
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  await prisma.$connect();
  console.info('[hub] ✅ Postgres connected');

  // Admin-panel settings (plan overrides, incident switches), cached 30 s.
  installSettingsReader(createPrismaSettingsReader(prisma));

  // const prisma = new PrismaClient();
  // await prisma.$connect();

  // ── Repositories ─────────────────────────────────────────────────────────────
  const tunnelSessionRepo = new TunnelSessionRepository(prisma);
  const tunnelRequestRepo = new TunnelRequestRepository(prisma);

  // ── ValidateApiKeyUseCase ────────────────────────────────────────────────────
  // buildDbApiKeyLoader wraps prisma into the DbApiKeyLoader interface.
  // shared/ never imports Prisma — it receives a plain async function.
  const loadKey = buildDbApiKeyLoader(prisma);
  const validateKeyUseCase = buildValidateApiKeyUseCase({ redis, loadKey });

  const loadKeyHash = async (keyId: string) => {
    // Try Redis cache first
    const cached = await redis.get<string>(`apikey:data:${keyId}`);
    if (cached) {
      const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      return {
        secretHash: parsed.secretHash,
        accountId: parsed.accountId,
        scopes: parsed.scopes as string[],
        status: parsed.status,
        accountStatus: parsed.accountStatus,
        // Both cache writers (apps/api buildCachePayload, packages/shared
        // rowToCache) store these as unix ms / null.
        expiresAt: parsed.expiresAt ?? null,
        previousSecretHash: parsed.previousSecretHash ?? null,
        rotationGraceEndsAt: parsed.rotationGraceEndsAt ?? null,
      };
    }

    // DB fallback
    const row = await prisma.apiKey.findUnique({
      where: { keyId },
      select: {
        secretHash: true,
        accountId: true,
        scopes: true,
        status: true,
        expiresAt: true,
        previousSecretHash: true,
        rotationGraceEndsAt: true,
        account: { select: { status: true } },
      },
    });

    if (!row) return null;

    return {
      secretHash: row.secretHash,
      accountId: row.accountId,
      scopes: row.scopes.map((s: any) => s.scope),
      status: row.status,
      accountStatus: row.account.status,
      expiresAt: row.expiresAt?.getTime() ?? null,
      previousSecretHash: row.previousSecretHash ?? null,
      rotationGraceEndsAt: row.rotationGraceEndsAt?.getTime() ?? null,
    };
  };

  // ── Start hub ────────────────────────────────────────────────────────────────
  const hub = new HubServer({
    port,
    // Stable across restarts so start-up cleanup finds the previous run's
    // sessions and routes (audit H7). One hub process per id.
    hubInstanceId: process.env.HUB_INSTANCE_ID || 'hub-primary',
    hubDomain: process.env.HUB_DOMAIN ?? 'vhyxvoid.com',
    pepper: process.env.SERVER_HMAC_PEPPER!,
    loadKeyHash, // ← defined here where prisma is in scope
    redis,
    validateKeyUseCase,
    tunnelSessionRepo,
    tunnelRequestRepo,
    prisma,
  });

  await hub.start();

  console.info({ port, env: process.env.NODE_ENV ?? 'development' }, '[hub] ✅ Ready');

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  let stopping = false;
  const shutdown = async (signal: string, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    console.info({ signal }, '[hub] shutting down gracefully...');
    // Never hang a deploy: give cleanup 10 s.
    const force = setTimeout(() => process.exit(exitCode), 10_000);
    force.unref();
    await hub.stop().catch((err) => console.error({ err }, '[hub] stop failed'));
    await prisma.$disconnect().catch(() => {});
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Log but keep running — hub must be resilient to single-request failures
  process.on('unhandledRejection', (reason) => {
    console.error({ reason }, '[hub] unhandledRejection — continuing');
  });
  // After an uncaught exception the process state is undefined: clean up
  // and exit so the container restarts (audit M13).
  process.on('uncaughtException', (err) => {
    console.error({ err }, '[hub] uncaughtException — exiting');
    void shutdown('uncaughtException', 1);
  });
}

main().catch((err) => {
  console.error('[hub] fatal startup error', err);
  process.exit(1);
});
