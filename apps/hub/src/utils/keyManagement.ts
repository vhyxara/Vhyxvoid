import { getRedis } from '@/core/redis';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/config/prisma';
import { ApiKey } from '../generated/prisma/client';

export function generateApiKey(environment: 'DEV' | 'PROD') {
  const prefix = environment === 'PROD' ? 'bksr_live_' : 'bksr_dev_';
  return prefix + crypto.randomBytes(12).toString('hex');
}

export function generateApiSecret() {
  return 'sk_' + crypto.randomBytes(32).toString('hex');
}

export function hashSecret(secret: string) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function requireScope(ctx: any, scope: string) {
  if (!ctx.scopes.includes(scope)) {
    throw new Error('insufficient_scope');
  }
}

export async function rateLimitApiKey(apiKeyId: string, limit: number, windowSec = 60) {
  const redis = getRedis();
  const key = `rate:${apiKeyId}:${windowSec}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSec);
  }

  if (count > limit) {
    throw new Error('rate_limited');
  }
}

export function verifySignatureWithRotation(canonical: string, signature: string, apiKey: ApiKey) {
  const valid = (hash: string) =>
    crypto.timingSafeEqual(
      Buffer.from(crypto.createHmac('sha256', hash).update(canonical).digest('hex')),
      Buffer.from(signature),
    );

  if (valid(apiKey.secretHash)) return true;
  if (apiKey.previousSecretHash && valid(apiKey.previousSecretHash)) return true;

  return false;
}

export function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

export async function bcryptHashSecret(secret: string) {
  return bcrypt.hash(secret, 12);
}

export function verifyWithRotation(canonical: string, signature: string, apiKey: ApiKey) {
  const verify = (hash: string) => {
    const expected = crypto.createHmac('sha256', hash).update(canonical).digest('hex');

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  };

  if (verify(apiKey.secretHash)) return true;

  if (
    apiKey.previousSecretHash &&
    apiKey.expiresAt &&
    Date.now() < apiKey.expiresAt.getTime() &&
    verify(apiKey.previousSecretHash)
  ) {
    return true;
  }

  return false;
}

const usageMap = new Map<UsageKey, UsageEntry>();

export function getBucketDate() {
  const d = new Date();
  d.setMinutes(0, 0, 0); // hourly buckets
  return d.toISOString();
}

export function recordUsage({
  apiKeyId,
  scope,
  endpoint,
  method,
}: {
  apiKeyId: string;
  scope: string;
  endpoint: string;
  method: string;
}) {
  const bucket = getBucketDate();
  const key = `${apiKeyId}:${scope}:${endpoint}:${method}:${bucket}`;

  const existing = usageMap.get(key);

  if (existing) {
    existing.count++;
  } else {
    usageMap.set(key, {
      apiKeyId,
      scope,
      endpoint,
      method,
      count: 1,
    });
  }
}

setInterval(async () => {
  if (usageMap.size === 0) return;

  const entries = Array.from(usageMap.entries());
  usageMap.clear();

  for (const [key, usage] of entries) {
    const [, , , , bucket] = key.split(':');

    await prisma.apiKeyUsage.upsert({
      where: {
        apiKeyId_scope_endpoint_method_date: {
          apiKeyId: usage.apiKeyId,
          scope: usage.scope,
          endpoint: usage.endpoint,
          method: usage.method,
          date: new Date(bucket),
        },
      },
      update: {
        count: { increment: usage.count },
      },
      create: {
        ...usage,
        date: new Date(bucket),
      },
    });
  }
}, 60_000);

// async function handleFrontendRequest(ws: WebSocket, msg: any) {
//   let ctx;

//   try {
//     ctx = await verifyApiKey(msg);
//   } catch (e: any) {
//     ws.send(
//       JSON.stringify({
//         type: "error",
//         error: e.message,
//         requestId: msg.requestId,
//         code: 403,
//       })
//     );
//     return;
//   }

//   // Optional: scope enforcement
//   // requireScope(ctx, "hub.request.send");

//   // IMPORTANT:
//   // msg is forwarded AS-IS to agent
//   routeRequestToAgent(msg.agentId, msg);
// }
