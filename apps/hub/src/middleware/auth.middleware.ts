import { FastifyRequest, FastifyReply } from 'fastify';
// import jwt, { JwtPayload } from 'jsonwebtoken';
import fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { JwtPayload } from 'jsonwebtoken';

// declare global {
//   namespace Express {
//     interface FastifyRequest {
//       user?: JwtPayload | string;
//     }
//   }
// }
// export const authenticate = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader || !authHeader.startsWith('Bearer ')) {
//     res.status(401).send({ error: 'Unauthorized' });
//     return;
//   }

//   const token = authHeader?.split(' ')[1];
//   if (!token) {
//     res.status(401).send({ error: 'Unauthorized, token missing' });
//     return;
//   }

//   // Ensure JWT_SECRET is available
//   const secret = process.env.JWT_SECRET;
//   console.log('authenticate middleware - JWT_SECRET:', secret);
//   if (!secret) {
//     res.status(500).send({ error: 'Server error, JWT_SECRET is not defined' });
//     return;
//   }
//   try {
//     const decoded = jwt.verify(token, secret) as JwtPayload;
//     (req as any).user = decoded;
//   } catch (err: any) {
//     if (err.name === 'TokenExpiredError') {
//       res.status(401).send({ error: 'Token expired' });
//       return;
//     }
//     res.status(401).send({ error: 'Invalid token' });
//     return;
//   }
// };

// export const addAuthenticationHook = (fastify: any) => {
//   fastify.addHook('preHandler', authenticate);
// };

export const authenticate = async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).send({ error: 'Unauthorized' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = await req.jwtVerify(token);
    console.log('authenticate middleware - decoded token:', decoded);
    // (req as any).user = decoded;
    req.user = decoded as JwtPayload & {
      id: string;
      roles: string[];
      abilities: string[];
    };
  } catch (err) {
    res.status(401).send({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (role: string[]) => {
  return async (req: FastifyRequest, res: FastifyReply) => {
    const user = req.user;
    console.log('requireRole middleware - user roles:', user.roles);
    if (!user || !user.roles?.some((r: string) => role.includes(r))) {
      res.status(403).send({ error: 'Forbidden' });
      return;
    }
  };
};

// export const addRoleBasedAccessControl = (fastify: any, roles: string[]) => {
//   fastify.addHook('preHandler', requireRole(roles));
// };
