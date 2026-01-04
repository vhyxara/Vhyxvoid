import { prisma } from '@/config/prisma';
import { createApiKey } from '@/services/keyManagement.service';
import { FastifyReply, FastifyRequest } from 'fastify';

export async function createApiKeyController(
  req: FastifyRequest<{
    Body: {
      name: string;
      description?: string;
      scopes: string[];
      environment: 'DEV' | 'PROD';
      rateLimit?: number;
      expiresAt?: Date | null;
    };
  }>,
  res: FastifyReply,
) {
  const user = req.user!; // injected by auth middleware

  const { name, description, scopes, environment, rateLimit, expiresAt } = req.body;

  if (!name || !Array.isArray(scopes) || !environment) {
    return res.status(400).send({ error: 'invalid_payload' });
  }

  // OPTIONAL: scope allow-list validation
  const ALLOWED_SCOPES = new Set([
    'hub.connect',
    'hub.request.send',
    'hub.response.receive',
    'hub.batch.send',
    'hub.replay.allowed',
    'env.dev',
    'env.prod',
    'rate.standard',
    'rate.high',
  ]);

  for (const s of scopes) {
    if (!ALLOWED_SCOPES.has(s)) {
      return res.status(400).send({ error: `invalid_scope: ${s}` });
    }
  }

  const { apiKey, secret } = await createApiKey({
    ownerId: user.userId,
    ownerType: 'USER',
    name,
    description,
    scopes,
    environment,
    rateLimit,
    expiresAt,
    createdById: user.userId,
  });

  return res.status(201).send({
    key: apiKey.key,
    secret, // ⚠️ ONLY TIME
    apiKeyId: apiKey.id,
    scopes: apiKey.scopes.map((s) => s.scope),
    environment,
    expiresAt,
  });
}

export const getApiKeyUsage = async (
  req: FastifyRequest<{ Params: { id: string } }>,
  res: FastifyReply,
) => {
  const { id } = req.params;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  console.log('Fetching API Key Usage for', id, 'since', since);
  try {
    const usage = await prisma.apiKeyUsage.groupBy({
      by: ['date'],
      where: {
        apiKeyId: id,
        date: { gte: since },
      },
      _sum: { count: true },
      orderBy: { date: 'asc' },
    });
    if (usage.length === 0) {
      return res.status(404).send({ error: 'No usage data found for the given API key.' });
    }
    console.log('API Key Usage for', id, usage);
    res.send(usage);
  } catch (error) {
    console.error('Error fetching API key usage:', error);
    res.status(500).send({ error: 'Internal server error' });
  }
};

// 4️⃣ Hook it into verification middleware

// Inside verifyApiKey middleware, AFTER success:

// recordUsage({
//   apiKeyId: apiKey.id,
//   scope: matchedScope,
//   endpoint: req.url,
//   method: req.method,
// });

// This ensures:

// Only valid requests counted

// No fake traffic pollution
