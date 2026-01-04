import { FastifyReply, FastifyRequest } from 'fastify';

// import bcrypt from 'bcryptjs';
import { comparePassword, generateToken, hashPassword, signToken } from '../../utils/auth/auth';
import { prisma } from '@/config/prisma';

export const registerAdmin = async (
  req: FastifyRequest<{ Body: { email: string; password: string; username: string } }>,
  res: FastifyReply,
) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username) {
    res.status(400).send({ error: 'All fields are required' });
    return;
  }
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    res.status(409).send({ error: 'Email already registered' });
    return;
  }
  try {
    const hashed = await hashPassword(password);
    if (!hashed) {
      res.status(500).send({ error: 'Password hashing failed' });
      return;
    }
    const user = await prisma.user.create({
      data: { email, password: hashed, username, role: 'ADMIN' },
    });
    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).send({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).send({ error: 'Email already in use' });
      return;
    }
    res.status(500).send({ error: 'User registration failed' });
  }
};

export const loginAdmin = async (
  req: FastifyRequest<{ Body: { email: string; password: string } }>,
  res: FastifyReply,
) => {
  // POST /api/admin/login
  const { email, password } = req.body;

  try {
    const admin = await prisma.user.findUnique({ where: { email } });
    if (!admin || admin.role !== 'ADMIN') {
      res.status(401).send({ error: 'Unauthorized access' });
      return;
    }

    const isValid = await comparePassword(password, admin.password);
    if (!isValid) {
      res.status(401).send({ error: 'Invalid credentials' });
      return;
    }
    // const token = jwt.sign(
    //   { userId: admin.id, role: admin.role },
    //   process.env.JWT_SECRET,
    //   { expiresIn: '7d' }
    // );
    const token = signToken({ id: admin.id, role: admin.role });
    res.send({ token });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).send({ error: 'Server error' });
  }
};
