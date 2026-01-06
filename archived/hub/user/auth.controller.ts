// import { FastifyReply, FastifyRequest } from 'fastify';
// import { comparePassword, generateToken, hashPassword, signToken } from '../../../apps/hub/src/utils/auth/auth';
// import { prisma } from '@/config/prisma';

// export const registerUser = async (
//   req: FastifyRequest<{ Body: { email: string; password: string; username: string } }>,
//   res: FastifyReply,
// ) => {
//   try {
//     const { email, password, username } = req.body;
//     if (!email || !password || !username) {
//       res.status(400).send({ error: 'All fields are required' });
//       return;
//     }
//     const existingUser = await prisma.user.findUnique({ where: { email } });
//     if (existingUser) {
//       res.status(409).send({ error: 'Email already registered' });
//       return;
//     }
//     const existingUsername = await prisma.user.findUnique({
//       where: { username },
//     });
//     if (existingUsername) {
//       res.status(409).send({ error: 'Username already registered' });
//       return;
//     }
//     const hashed = await hashPassword(password);
//     if (!hashed) {
//       res.status(500).send({ error: 'Password hashing failed' });
//       return;
//     }
//     const user = await prisma.user.create({
//       data: { email, password: hashed, username, role: 'USER' },
//     });
//     console.log('user', user);
//     const token = signToken({
//       id: user.id,
//       email: user.email,
//       role: user.role,
//     });
//     // const token = generateToken(user.id, user.role);
//     console.log('token', token);
//     res.status(201).send({
//       token,
//       user: { id: user.id, email: user.email, role: user.role },
//     });
//   } catch (err: any) {
//     if (err.code === 'P2002') {
//       res.status(409).send({ error: 'Email already in use' });
//       return;
//     }
//     console.error('Error registering user:', err.message);
//     res.status(500).send({ error: 'User registration failed', err });
//   }
// };

// export const loginUser = async (
//   req: FastifyRequest<{ Body: { email: string; password: string } }>,
//   res: FastifyReply,
// ) => {
//   const { email, password } = req.body;
//   try {
//     const user = await prisma.user.findUnique({ where: { email } });
//     if (!user || !(await comparePassword(password, user.password))) {
//       res.status(401).send({ error: 'Invalid Credentials' });
//       return;
//     }
//     const token = signToken({
//       id: user.id,
//       email: user.email,
//       role: user.role,
//     });
//     res.status(200).send({
//       token,
//       user: { id: user.id, email: user.email, role: user.role },
//     });
//   } catch (err: any) {
//     res.status(500).send({ error: 'Login Failed' });
//   }
// };

// export const getUser = async (req: FastifyRequest, res: FastifyReply) => {
//   const userId = (req as any).user.id;
//   try {
//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       // select: { ...user, password: false },
//       select: {
//         id: true,
//         email: true,
//         password: false,
//         username: true,
//         bio: true,
//         avatarUrl: true,
//         role: true,
//         createdAt: true,
//         updatedAt: true,
//         displayName: true,
//       },
//     });
//     if (!user) {
//       res.status(404).send({ error: 'User not found' });
//       return;
//     }
//     res.send(user);
//   } catch (err: any) {
//     res.status(500).send({ error: 'Failed to retrieve user' });
//   }
// };

// export const updateUser = async (
//   req: FastifyRequest<{
//     Body: { username?: string; avatarUrl?: string; displayName?: string };
//   }>,
//   res: FastifyReply,
// ) => {
//   const userId = (req as any).user.id;
//   const { username, avatarUrl, displayName } = req.body;
//   try {
//     const user = await prisma.user.findUnique({ where: { id: userId } });
//     if (!user) {
//       res.status(404).send({ error: 'User not found' });
//       return;
//     }
//     const updatedUser = await prisma.user.update({
//       where: { id: userId },
//       data: {
//         username,
//         avatarUrl,
//         displayName,
//       },
//     });
//     res.send({ message: 'User updated successfully', updatedUser });
//   } catch (err: any) {
//     res.status(500).send({ error: 'Failed to update user' });
//   }
// };
// export const deleteUser = async (req: FastifyRequest, res: FastifyReply) => {
//   const userId = (req as any).user.id;
//   try {
//     const user = await prisma.user.findUnique({ where: { id: userId } });
//     if (!user) {
//       res.status(404).send({ error: 'User not found' });
//       return;
//     }
//     await prisma.user.delete({ where: { id: userId } });
//     res.status(204).send({ message: 'User deleted successfully' });
//   } catch (err: any) {
//     res.status(500).send({ error: 'Failed to delete user' });
//   }
// };
// export const getAllUsers = async (req: FastifyRequest, res: FastifyReply) => {
//   try {
//     const users = await prisma.user.findMany({
//       select: {
//         id: true,
//         email: true,
//         username: true,
//         bio: true,
//         avatarUrl: true,
//         role: true,
//         createdAt: true,
//         updatedAt: true,
//       },
//     });
//     res.send(users);
//   } catch (err: any) {
//     res.status(500).send({ error: 'Failed to retrieve users' });
//   }
// };
