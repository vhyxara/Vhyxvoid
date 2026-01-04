import { prisma } from '@/config/prisma';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Create a role
 */

interface CreateRoleBody {
  name: string;
  description: string;
}

export async function createRole(
  req: FastifyRequest<{ Body: CreateRoleBody }>,
  res: FastifyReply,
): Promise<void> {
  const { name, description } = req.body;

  const role = await prisma.role.create({
    data: { name, description },
  });

  res.send(role);
}

export async function updateRole(
  req: FastifyRequest<{ Params: { id: string }; Body: Partial<CreateRoleBody> }>,
  res: FastifyReply,
): Promise<void> {
  const { id } = req.params;
  const { name, description } = req.body;

  const role = await prisma.role.update({
    where: { id },
    data: { name, description },
  });

  res.send(role);
}

export async function deleteRole(
  req: FastifyRequest<{ Params: { id: string } }>,
  res: FastifyReply,
): Promise<void> {
  const { id } = req.params;

  await prisma.role.delete({
    where: { id },
  });

  res.send({ success: true });
}

/**
 * Assign abilities to a role
 */
export async function assignAbilitiesToRole(
  req: FastifyRequest<{ Params: { roleId: string }; Body: { abilityIds: string[] } }>,
  res: FastifyReply,
) {
  const { roleId } = req.params;
  const { abilityIds } = req.body; // string[]

  await prisma.roleAbility.createMany({
    data: abilityIds.map((id) => ({
      roleId,
      abilityId: id,
    })),
    skipDuplicates: true,
  });

  res.send({ success: true });
}

/**
 * Get roles with abilities
 */
export async function listRoles(req: FastifyRequest, res: FastifyReply) {
  const roles = await prisma.role.findMany({
    include: {
      abilities: {
        include: { ability: true },
      },
    },
  });

  res.send(roles);
}
