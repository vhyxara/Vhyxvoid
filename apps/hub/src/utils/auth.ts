import bcrypt from 'bcryptjs';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
// import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';

export const hashPassword = async (password: string) => {
  return await bcrypt.hash(password, 10);
};

export const comparePassword = async (password: string, hash: string) => {
  return await bcrypt.compare(password, hash);
};

// export const signToken = async (app: FastifyInstance, payload: object): Promise<string> => {
//   const secret = process.env.JWT_SECRET as string;
//   if (!secret) {
//     throw new Error('JWT_SECRET environment variable is missing.');
//   }
//   const expiresIn: string | number = process.env.JWT_EXPIRES_IN || ('1d' as const);
//   if (!expiresIn) {
//     throw new Error('JWT_EXPIRES_IN environment variable is missing.');
//   }

//   // const jwtsign = jwt.sign(payload, secret, {
//   //   expiresIn: process.env.JWT_EXPIRES_IN || '1d',
//   // });
//   return await app.jwt.sign(payload);
// };
// export const generateToken = async (
//   app: FastifyInstance,
//   userId: string,
//   role: string,
// ): Promise<string> => {
//   const secret = process.env.JWT_SECRET as string;

//   if (!secret) {
//     throw new Error('JWT_SECRET environment variable is missing.');
//   }

//   const payload = { id: userId, role };
//   return await app.jwt.sign(payload);
// };

export const verifyToken = async (app: FastifyInstance, token: string): Promise<any> => {
  try {
    return await app.jwt.verify(token);
  } catch (err) {
    throw new Error('Invalid or expired token');
  }
};
// export const isAuthenticatedUser = (user: any): user is JwtPayload => {
//   return user && typeof user === 'object' && user !== null;
// };

export function requireAbility(ability: string) {
  return (req: FastifyRequest, res: FastifyReply, next: Function) => {
    const user = req.user;
    if (!user) {
      return res.status(401).send({ error: 'Unauthorized' });
    }
    const abilities = user?.abilities || [];

    if (abilities.includes('superadmin') || abilities.includes(ability)) {
      return next();
    }

    return res.status(403).send({ error: 'Forbidden' });
  };
}
