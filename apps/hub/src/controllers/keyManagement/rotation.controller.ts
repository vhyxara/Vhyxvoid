import { prisma } from '@/config/prisma';
import { bcryptHashSecret, generateSecret } from '@/utils/keyManagement';
import { FastifyReply, FastifyRequest } from 'fastify';

export const rotateApiKey = async (
  req: FastifyRequest<{ Params: { id: string }; Body?: { gracePeriodHours?: number } }>,
  res: FastifyReply,
) => {
  const user = (req as any).user;
  const { id } = req.params;
  console.log('rotateApiKey called with id:', id);
  const graceHours = req.body?.gracePeriodHours ?? 24;
  const expiresAt = new Date(Date.now() + graceHours * 60 * 60 * 1000);

  const apiKey = await prisma.apiKey.findUnique({ where: { id } });

  if (!apiKey) {
    return res.status(404).send({ error: 'API key not found' });
  }

  // Ownership / admin check
  const isOwner = apiKey.ownerId === user.userId;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user.role);

  if (!isOwner && !isAdmin) {
    return res.status(403).send({ error: 'Forbidden' });
  }

  if (apiKey.status !== 'ACTIVE') {
    return res.status(400).send({ error: 'Key is not active' });
  }

  // Generate new secret
  const newSecret = generateSecret();
  const newSecretHash = await bcryptHashSecret(newSecret);

  await prisma.apiKey.update({
    where: { id },
    data: {
      previousSecretHash: apiKey.secretHash,
      secretHash: newSecretHash,
      rotatedAt: new Date(),
      expiresAt,
    },
  });

  res.send({
    key: apiKey.key,
    secret: newSecret,
    expiresAt,
    note: 'Store this secret securely. It will not be shown again.',
  });
};
