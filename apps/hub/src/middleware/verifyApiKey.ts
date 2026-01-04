import { prisma } from '@/config/prisma';
import { getRedis } from '@/core/redis';
import crypto from 'crypto';

const SIGNATURE_WINDOW_MS = 60_000;

export async function verifyApiKey(msg: any) {
  const meta = msg.meta || {};
  const apiKeyValue = meta.apiKey;
  const signature = meta.signature;
  const ts = msg.ts;
  const requestId = msg.requestId;

  if (!apiKeyValue || !signature || !ts || !requestId) {
    throw new Error('missing_auth_fields');
  }

  // 1️⃣ Load ApiKey
  const apiKey = await prisma.apiKey.findUnique({
    where: { key: apiKeyValue },
    include: { scopes: true },
  });

  if (!apiKey) throw new Error('invalid_api_key');
  if (apiKey.status !== 'ACTIVE') throw new Error('key_revoked');

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    throw new Error('key_expired');
  }

  // 2️⃣ Time window check
  const now = Date.now();
  if (Math.abs(now - ts) > SIGNATURE_WINDOW_MS) {
    throw new Error('signature_expired');
  }

  // 3️⃣ Replay protection (Redis)
  const redis = getRedis();
  const replayKey = `replay:${apiKeyValue}:${requestId}`;

  const seen = await redis.get(replayKey);
  if (seen) throw new Error('replay_detected');

  await redis.set(replayKey, '1', 'PX', SIGNATURE_WINDOW_MS);

  // 4️⃣ Reconstruct canonical string
  const body = msg.body ? Buffer.from(msg.body, 'base64').toString() : '';

  const bodyHash = body ? crypto.createHash('sha256').update(body).digest('hex') : '';

  const canonical = [msg.method.toUpperCase(), msg.path, bodyHash, requestId, ts].join('|');

  // 5️⃣ Verify signature
  const expected = crypto.createHmac('sha256', apiKey.secretHash).update(canonical).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new Error('invalid_signature');
  }

  // 6️⃣ Rate limiting
  const rateKey = `rate:${apiKeyValue}`;
  const limit = apiKey.rateLimit ?? 100;

  const count = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, 60);
  if (count > limit) throw new Error('rate_limited');

  // 7️⃣ Attach context (DO NOT MODIFY PAYLOAD)
  return {
    apiKeyId: apiKey.id,
    ownerId: apiKey.ownerId,
    ownerType: apiKey.ownerType,
    scopes: apiKey.scopes.map((s) => s.scope),
  };
}
