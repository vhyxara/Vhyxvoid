import { prisma } from '@/config/prisma';
import { FastifyReply, FastifyRequest } from 'fastify';

// export async function updateUser(
//   req: FastifyRequest<{
//     Params: { id: string };
//     Body: { firstName?: string; lastName?: string; roles?: string[]; status?: boolean };
//   }>,
//   res: FastifyReply,
// ) {
//   const { id } = req.params;
//   const { firstName, lastName, roles, status } = req.body;
//   console.log(
//     'id',
//     id,
//     'firstName',
//     firstName,
//     'lastName',
//     lastName,
//     'roles',
//     roles,
//     'status',
//     status,
//   );
//   // Step 1: Find the user by ID
//   const user = await prisma.user.findUnique({
//     where: { id },
//   });

//   if (!user) return res.status(404).send({ error: 'User not found' });

//   // Step 2: Update user fields
//   const updatedUser = await prisma.user.update({
//     where: { id },
//     data: {
//       firstName,
//       lastName,
//       status,
//       // If roles are provided, update them
//       roles: Array.isArray(roles)
//         ? {
//             deleteMany: {}, // Clear existing roles
//             create:
//               //   roles.length > 0
//               //     ?
//               roles.map((roleName) => ({
//                 role: { connect: { name: roleName } },
//               })),
//             // : [{ role: { connect: { name: 'user' } } }], // Always set a default role (e.g., "user")
//           }
//         : undefined, // Only update roles if provided
//     },
//   });

//   res.send(updatedUser);
// }

export async function updateUser(
  req: FastifyRequest<{
    Params: { id: string };
    Body: { firstName?: string; lastName?: string; roles?: string[]; status?: boolean };
  }>,
  res: FastifyReply,
) {
  const { id } = req.params;
  const { firstName, lastName, roles, status } = req.body;

  console.log(
    'id',
    id,
    'firstName',
    firstName,
    'lastName',
    lastName,
    'roles',
    roles,
    'status',
    status,
  );

  // Step 1: Find the user by ID
  const user = await prisma.user.findUnique({
    where: { id },
    include: { roles: { include: { role: true } } }, // Include existing roles
  });

  if (!user) return res.status(404).send({ error: 'User not found' });

  // Step 2: If roles are provided, ensure they exist in the Role table
  let roleConnections = [];

  if (roles) {
    // Check if all provided roles exist in the Role table
    const existingRoles = await prisma.role.findMany({
      where: {
        name: { in: roles },
      },
    });

    // If any of the roles do not exist, return an error
    if (existingRoles.length !== roles.length) {
      return res.status(400).send({ error: 'One or more roles do not exist.' });
    }

    // Map the existing role names to their IDs for connecting
    roleConnections = existingRoles.map((role) => ({
      role: { connect: { id: role.id } },
    }));
  } else {
    // If no roles are provided, ensure the user retains at least one role (e.g., "user")
    const defaultRole = await prisma.role.findUnique({
      where: { name: 'user' }, // Adjust the default role name if needed
    });

    if (!defaultRole) {
      return res.status(400).send({ error: 'Default role "user" does not exist.' });
    }

    roleConnections = [{ role: { connect: { id: defaultRole.id } } }];
  }

  // Step 3: Update the user with new roles (if provided) and other fields
  const updatedUser = await prisma.user.update({
    where: { id },
    data: {
      firstName: firstName ?? user.firstName,
      lastName: lastName ?? user.lastName,
      status: status ?? user.status,
      roles: {
        // Ensure roles are properly connected, and don't clear all roles if no new roles are provided
        deleteMany: {}, // Clears the current roles
        create: roleConnections, // Add the new roles (or default role if none are provided)
      },
    },
  });

  res.send(updatedUser);
}

export async function getProfile(req: FastifyRequest, res: FastifyReply) {
  try {
    console.log('=================================');
    // console.log('Request object:', req);
    console.log('=================================');
    const userId = (req as any).user?.userId;
    console.log('=================================');
    console.log('User ID from token:', req.user);
    console.log('=================================');
    console.log('Fetching profile for userId:', userId);
    // Retrieve user profile data including roles and abilities
    if (!userId) {
      return res.status(400).send({ error: 'User not authenticated' });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        roles: {
          select: {
            role: {
              select: {
                name: true,
                description: true,
                abilities: {
                  select: {
                    ability: {
                      select: {
                        action: true,
                        description: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        // Optional: If you want to include the plan, uncomment this line
        // plan: { select: { name: true, price: true } },
      },
    });

    if (!user) {
      return res.status(404).send({ error: 'User not found' });
    }

    // Return the user profile data
    return res.send(user);
  } catch (error) {
    // Handle any unexpected errors
    console.error(error);
    return res.status(500).send({ error: 'Internal server error' });
  }
}

export async function listUsers(req: FastifyRequest, res: FastifyReply) {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      username: true,
      roles: {
        select: {
          role: {
            select: {
              name: true,
              description: true,
            },
          },
        },
      },
      //   plan: { select: { name: true, price: true } },
    },
  });

  res.send(users);
}

export async function deleteUser(
  req: FastifyRequest<{ Params: { id: string } }>,
  res: FastifyReply,
) {
  const { id } = req.params;

  // Step 1: Delete the user roles first (avoid foreign key constraint violation)
  await prisma.userRole.deleteMany({
    where: { userId: id },
  });

  // Step 2: Delete the user
  await prisma.user.delete({
    where: { id },
  });

  res.send({ success: true });
}

export async function deactivateUser(
  req: FastifyRequest<{ Params: { id: string } }>,
  res: FastifyReply,
) {
  const { id } = req.params;

  // Deactivate user by setting status to false
  const updatedUser = await prisma.user.update({
    where: { id },
    data: { status: false },
  });

  res.send({ success: true, updatedUser });
}
