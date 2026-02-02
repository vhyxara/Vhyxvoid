import { prisma } from '@/config/prisma';
import { errorResponse, successResponse } from '@/utils/response';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Create ability
 */
export async function createAbility(
  req: FastifyRequest<{ Body: { action: string; description: string } }>,
  res: FastifyReply,
) {
  try {
    const { action, description } = req.body;

    // find in db if ability with same action exists
    const existingAbility = await prisma.ability.findUnique({
      where: { action },
    });

    if (existingAbility) {
      return errorResponse(res, 'ability with same action exists', 400);
    }

    const ability = await prisma.ability.create({
      data: { action, description },
    });

    //  res.send({ success: true, message: 'Ability created successfully', ability });
    return successResponse(res, 'ability created successfully', 201, ability);
  } catch (error) {
    req.log.error(error);
    return errorResponse(res, 'failed to create ability', 500);
  }
}

/**
 * List abilities
 */
export async function listAbilities(req: FastifyRequest, res: FastifyReply) {
  try {
    const abilities = await prisma.ability.findMany();

    return successResponse(res, 'all abilities', 200, { abilities });
    //
  } catch (error) {
    req.log.error(error);
    return errorResponse(res, 'failed to fetch abilities', 500);
  }
}

/**
 * Delete ability (careful!)
 */
export async function deleteAbility(
  req: FastifyRequest<{ Params: { id: string } }>,
  res: FastifyReply,
) {
  const { id } = req.params;
  try {
    const ability = await prisma.ability.delete({ where: { id } });
    return successResponse(res, 'deleted successfully', 200, { ability });
  } catch (err) {
    req.log.error(err);
    return errorResponse(res, 'ability delete failed', 500);
  }
}
