import { prisma } from '@/config/prisma';
import { Prisma } from '@/generated/prisma/client';
import { errorResponse, successResponse } from '@/utils/response';
// import { signToken } from '@/utils/auth';
import bcrypt from 'bcryptjs';
import { FastifyReply, FastifyRequest } from 'fastify';

// export async function register(
//   req: FastifyRequest<{ Body: { email: string; username: string; password: string } }>,
//   res: FastifyReply,
// ) {
//   const { email, username, password } = req.body;

//   const hashed = await bcrypt.hash(password, 10);

//   //   const plan = await prisma.plan.upsert({
//   //     where: { name: 'free' },
//   //     update: {}, // No update needed, just ensure it exists
//   //     create: {
//   //       name: 'free',
//   //       price: 0, // You can add other fields as needed
//   //     },
//   //   });

//   const user = await prisma.user.create({
//     data: {
//       email,
//       username,
//       password: hashed,
//       roles: {
//         create: {
//           role: { connect: { name: 'user' } },
//         },
//       },
//       //   plan: {
//       //     connect: {
//       //       id: plan.id, // Use the plan's id to connect
//       //     },
//       //   },
//     },
//   });

//   res.send({ id: user.id });
// }

type UserWithRoles = Prisma.UserGetPayload<{
  include: {
    roles: {
      include: { role: true };
    };
  };
}>;
export async function register(
  req: FastifyRequest<{ Body: { email: string; username: string; password: string } }>,
  res: FastifyReply,
) {
  const { email, username, password } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  // Ensure the 'user' role exists (upsert creates it if it doesn't exist)
  const role = await prisma.role.upsert({
    where: { name: 'user' },
    update: {}, // No update is needed, just make sure it exists
    create: {
      name: 'user',
      description: 'Standard user role',
    },
  });

  // Now create the user and connect the 'user' role
  const user = await prisma.user.create({
    data: {
      email,
      username,
      password: hashed,
      roles: {
        create: {
          role: { connect: { id: role.id } }, // Connect using the role's id
        },
      },
    },
    include: {
      roles: {
        include: {
          role: true,
        },
      },
    },
  });
  const createdUser: UserWithRoles = user; // Type assertion to User interface
  res.send({ id: createdUser.id });
}

export async function login(
  req: FastifyRequest<{ Body: { email: string; password: string } }>,
  res: FastifyReply,
) {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        roles: {
          include: {
            role: {
              include: {
                abilities: { include: { ability: true } },
              },
            },
          },
        },
        //   plan: { include: { plan: true } },
      },
    });

    // if (!user) return res.status(401).send({ error: 'Invalid credentials' });
    if (!user) {
      return errorResponse(res, 'Invalid credentials', 401);
    }
    const ok = await bcrypt.compare(password, user.password);
    // if (!ok) return res.status(401).send({ error: 'Invalid credentials' });
    if (!ok) {
      return errorResponse(res, 'Invalid password', 401);
    }
    const abilities = user.roles.flatMap((r) => r.role.abilities.map((a) => a.ability.action));

    const token = await res.jwtSign(
      {
        userId: user.id,
        roles: user.roles.map((r) => r.role.name),
        abilities,
      },

      { expiresIn: '7d' },
    );

    // const payload = { userId: user.id, roles: user.roles.map((r) => r.role.name), abilities };
    // const token2 = await signToken( ,payload);
    // res.send({ token });
    res.setCookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });
    return successResponse(res, 'Login successful', 200, {
      token,
      user: {
        id: user.id,
        email: user.email,
        roles: user.roles.map((r) => r.role.name),
        abilities,
      },
    });
  } catch (err) {
    req.log.error(err);
    return errorResponse(res, 'Login failed', 500);
  }
}

export async function logout(req: FastifyRequest, res: FastifyReply) {
  // In a real-world scenario, you might want to invalidate the token on the client side
  // or store it in a blacklist for a certain period of time.
  try {
    res.clearCookie('access_token', { path: '/' });
  } catch (err) {
    req.log.error(err);
    return errorResponse(res, 'Logout failed', 500);
  }

  return successResponse(res, 'Logout successful', 200);
}
