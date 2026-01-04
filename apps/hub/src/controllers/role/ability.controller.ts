import { prisma } from '@/config/prisma';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Create ability
 */
export async function createAbility(
  req: FastifyRequest<{ Body: { action: string; description: string } }>,
  res: FastifyReply,
) {
  const { action, description } = req.body;

  const ability = await prisma.ability.create({
    data: { action, description },
  });

  res.send(ability);
}

/**
 * List abilities
 */
export async function listAbilities(req: FastifyRequest, res: FastifyReply) {
  const abilities = await prisma.ability.findMany();
  res.send(abilities);
}

/**
 * Delete ability (careful!)
 */
export async function deleteAbility(
  req: FastifyRequest<{ Params: { id: string } }>,
  res: FastifyReply,
) {
  const { id } = req.params;

  await prisma.ability.delete({ where: { id } });
  res.send({ success: true });
}
