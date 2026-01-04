import { prisma } from '@/config/prisma';
import { generateApiKey, generateApiSecret, hashSecret } from '@/utils/keyManagement';

type CreateApiKeyInput = {
  ownerId: string;
  ownerType: 'USER' | 'ORG';
  name: string;
  description?: string;
  scopes: string[];
  environment: 'DEV' | 'PROD';
  rateLimit?: number;
  expiresAt?: Date | null;
  createdById: string;
  keyPrefix?: string;
};

export async function createApiKey(input: CreateApiKeyInput) {
  const keyPrefix = input.environment === 'PROD' ? 'bksr_live_' : 'bksr_dev_';

  const key = generateApiKey(input.environment);
  const secret = generateApiSecret();
  const secretHash = hashSecret(secret);

  const apiKey = await prisma.apiKey.create({
    data: {
      key,
      keyPrefix,
      secretHash,
      name: input.name,
      description: input.description,
      ownerId: input.ownerId,
      ownerType: input.ownerType,
      environment: input.environment,
      rateLimit: input.rateLimit,
      expiresAt: input.expiresAt,
      createdById: input.createdById,
      scopes: {
        create: input.scopes.map((s) => ({ scope: s })),
      },
    },
    include: {
      scopes: true,
    },
  });

  return {
    apiKey,
    secret, // RETURN ONCE
  };
}
